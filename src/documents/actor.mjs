/**
 * src/documents/actor.mjs
 * ===========================
 * RfsActor extends the core Actor document class.
 *
 * This is the place for:
 *  - Document-level derived data (things the TypeDataModel can't do alone)
 *  - Roll methods called by the sheet (rollSkill, rollOpposed, etc.)
 *  - Helper methods used by macros or other documents
 *
 * NOT the place for:
 *  - UI logic (that goes in sheets/)
 *  - Pure roll math (that goes in rolls/)
 *  - Schema definitions (that's actor-data.mjs)
 */

export class RfsActor extends Actor {

  /* -------------------------------------------- */
  /*  Data Preparation                            */
  /* -------------------------------------------- */

  /** @override */
  prepareData() {
    // Call order matters:
    // 1. super.prepareData() → clears effects, calls prepareBaseData(),
    //    prepareEmbeddedDocuments(), then prepareDerivedData() on the TypeDataModel.
    super.prepareData();
  }

  /** @override */
  prepareBaseData() {
    // Data that must be set before embedded documents (Active Effects) run.
    // For RFS v0.1: nothing needed here yet.
    super.prepareBaseData();
  }

  /** @override */
  prepareDerivedData() {
    // The TypeDataModel's prepareDerivedData() runs automatically via super.
    // Add any actor-level derived data here that depends on embedded docs.
    super.prepareDerivedData();
  }

  /* -------------------------------------------- */
  /*  Skill Tree Helpers                          */
  /* -------------------------------------------- */

  /**
   * Find a skill on this actor by its stable ID.
   * @param {string} skillId
   * @returns {object|undefined}
   */
  getSkillById(skillId) {
    return this.system.skills.find((s) => s.id === skillId);
  }

  /**
   * Return direct children of a given skill ID.
   * @param {string} parentId
   * @returns {object[]}
   */
  getSkillChildren(parentId) {
    return this.system.skills.filter((s) => s.parentId === parentId);
  }

  /**
   * Return the root "Do Anything" skill.
   * @returns {object|null}
   */
  getRootSkill() {
    return this.system.skills.find((s) => s.parentId === "") ?? null;
  }

  /* -------------------------------------------- */
  /*  Skill Mutations                             */
  /* -------------------------------------------- */

  /**
   * Add a new skill to this actor as a child of an existing skill.
   * Called after an all-6s advancement trigger.
   *
   * @param {string} name      - Name the player gives the new skill
   * @param {string} parentId  - ID of the skill it branched from
   * @returns {Promise<RfsActor>}
   */
  async addSkill(name, parentId) {
    const parent = this.getSkillById(parentId);
    if (!parent) throw new Error(`RFS | Cannot find parent skill ${parentId}`);

    const newSkill = {
      id:       foundry.utils.randomID(),
      name:     name,
      level:    parent.level + 1,
      parentId: parentId,
      notes:    "",
    };

    const updatedSkills = [...this.system.skills, newSkill];
    return this.update({ "system.skills": updatedSkills });
  }

  /**
   * Remove a skill by ID. Refuses to remove the root skill.
   * Note: does NOT recursively remove children (a design choice — stranded
   * children become visible as roots of their own sub-trees).
   *
   * @param {string} skillId
   * @returns {Promise<RfsActor>}
   */
  async removeSkill(skillId) {
    const skill = this.getSkillById(skillId);
    if (!skill) return;
    if (skill.parentId === "") {
      ui.notifications.warn(game.i18n.localize("RFS.Warn.CannotDeleteRoot"));
      return;
    }
    const updatedSkills = this.system.skills.filter((s) => s.id !== skillId);
    return this.update({ "system.skills": updatedSkills });
  }

  /* -------------------------------------------- */
  /*  XP                                          */
  /* -------------------------------------------- */

  /**
   * Add XP to this actor. Called on a failed roll.
   * @param {number} amount - Defaults to 1 per RFS rules
   * @returns {Promise<RfsActor>}
   */
  async addXp(amount = 1) {
    return this.update({ "system.xp": this.system.xp + amount });
  }

  /**
   * Spend XP. Called when the player uses XP for an advancement re-roll.
   * Prevents spending below 0.
   * @param {number} amount
   * @returns {Promise<RfsActor>}
   */
  async spendXp(amount = 1) {
    const newXp = Math.max(0, this.system.xp - amount);
    return this.update({ "system.xp": newXp });
  }

  /* -------------------------------------------- */
  /*  Statuses                                    */
  /* -------------------------------------------- */

  /**
   * Add a named status modifier to the actor.
   * @param {string} name  - Descriptive name (e.g. "Raining")
   * @param {number} value - Modifier value (negative = penalty)
   * @returns {Promise<RfsActor>}
   */
  async addStatus(name, value) {
    const newStatus = {
      id:    foundry.utils.randomID(),
      name:  name,
      value: value,
    };
    const updated = [...this.system.statuses, newStatus];
    return this.update({ "system.statuses": updated });
  }

  /**
   * Remove a status by ID.
   * @param {string} statusId
   * @returns {Promise<RfsActor>}
   */
  async removeStatus(statusId) {
    const updated = this.system.statuses.filter((s) => s.id !== statusId);
    return this.update({ "system.statuses": updated });
  }

  /* -------------------------------------------- */
  /*  Inventory                                   */
  /* -------------------------------------------- */

  /**
   * Add an item to this actor's inventory.
   * @param {string} name
   * @param {number} quantity
   * @returns {Promise<RfsActor>}
   */
  async addItem(name, quantity = 1) {
    const newItem = {
      id:       foundry.utils.randomID(),
      name:     name,
      quantity: quantity,
    };
    const updated = [...this.system.inventory, newItem];
    return this.update({ "system.inventory": updated });
  }

  /**
   * Remove an inventory item by ID.
   * @param {string} itemId
   * @returns {Promise<RfsActor>}
   */
  async removeItem(itemId) {
    const updated = this.system.inventory.filter((i) => i.id !== itemId);
    return this.update({ "system.inventory": updated });
  }

  /* -------------------------------------------- */
  /*  Roll History                                */
  /* -------------------------------------------- */

  /**
   * Prepend a roll result to this actor's history (capped at 50 entries).
   * Stored as a flag so it doesn't pollute the TypeDataModel schema.
   *
   * @param {object} entry - { skillName, skillLevel, dice, rawTotal, modifier, total, difficulty, failed, allSixes }
   */
  async addRollHistory(entry) {
    const existing = this.getFlag("roll-for-shoes", "rollHistory") ?? [];
    const updated  = [{ ...entry, timestamp: Date.now() }, ...existing].slice(0, 50);
    return this.setFlag("roll-for-shoes", "rollHistory", updated);
  }

  /* -------------------------------------------- */
  /*  getRollData                                 */
  /* -------------------------------------------- */

  /**
   * Provide roll data for inline rolls in journal/chat.
   * Extends the base implementation so macros can do @xp, @skillCount, etc.
   * @override
   */
  getRollData() {
    const data = super.getRollData();
    if (this.system) {
      data.xp = this.system.xp;
      data.skillCount = this.system.skills?.length ?? 0;
      data.totalStatusModifier = this.system.totalStatusModifier ?? 0;
    }
    return data;
  }
}
