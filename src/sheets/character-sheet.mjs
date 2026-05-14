/**
 * src/sheets/character-sheet.mjs
 * ===================================
 * Character sheet for Roll for Shoes PCs.
 *
 * v14 pattern: HandlebarsApplicationMixin(ActorSheetV2)
 *  - DEFAULT_OPTIONS replaces static get defaultOptions()
 *  - PARTS replaces a single template string
 *  - _prepareContext() replaces getData()
 *  - Actions replace click listeners (cleaner, declarative)
 *  - submitOnChange: true means every input change auto-saves
 *
 * Sheet responsibilities:
 *  - Render the skill tree (flat data → tree display)
 *  - Surface XP and status controls
 *  - Delegate roll events to rolls/skill-roll.mjs
 *  - Delegate mutations (add skill, remove skill) to RfsActor methods
 *
 * Note: XP spend is intentionally NOT on this sheet. It lives on the
 * roll result card in chat — players spend XP in response to a specific
 * roll, not as a standalone sheet action.
 */

import { RfsSkillRoll } from "../rolls/skill-roll.mjs";
// RfsSkillMapDialog (⤢ horizontal bracket tree popup) was removed.
// To restore: git revert the commit "chore: remove skill map dialog".

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

export class RfsCharacterSheet extends HandlebarsApplicationMixin(ActorSheetV2) {

  /* -------------------------------------------- */
  /*  Static Configuration                        */
  /* -------------------------------------------- */

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["roll-for-shoes", "rfs-app", "sheet", "actor", "character"],
    position: { width: 680, height: 760 },
    resizable: true,
    form: {
      submitOnChange: true,
      closeOnSubmit: false,
    },
    actions: {
      // Sheet
      editPortrait: RfsCharacterSheet._onEditPortrait,
      switchTab:    RfsCharacterSheet._onSwitchTab,

      // Skill actions
      rollSkill:    RfsCharacterSheet._onRollSkill,
      renameSkill:  RfsCharacterSheet._onRenameSkill,
      addSkill:     RfsCharacterSheet._onAddSkill,
      deleteSkill:  RfsCharacterSheet._onDeleteSkill,

      // Status actions
      addStatus:    RfsCharacterSheet._onAddStatus,
      deleteStatus: RfsCharacterSheet._onDeleteStatus,

      // Inventory actions
      addItem:    RfsCharacterSheet._onAddItem,
      deleteItem: RfsCharacterSheet._onDeleteItem,
    },
  };

  /** @override */
  static PARTS = {
    sheet: {
      template: "systems/roll-for-shoes/templates/actor/character-sheet.hbs",
    },
  };

  /* -------------------------------------------- */
  /*  Context Preparation                         */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);

    const actor  = this.actor;
    const system = actor.system;

    const rawHistory = actor.getFlag("roll-for-shoes", "rollHistory") ?? [];
    const rollHistory = rawHistory.map(entry => ({
      ...entry,
      diceDisplay: entry.dice.join(", "),
      timeDisplay: new Date(entry.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    }));

    return {
      ...context,
      actor,
      system,
      isEditable: this.isEditable,
      skills:     this._sortSkillsForDisplay(system.skills),
      rootSkillId: system.rootSkill?.id ?? "root",
      statuses:   system.statuses,
      inventory:  system.inventory,
      totalStatusModifier: system.totalStatusModifier,
      xp:         system.xp,
      rollHistory,
      labels: {
        xp:        game.i18n.localize("RFS.Label.XP"),
        skills:    game.i18n.localize("RFS.Label.Skills"),
        statuses:  game.i18n.localize("RFS.Label.Statuses"),
        biography: game.i18n.localize("RFS.Label.Biography"),
        history:   game.i18n.localize("RFS.Label.RollHistory"),
      },
    };
  }

  /**
   * Sort skills root-first, children following parents.
   */
  _sortSkillsForDisplay(skills) {
    // Build a stable map of skill id → original array index so form inputs
    // use name="system.skills.N.name" with N matching the stored array position,
    // not the display-sorted position.
    const indexMap = new Map(skills.map((s, i) => [s.id, i]));

    const root = skills.find((s) => s.parentId === "");
    if (!root) return skills.map((s, i) => ({ ...s, depth: 0, originalIndex: i }));

    const result = [];
    const addWithChildren = (parentId, depth) => {
      for (const s of skills.filter((s) => s.parentId === parentId)) {
        result.push({ ...s, depth, originalIndex: indexMap.get(s.id) ?? 0 });
        addWithChildren(s.id, depth + 1);
      }
    };

    result.push({ ...root, depth: 0, originalIndex: indexMap.get(root.id) ?? 0 });
    addWithChildren(root.id, 1);

    const orphans = skills.filter((s) => !result.find((r) => r.id === s.id));
    return [...result, ...orphans.map((s) => ({ ...s, depth: 0, originalIndex: indexMap.get(s.id) ?? 0 }))];
  }

  /* -------------------------------------------- */
  /*  Form Data Processing                        */
  /* -------------------------------------------- */

  /**
   * Override _processFormData to prevent partial skill updates from
   * resetting fields that have no corresponding form input (level, id,
   * parentId, notes).
   *
   * See dnd5e-reference.mjs — ARRAY FIELD PARTIAL FORM UPDATES pattern.
   * @override
   */
  _processFormData(event, form, formData) {
    const data = super._processFormData(event, form, formData);

    if (data.system?.skills) {
      const existingSkills = this.actor.system.skills;
      const merged = existingSkills.map((skill, i) => {
        const submitted = data.system.skills[i];
        if (!submitted) return { ...skill };
        return { ...skill, name: submitted.name ?? skill.name };
      });
      data.system.skills = merged;
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
  /*  Action Handlers                             */
  /* -------------------------------------------- */

  static async _onEditPortrait() {
    new FilePicker({
      type: "image",
      current: this.actor.img,
      callback: (path) => this.actor.update({ img: path }),
    }).render(true);
  }

  static async _onRollSkill(event, target) {
    const skillId = target.dataset.skillId;
    const skill   = this.actor.getSkillById(skillId);
    if (!skill) return;
    return RfsSkillRoll.roll(this.actor, skill);
  }

  static async _onAddSkill(event, target) {
    const parentId = target.dataset.skillId ?? this.actor.getRootSkill()?.id ?? "root";
    const parent   = this.actor.getSkillById(parentId);
    if (!parent) return;

    const result = await foundry.applications.api.DialogV2.input({
      window: { title: game.i18n.localize("RFS.Dialog.NewSkill.Title") },
      content: `<input type="text" name="skillName"
                  placeholder="${game.i18n.localize("RFS.Dialog.NewSkill.Placeholder")}"
                  autofocus style="width:100%">`,
      ok: { label: game.i18n.localize("RFS.Dialog.NewSkill.Confirm") },
    });

    const name = result?.skillName?.trim();
    if (!name) return;
    return this.actor.addSkill(name, parentId);
  }

  static async _onRenameSkill(event, target) {
    const skillId = target.dataset.skillId;
    const skill   = this.actor.getSkillById(skillId);
    if (!skill) return;

    const result = await foundry.applications.api.DialogV2.input({
      window: { title: game.i18n.localize("RFS.Dialog.RenameSkill.Title") },
      content: `<input type="text" name="skillName" value="${skill.name}" autofocus style="width:100%">`,
      ok: { label: game.i18n.localize("RFS.Dialog.RenameSkill.Confirm") },
    });

    const name = result?.skillName?.trim();
    if (!name || name === skill.name) return;

    const skills = this.actor.system.skills.map(s =>
      s.id === skillId ? { ...s, name } : s
    );
    return this.actor.update({ "system.skills": skills });
  }

  static async _onDeleteSkill(event, target) {
    const skillId = target.dataset.skillId;
    return this.actor.removeSkill(skillId);
  }

  static async _onEditSkill(event, target) {
    // Handled via submitOnChange — this is a fallback for future explicit save buttons.
  }

  static async _onAddStatus(event, target) {
    const result = await foundry.applications.api.DialogV2.input({
      window: { title: game.i18n.localize("RFS.Dialog.NewStatus.Title") },
      content: `
        <div style="display:flex; flex-direction:column; gap:0.5rem;">
          <div>
            <label style="display:block; margin-bottom:0.25rem;">
              ${game.i18n.localize("RFS.Dialog.NewStatus.NameLabel")}
            </label>
            <input type="text"
                   name="statusName"
                   placeholder="${game.i18n.localize("RFS.Dialog.NewStatus.NamePlaceholder")}"
                   autofocus
                   style="width:100%">
          </div>
          <div>
            <label style="display:block; margin-bottom:0.25rem;">
              ${game.i18n.localize("RFS.Dialog.NewStatus.ValueLabel")}
            </label>
            <input type="number"
                   name="statusValue"
                   value="0"
                   style="width:100%">
          </div>
        </div>`,
      ok: { label: game.i18n.localize("RFS.Dialog.NewStatus.Confirm") },
    });

    const name  = result?.statusName?.trim();
    const value = parseInt(result?.statusValue ?? 0, 10);
    if (!name) return;
    return this.actor.addStatus(name, isNaN(value) ? 0 : value);
  }

  static async _onDeleteStatus(event, target) {
    const statusId = target.dataset.statusId;
    return this.actor.removeStatus(statusId);
  }

  static async _onAddItem(event, target) {
    const result = await foundry.applications.api.DialogV2.input({
      window: { title: game.i18n.localize("RFS.Dialog.NewItem.Title") },
      content: `<input type="text" name="itemName"
                  placeholder="${game.i18n.localize("RFS.Dialog.NewItem.Placeholder")}"
                  autofocus style="width:100%">`,
      ok: { label: game.i18n.localize("RFS.Dialog.NewItem.Confirm") },
    });

    const name = result?.itemName?.trim();
    if (!name) return;
    return this.actor.addItem(name);
  }

  static async _onDeleteItem(event, target) {
    const itemId = target.dataset.itemId;
    return this.actor.removeItem(itemId);
  }

  static _onSwitchTab(event, target) {
    const tab = target.dataset.tab;
    this.element.querySelectorAll(".rfs-tabs__btn").forEach(btn => {
      btn.classList.toggle("rfs-tabs__btn--active", btn.dataset.tab === tab);
    });
    this.element.querySelectorAll(".rfs-tab-panel").forEach(panel => {
      panel.classList.toggle("rfs-tab-panel--active", panel.dataset.tab === tab);
    });
  }

}

