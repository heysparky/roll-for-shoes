/**
 * src/sheets/npc-sheet.mjs
 * ============================
 * NPC sheet for Roll for Shoes.
 *
 * Renders differently based on npc.system.mode:
 *  "fixed" → shows difficulty number + description. Simple, fast.
 *  "full"  → shows full PC-style skill tree, XP, and statuses.
 *
 * The mode toggle is a checkbox/select in the sheet header.
 * Switching modes doesn't destroy the data (skills are always stored),
 * it just shows/hides sections in the template.
 */

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

export class RfsNpcSheet extends HandlebarsApplicationMixin(ActorSheetV2) {

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["roll-for-shoes", "sheet", "actor", "npc"],
    position: { width: 480, height: 400 },
    resizable: true,
    form: {
      submitOnChange: true,
      closeOnSubmit: false,
    },
    actions: {
      toggleMode:     RfsNpcSheet._onToggleMode,
      rollDifficulty: RfsNpcSheet._onRollDifficulty,

      // Full-mode actions (same pattern as character sheet)
      rollSkill:    RfsNpcSheet._onRollSkill,
      addSkill:     RfsNpcSheet._onAddSkill,
      deleteSkill:  RfsNpcSheet._onDeleteSkill,
      addStatus:    RfsNpcSheet._onAddStatus,
      deleteStatus: RfsNpcSheet._onDeleteStatus,
    },
  };

  /** @override */
  static PARTS = {
    sheet: {
      template: "systems/roll-for-shoes/templates/actor/npc-sheet.hbs",
    },
  };

  /* -------------------------------------------- */
  /*  Context                                     */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const system  = this.actor.system;

    return {
      ...context,
      actor:      this.actor,
      system:     system,
      isEditable: this.isEditable,
      isFixed:    system.mode === "fixed",
      isFull:     system.mode === "full",
      skills:     system.skills,
      statuses:   system.statuses,
    };
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  /**
   * Toggle between fixed and full mode.
   * Preserves all data — only the sheet UI changes.
   */
  static async _onToggleMode(event, target) {
    const current = this.actor.system.mode;
    const newMode = current === "fixed" ? "full" : "fixed";
    return this.actor.update({ "system.mode": newMode });
  }

  /**
   * Roll the NPC's difficulty number to chat (for public opposed rolls).
   * In fixed mode this is just the static number. In full mode, picks best skill.
   */
  static async _onRollDifficulty(event, target) {
    const system = this.actor.system;
    if (system.mode === "fixed") {
      // Static difficulty — post to chat as a flat number
      const content = `<strong>${this.actor.name}</strong> difficulty: <strong>${system.difficulty}</strong>`;
      return ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: this.actor }),
        content,
      });
    }
  }

  static async _onRollSkill(event, target) {
    const skillId = target.dataset.skillId;
    const skill   = this.actor.getSkillById(skillId);
    if (!skill) return;
    const roll = new Roll(`${skill.level}d6`);
    await roll.evaluate();
    return roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor: this.actor }) });
  }

  /**
   * Add a new child skill under the clicked parent.
   * v14: DialogV2.input returns form data object directly.
   */
  static async _onAddSkill(event, target) {
    const parentId = target.dataset.skillId ?? this.actor.getRootSkill()?.id ?? "root";

    const result = await foundry.applications.api.DialogV2.input({
      window: { title: game.i18n.localize("RFS.Dialog.NewSkill.Title") },
      content: `<input type="text" name="skillName" placeholder="${game.i18n.localize("RFS.Dialog.NewSkill.Placeholder")}" autofocus style="width:100%">`,
      ok: { label: game.i18n.localize("RFS.Dialog.NewSkill.Confirm") },
    });

    const name = result?.skillName?.trim();
    if (!name) return;
    return this.actor.addSkill(name, parentId);
  }

  static async _onDeleteSkill(event, target) {
    return this.actor.removeSkill(target.dataset.skillId);
  }

  static async _onAddStatus(event, target) {
    return this.actor.addStatus("New Status", 0);
  }

  static async _onDeleteStatus(event, target) {
    return this.actor.removeStatus(target.dataset.statusId);
  }
}
