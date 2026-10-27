/**
 * src/sheets/token-sheet.mjs
 * ==========================
 * Token-anchored actor sheet for Roll for Shoes (characters and NPCs).
 *
 * A frameless sheet laid out as three columns around a centre column:
 *   left   — skills (scrolls when long)
 *   centre — portrait, name, concept · XP, bio  (the anchor)
 *   right  — statuses above gear
 *
 * Anchoring (verified against Foundry 14.369 source — see Foundry-v14-API.md):
 *  - Token double-click calls actor.sheet.render(true, {token}) — we capture
 *    options.token on render and centre the portrait over that token.
 *  - If the sheet would go off-screen, canvas.animatePan({x, y}) pans at the
 *    current zoom (omitting scale keeps it). If the view can't pan far enough
 *    (scene-edge constraint), the sheet is clamped to the viewport instead.
 *  - canvasPan and refreshToken hooks keep it following the token.
 *  - Opened without a token (sidebar, token on another scene) → screen centre.
 *
 * Actions reuse the classic sheets' handlers — they only touch this.actor.
 * The classic sheets remain registered as non-default fallbacks.
 */

import { RfsCharacterSheet, sortSkillsForDisplay, mergeSkillFormData } from "./character-sheet.mjs";
import { RfsNpcSheet } from "./npc-sheet.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

/** Minimum gap between the sheet and the viewport edge, in px. */
const VIEWPORT_MARGIN = 12;

export class RfsTokenSheet extends HandlebarsApplicationMixin(ActorSheetV2) {

  _editMode = false;

  /** Panels the user has collapsed (persists across re-renders while open). */
  #collapsed = new Set();

  /** TokenDocument this sheet is anchored to, or null for screen-centred. */
  #anchorToken = null;

  /** Registered hook ids, removed on close. */
  #hookIds = {};

  /* -------------------------------------------- */
  /*  Static Configuration                        */
  /* -------------------------------------------- */

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["roll-for-shoes", "rfs-token-sheet"],
    window: { frame: false, positioned: false },
    form: {
      submitOnChange: true,
      closeOnSubmit: false,
    },
    actions: {
      toggleEditMode: RfsTokenSheet._onToggleEditMode,
      toggleNpcMode:  RfsNpcSheet._onToggleMode,
      rollDifficulty: RfsNpcSheet._onRollDifficulty,
      rollSkill:      RfsTokenSheet._onRollSkill,
      deleteSkill:    RfsCharacterSheet._onDeleteSkill,
      addStatus:      RfsCharacterSheet._onAddStatus,
      deleteStatus:   RfsCharacterSheet._onDeleteStatus,
      addItem:        RfsCharacterSheet._onAddItem,
      deleteItem:     RfsCharacterSheet._onDeleteItem,
    },
  };

  /** @override */
  static PARTS = {
    sheet: {
      template: "systems/roll-for-shoes/templates/actor/token-sheet.hbs",
    },
  };

  /* -------------------------------------------- */
  /*  Context Preparation                         */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor   = this.actor;
    const system  = actor.system;
    const isNpc   = actor.type === "npc";
    const isFixed = isNpc && system.mode === "fixed";
    const bioRaw  = isNpc ? system.description : system.biography;
    const { TextEditor } = foundry.applications.ux;

    return {
      ...context,
      actor,
      system,
      isEditable:  this.isEditable,
      editMode:    this.isEditable && this._editMode,
      isNpc,
      isFixed,
      showSkills:  !isFixed,
      showGear:    !isNpc,
      skills:      sortSkillsForDisplay(system.skills),
      statuses:    system.statuses,
      inventory:   system.inventory ?? [],
      bioField:    isNpc ? "system.description" : "system.biography",
      bioRaw,
      bioHTML:     await TextEditor.implementation.enrichHTML(bioRaw ?? "", { secrets: actor.isOwner }),
      collapsed: {
        skills:   this.#collapsed.has("skills"),
        statuses: this.#collapsed.has("statuses"),
        gear:     this.#collapsed.has("gear"),
      },
    };
  }

  /* -------------------------------------------- */
  /*  Form Data Processing                        */
  /* -------------------------------------------- */

  /** @override — preserve array fields that have no form input (see character-sheet.mjs). */
  _processFormData(event, form, formData) {
    const data = super._processFormData(event, form, formData);

    if (data.system?.skills) {
      data.system.skills = mergeSkillFormData(data.system.skills, this.actor.system.skills);
    }

    if (data.system?.inventory) {
      const existing = this.actor.system.inventory;
      data.system.inventory = existing.map((item, i) => {
        const submitted = data.system.inventory[i];
        if (!submitted) return { ...item };
        return { ...item, name: submitted.name ?? item.name, quantity: submitted.quantity ?? item.quantity };
      });
    }

    return data;
  }

  /* -------------------------------------------- */
  /*  Lifecycle                                   */
  /* -------------------------------------------- */

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);

    // Token double-click passes {token}; re-renders keep the existing anchor
    if (options.isFirstRender) this.#anchorToken = options.token ?? null;

    // Remember collapsed panels across re-renders
    for (const details of this.element.querySelectorAll("details[data-panel]")) {
      details.addEventListener("toggle", () => {
        if (details.open) this.#collapsed.delete(details.dataset.panel);
        else this.#collapsed.add(details.dataset.panel);
      });
    }

    if (options.isFirstRender) {
      this.#hookIds.canvasPan    = Hooks.on("canvasPan", () => this.#reposition());
      this.#hookIds.refreshToken = Hooks.on("refreshToken", token => {
        if (token.document === this.#anchorToken) this.#reposition();
      });
      this.#reposition({ allowPan: true });
    }
    else this.#reposition();
  }

  /** @override */
  async _preClose(options) {
    await super._preClose(options);
    for (const [hook, id] of Object.entries(this.#hookIds)) Hooks.off(hook, id);
    this.#hookIds = {};
  }

  /** @override */
  _onClose(options) {
    super._onClose(options);
    this.#anchorToken = null;
  }

  /* -------------------------------------------- */
  /*  Positioning                                 */
  /* -------------------------------------------- */

  /**
   * Screen position of the anchor token's centre, or null when the token
   * isn't drawn on the currently viewed scene.
   * @returns {{x: number, y: number}|null}
   */
  #anchorPoint() {
    const token = this.#anchorToken?.object;
    if (!token || !canvas.ready || this.#anchorToken.parent !== canvas.scene) return null;
    return canvas.clientCoordinatesFromCanvas(token.center);
  }

  /**
   * Place the sheet so the portrait sits over the anchor token.
   * @param {object} [opts]
   * @param {boolean} [opts.allowPan=false]  Pan the canvas (current zoom) if the sheet won't fit.
   */
  #reposition({ allowPan = false } = {}) {
    const el       = this.element;
    const portrait = el?.querySelector(".rfs-ts__portrait");
    if (!el || !portrait) return;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w  = el.offsetWidth;
    const h  = el.offsetHeight;

    // Portrait centre relative to the sheet's top-left corner
    const sheetRect = el.getBoundingClientRect();
    const pRect     = portrait.getBoundingClientRect();
    const offX = (pRect.left + pRect.width / 2) - sheetRect.left;
    const offY = (pRect.top + pRect.height / 2) - sheetRect.top;

    const anchor = this.#anchorPoint() ?? { x: vw / 2, y: vh / 2 - h / 2 + offY };
    let left = anchor.x - offX;
    let top  = anchor.y - offY;

    // Shift needed to bring the sheet fully on-screen (0 when it already fits)
    const fit = (pos, size, max) => {
      if (size + 2 * VIEWPORT_MARGIN > max) return (max - size) / 2 - pos;   // too big — centre it
      if (pos < VIEWPORT_MARGIN) return VIEWPORT_MARGIN - pos;
      if (pos + size > max - VIEWPORT_MARGIN) return (max - VIEWPORT_MARGIN) - (pos + size);
      return 0;
    };
    const dx = fit(left, w, vw);
    const dy = fit(top, h, vh);

    // First open: pan so the token moves with the sheet. The canvasPan hook
    // repositions each animation tick; anything the pan can't cover is clamped.
    if (allowPan && (dx || dy) && this.#anchorPoint()) {
      const scale = canvas.stage.scale.x;
      canvas.animatePan({
        x: canvas.stage.pivot.x - dx / scale,
        y: canvas.stage.pivot.y - dy / scale,
      });
    }

    el.style.left = `${Math.round(left + dx)}px`;
    el.style.top  = `${Math.round(top + dy)}px`;
  }

  /* -------------------------------------------- */
  /*  Action Handlers                             */
  /* -------------------------------------------- */

  /** NPCs roll plain dice to chat; characters use the full RFS roll flow. */
  static async _onRollSkill(event, target) {
    const handler = this.actor.type === "npc" ? RfsNpcSheet._onRollSkill : RfsCharacterSheet._onRollSkill;
    return handler.call(this, event, target);
  }

  static _onToggleEditMode() {
    this._editMode = !this._editMode;
    this.render();
  }
}
