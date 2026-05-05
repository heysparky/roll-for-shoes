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

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

export class RfsCharacterSheet extends HandlebarsApplicationMixin(ActorSheetV2) {

  /* -------------------------------------------- */
  /*  Static Configuration                        */
  /* -------------------------------------------- */

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["roll-for-shoes", "sheet", "actor", "character"],
    position: { width: 600, height: 700 },
    resizable: true,
    form: {
      submitOnChange: true,
      closeOnSubmit: false,
    },
    actions: {
      // Skill actions
      rollSkill:    RfsCharacterSheet._onRollSkill,
      addSkill:     RfsCharacterSheet._onAddSkill,    // GM override, no UI button
      deleteSkill:  RfsCharacterSheet._onDeleteSkill, // GM override, no UI button

      // Status actions
      addStatus:    RfsCharacterSheet._onAddStatus,
      deleteStatus: RfsCharacterSheet._onDeleteStatus,
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

    return {
      ...context,
      actor,
      system,
      isEditable: this.isEditable,
      skills:     this._sortSkillsForDisplay(system.skills),
      rootSkillId: system.rootSkill?.id ?? "root",
      statuses:   system.statuses,
      totalStatusModifier: system.totalStatusModifier,
      xp:         system.xp,
      labels: {
        xp:        game.i18n.localize("RFS.Label.XP"),
        skills:    game.i18n.localize("RFS.Label.Skills"),
        statuses:  game.i18n.localize("RFS.Label.Statuses"),
        biography: game.i18n.localize("RFS.Label.Biography"),
      },
    };
  }

  /**
   * Sort skills root-first, children following parents.
   */
  _sortSkillsForDisplay(skills) {
    const root = skills.find((s) => s.parentId === "");
    if (!root) return skills;

    const result = [];
    const addWithChildren = (parentId) => {
      const matches = skills.filter((s) => s.parentId === parentId);
      for (const s of matches) {
        result.push(s);
        addWithChildren(s.id);
      }
    };

    result.push(root);
    addWithChildren(root.id);

    const orphans = skills.filter((s) => !result.includes(s));
    return [...result, ...orphans];
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

    return data;
  }

  /* -------------------------------------------- */
  /*  Action Handlers                             */
  /* -------------------------------------------- */

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
}
