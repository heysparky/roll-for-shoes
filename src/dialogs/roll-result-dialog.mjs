/**
 * src/dialogs/roll-result-dialog.mjs
 * ====================================
 * Themed popup shown after a standalone roll instead of posting to chat.
 *
 * Handles optional advancement paths inline:
 *   allSixes  → "Claim Skill" button → claimAdvancement (posts announcement to chat)
 *   !allSixes → "Spend X XP" button → _doStandaloneXpSpend (posts announcement to chat)
 *
 * The dialog is fire-and-forget: roll() opens it without awaiting dismissal.
 */

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

export class RfsRollResultDialog extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    classes: ["roll-for-shoes", "rfs-app", "rfs-rrd"],
    position: { width: 320, height: "auto" },
    window: { resizable: false, minimizable: false },
    actions: {
      claimSkill: RfsRollResultDialog._onClaimSkill,
      spendXp:    RfsRollResultDialog._onSpendXp,
    },
  };

  static PARTS = {
    dialog: {
      template: "systems/roll-for-shoes/templates/dialog/roll-result-dialog.hbs",
    },
  };

  constructor(data, options = {}) {
    super(options);
    this._rollData = data;
  }

  /**
   * Open the roll result popup. Does NOT need to be awaited.
   * @param {object} data - roll result fields
   */
  static open(data) {
    return new RfsRollResultDialog(data, {
      window: { title: `${data.actorName} · ${data.skillName} (${data.skillLevel}d6)` },
    }).render({ force: true });
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const d = this._rollData;
    return {
      ...context,
      ...d,
      canClaimSkill: d.allSixes,
      canSpendXp:    !d.allSixes && d.nonSixCount > 0 && d.currentXp >= d.nonSixCount,
      spendXpLabel:  game.i18n.format("RFS.Chat.SpendXp", { cost: d.nonSixCount }),
    };
  }

  static async _onClaimSkill(event, target) {
    const d = this._rollData;
    const { RfsSkillRoll } = await import("../rolls/skill-roll.mjs");
    await RfsSkillRoll.claimAdvancement(d.actorId, d.skillId, null);
    await this.close();
  }

  static async _onSpendXp(event, target) {
    const d = this._rollData;
    const actor = game.actors.get(d.actorId);
    if (!actor) return;
    const skill = { id: d.skillId, name: d.skillName, level: d.skillLevel };
    const { RfsSkillRoll } = await import("../rolls/skill-roll.mjs");
    const done = await RfsSkillRoll._doStandaloneXpSpend(actor, skill, d.nonSixCount);
    if (done) await this.close();
  }
}
