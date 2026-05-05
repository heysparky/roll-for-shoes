/**
 * src/dialogs/skill-map-dialog.mjs
 * =====================================
 * Full bracket-tree view of a character's skill tree.
 * Opened via the ⤢ button on the character sheet.
 *
 * Renders the existing skill-tree / skill-node partials in a wide,
 * horizontally-scrollable window. Rolling from here works identically
 * to rolling from the sheet.
 *
 * One dialog per actor — clicking ⤢ again brings the existing one
 * to front rather than opening a duplicate.
 */

import { RfsSkillRoll } from "../rolls/skill-roll.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class RfsSkillMapDialog extends HandlebarsApplicationMixin(ApplicationV2) {

  static #open = new Map();

  /* -------------------------------------------- */
  /*  Static Configuration                        */
  /* -------------------------------------------- */

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["roll-for-shoes", "rfs-app", "rfs-skill-map-dialog"],
    position: { width: 860, height: 480 },
    resizable: true,
    actions: {
      rollSkill: RfsSkillMapDialog._onRollSkill,
    },
  };

  /** @override */
  static PARTS = {
    map: {
      template: "systems/roll-for-shoes/templates/dialog/skill-map-dialog.hbs",
    },
  };

  /* -------------------------------------------- */
  /*  Dynamic Title                               */
  /* -------------------------------------------- */

  get title() {
    return `${this._actor.name} — ${game.i18n.localize("RFS.Label.Skills")}`;
  }

  /* -------------------------------------------- */
  /*  Static Entry Point                          */
  /* -------------------------------------------- */

  static async open(actor) {
    const existing = RfsSkillMapDialog.#open.get(actor.id);
    if (existing) return existing.render({ force: true });
    const dialog = new RfsSkillMapDialog({ actor });
    return dialog.render({ force: true });
  }

  /* -------------------------------------------- */
  /*  Constructor                                 */
  /* -------------------------------------------- */

  constructor(options = {}) {
    super(options);
    this._actor = options.actor;
    RfsSkillMapDialog.#open.set(this._actor.id, this);
  }

  /* -------------------------------------------- */
  /*  Lifecycle                                   */
  /* -------------------------------------------- */

  /** @override */
  async _onClose(options) {
    RfsSkillMapDialog.#open.delete(this._actor.id);
    return super._onClose(options);
  }

  /* -------------------------------------------- */
  /*  Context Preparation                         */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    return {
      ...await super._prepareContext(options),
      skills: this._actor.system.skills,
    };
  }

  /* -------------------------------------------- */
  /*  Action Handlers                             */
  /* -------------------------------------------- */

  static async _onRollSkill(event, target) {
    const skill = this._actor.getSkillById(target.dataset.skillId);
    if (!skill) return;
    return RfsSkillRoll.roll(this._actor, skill);
  }
}
