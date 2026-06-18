/**
 * src/apps/dc-tracker.mjs
 * ========================
 * Persistent DC tracker — always visible at the top of the viewport.
 *
 * Shows the current global DC (read from the "globalDc" world setting).
 * The GM can step the DC with +/− buttons, jump to a named tier chip/rail/menu
 * item, or toggle a popover. Players see the DC value read-only.
 *
 * Rendered on the "ready" hook; re-renders automatically via the
 * globalDc / targetNamePicker settings' onChange callbacks.
 *
 * Note: window.frame = false removes Foundry's title/close chrome,
 * leaving a bare element positioned by CSS. Verify against Foundry v14
 * ApplicationV2 reference if this option behaves unexpectedly.
 */

import { RFS, tierOf } from "../helpers/config.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class RfsDcTracker extends HandlebarsApplicationMixin(ApplicationV2) {

  /* -------------------------------------------- */
  /*  Static Configuration                        */
  /* -------------------------------------------- */

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "rfs-dc-tracker",
    classes: ["roll-for-shoes", "rfs-app", "rfs-dc-tracker"],
    window: { frame: false },
    actions: {
      stepDc:     RfsDcTracker._onStepDc,
      setDc:      RfsDcTracker._onSetDc,
      toggleMenu: RfsDcTracker._onToggleMenu,
    },
  };

  /** @override */
  static PARTS = {
    tracker: {
      template: "systems/roll-for-shoes/templates/apps/dc-tracker.hbs",
    },
  };

  /* -------------------------------------------- */
  /*  Context Preparation                         */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const dc         = game.settings.get("roll-for-shoes", "globalDc") ?? 4;
    const mode       = game.settings.get("roll-for-shoes", "difficultyMode") ?? "moreXp";
    const namePicker = game.settings.get("roll-for-shoes", "targetNamePicker") ?? "chips";
    const isGM       = game.user.isGM;

    const rawTiers        = RFS.dcTiers[mode] ?? RFS.dcTiers.moreXp;
    const activeTierLabel = tierOf(dc, rawTiers);
    const tiers           = rawTiers.map(t => ({ ...t, active: t.label === activeTierLabel }));

    return {
      ...await super._prepareContext(options),
      dc,
      tiers,
      isGM,
      namePicker,
      showChips: isGM && namePicker === "chips",
      showMenu:  isGM && namePicker === "menu",
      showRail:  isGM && namePicker === "rail",
    };
  }

  /* -------------------------------------------- */
  /*  Lifecycle                                   */
  /* -------------------------------------------- */

  /**
   * Prevent ApplicationV2 from setting inline left/top styles that override
   * our CSS-driven centering (`left: 50%; transform: translateX(-50%)`).
   * @override
   */
  setPosition(pos = {}) {
    return this.position;
  }

  /** @override */
  _onRender(context, options) {
    // Hang from the bottom edge of Foundry's navigation bar so the widget
    // sits flush at the top of the canvas area rather than behind the nav.
    const nav = document.querySelector("#navigation");
    this.element.style.top = nav ? `${nav.getBoundingClientRect().bottom}px` : "0px";

    // Close the popover when the pointer leaves the target widget
    const widget = this.element.querySelector(".rfs-target-display");
    if (widget) {
      widget.addEventListener("mouseleave", () => widget.removeAttribute("data-menu-open"));
    }
  }

  /* -------------------------------------------- */
  /*  Actions (GM only)                           */
  /* -------------------------------------------- */

  static async _onStepDc(event, target) {
    if (!game.user.isGM) return;
    const dir = parseInt(target.dataset.dir, 10);
    const dc  = game.settings.get("roll-for-shoes", "globalDc") ?? 4;
    await game.settings.set("roll-for-shoes", "globalDc", Math.max(1, Math.min(30, dc + dir)));
  }

  static async _onSetDc(event, target) {
    if (!game.user.isGM) return;
    const val = parseInt(target.dataset.value, 10);
    if (!isNaN(val)) await game.settings.set("roll-for-shoes", "globalDc", val);
  }

  static _onToggleMenu(event, target) {
    if (!game.user.isGM) return;
    const widget = target.closest(".rfs-target-display");
    widget?.toggleAttribute("data-menu-open");
  }
}
