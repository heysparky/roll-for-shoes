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
 */

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
      submitOnChange: true,  // Auto-save on every input change — no submit button needed
      closeOnSubmit: false,
    },
    actions: {
      // Skill actions
      rollSkill:    RfsCharacterSheet._onRollSkill,
      addSkill:     RfsCharacterSheet._onAddSkill,
      deleteSkill:  RfsCharacterSheet._onDeleteSkill,
      editSkill:    RfsCharacterSheet._onEditSkill,

      // XP actions
      spendXp:      RfsCharacterSheet._onSpendXp,

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

  /**
   * _prepareContext is the v14 equivalent of getData().
   * Returns the data object passed to the Handlebars template.
   * @override
   */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);

    const actor = this.actor;
    const system = actor.system;

    return {
      ...context,

      // ── Actor basics ───────────────────────────────────────────────────
      actor:    actor,
      system:   system,
      isEditable: this.isEditable,

      // ── Skills ────────────────────────────────────────────────────────
      // Pass the flat array; the Handlebars template + helpers render the tree.
      // Root skill is always first for reliable tree traversal.
      skills: this._sortSkillsForDisplay(system.skills),
      rootSkillId: system.rootSkill?.id ?? "root",

      // ── Statuses ──────────────────────────────────────────────────────
      statuses: system.statuses,
      totalStatusModifier: system.totalStatusModifier,

      // ── XP ────────────────────────────────────────────────────────────
      xp: system.xp,

      // ── Localisation ──────────────────────────────────────────────────
      // Pass i18n keys pre-resolved so the template stays clean.
      labels: {
        xp: game.i18n.localize("RFS.Label.XP"),
        skills: game.i18n.localize("RFS.Label.Skills"),
        statuses: game.i18n.localize("RFS.Label.Statuses"),
        biography: game.i18n.localize("RFS.Label.Biography"),
      },
    };
  }

  /**
   * Sort skills so the root is first and children follow their parents.
   * This gives the Handlebars tree helper a predictable traversal order.
   * @param {object[]} skills
   * @returns {object[]}
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

    // Any orphaned skills (parentId points to a deleted skill) go at the end
    const orphans = skills.filter((s) => !result.includes(s));
    return [...result, ...orphans];
  }

  /* -------------------------------------------- */
  /*  Action Handlers (static, bound by AppV2)    */
  /* -------------------------------------------- */

  /**
   * Roll a skill. The skill ID is stored in data-skill-id on the element.
   * Delegates to rolls/skill-roll.mjs (Milestone 5).
   */
  static async _onRollSkill(event, target) {
    const skillId = target.dataset.skillId;
    const skill   = this.actor.getSkillById(skillId);
    if (!skill) return;

    // TODO (Milestone 5): import and call RfsSkillRoll.roll(this.actor, skill)
    // For now: a placeholder roll so the button does something visible.
    const roll = new Roll(`${skill.level}d6`);
    await roll.evaluate();

    const content = `<strong>${skill.name} ${skill.level}</strong><br>
      Rolled: ${roll.result} = <strong>${roll.total}</strong>`;

    return roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      flavor: content,
    });
  }

  /**
   * Add a new child skill under the clicked parent.
   */
  static async _onAddSkill(event, target) {
    const parentId = target.dataset.skillId ?? this.actor.getRootSkill()?.id ?? "root";
    const parent   = this.actor.getSkillById(parentId);
    if (!parent) return;

    // DialogV2 for entering the new skill name (Milestone 6 will flesh this out)
    const name = await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.localize("RFS.Dialog.NewSkill.Title") },
      content: `<input type="text" name="skillName"
                  placeholder="${game.i18n.localize("RFS.Dialog.NewSkill.Placeholder")}"
                  autofocus style="width:100%">`,
      ok: {
        label: game.i18n.localize("RFS.Dialog.NewSkill.Confirm"),
        callback: (event, button, dialog) =>
          dialog.querySelector("[name=skillName]").value.trim(),
      },
    });

    if (!name) return;
    return this.actor.addSkill(name, parentId);
  }

  /**
   * Delete a skill by ID. Prevented on the root skill.
   */
  static async _onDeleteSkill(event, target) {
    const skillId = target.dataset.skillId;
    return this.actor.removeSkill(skillId);
  }

  /**
   * Edit a skill name inline. (Placeholder — will use inline editing in Milestone 4)
   */
  static async _onEditSkill(event, target) {
    // Handled via submitOnChange on the input directly — this action is a
    // fallback for explicit save buttons if we add them later.
  }

  /**
   * Spend 1 XP. Disabled if actor has 0 XP.
   */
  static async _onSpendXp(event, target) {
    if (this.actor.system.xp < 1) {
      ui.notifications.warn(game.i18n.localize("RFS.Warn.NoXpToSpend"));
      return;
    }
    return this.actor.spendXp(1);
  }

  /**
   * Add a new status. Prompts for name and value.
   */
  static async _onAddStatus(event, target) {
    // TODO (Milestone 9): Full DialogV2 with name + value fields
    // Stub for Milestone 1: adds a placeholder status
    return this.actor.addStatus("New Status", 0);
  }

  /**
   * Delete a status by ID.
   */
  static async _onDeleteStatus(event, target) {
    const statusId = target.dataset.statusId;
    return this.actor.removeStatus(statusId);
  }
}
