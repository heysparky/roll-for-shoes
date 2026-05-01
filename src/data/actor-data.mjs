/**
 * src/data/actor-data.mjs
 * ===========================
 * TypeDataModel definitions for Roll for Shoes actor types.
 *
 * v14 note: template.json only declares type names. All field schemas live
 * here in defineSchema(). The legacy template.json schema format entered
 * deprecation in v14.352 — do not add field definitions there.
 *
 * Data flow:
 *   actor.system        → the instantiated TypeDataModel
 *   actor.system.skills → the ArrayField of skill SchemaFields
 *   actor.system.xp     → NumberField
 *   actor.system.statuses → ArrayField of status SchemaFields
 */

const {
  StringField,
  NumberField,
  BooleanField,
  ArrayField,
  SchemaField,
  HTMLField,
  ObjectField,
} = foundry.data.fields;

/* -------------------------------------------- */
/*  Shared skill schema (reused in both types)  */
/* -------------------------------------------- */

/**
 * A single RFS skill node.
 *
 * Skills form a tree structure through parentId. The root skill
 * ("Do Anything 1") always has parentId = "".
 *
 * id       → stable UUID, never changes when skill is renamed
 * name     → player-entered skill name (e.g. "Boots of Kicking")
 * level    → number of dice rolled (also how many d6s in the pool)
 * parentId → id of the skill this grew from; "" for root
 * notes    → optional free text, shown on hover/expand
 */
function skillSchema() {
  return new SchemaField({
    id:       new StringField({ required: true, blank: false, initial: () => foundry.utils.randomID() }),
    name:     new StringField({ required: true, blank: false, initial: "New Skill" }),
    level:    new NumberField({ required: true, integer: true, min: 1, max: 10, initial: 1 }),
    parentId: new StringField({ required: true, blank: true, initial: "" }),
    notes:    new StringField({ required: false, blank: true, initial: "" }),
  });
}

/* -------------------------------------------- */
/*  Status schema                               */
/* -------------------------------------------- */

/**
 * A named modifier applied to the actor.
 *
 * Statuses are added narratively and remain until removed.
 * value: positive = bonus, negative = penalty
 * e.g. { name: "Raining", value: -4 }
 *      { name: "Clean Shoe", value: 2 }
 */
function statusSchema() {
  return new SchemaField({
    id:    new StringField({ required: true, blank: false, initial: () => foundry.utils.randomID() }),
    name:  new StringField({ required: true, blank: false, initial: "New Status" }),
    value: new NumberField({ required: true, integer: true, initial: 0 }),
  });
}

/* -------------------------------------------- */
/*  CharacterData                               */
/* -------------------------------------------- */

export class CharacterData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      // ── Core skill tree ──────────────────────────────────────────────────
      // Stored as a flat array. The tree structure is derived from parentId.
      // The root "Do Anything 1" is always skills[0] with parentId="".
      // UI sorts and renders them hierarchically from this flat list.
      skills: new ArrayField(skillSchema(), {
        required: true,
        initial: [
          // Every new character starts with exactly this skill.
          {
            id: "root",
            name: "Do Anything",
            level: 1,
            parentId: "",
            notes: "",
          },
        ],
      }),

      // ── XP ───────────────────────────────────────────────────────────────
      // Gained on failure (1 per fail). Spent to turn a die to 6 for
      // advancement purposes only — not for success.
      xp: new NumberField({ required: true, integer: true, min: 0, initial: 0 }),

      // ── Statuses ─────────────────────────────────────────────────────────
      // Active modifiers. Each status adds its value to relevant rolls.
      // GM and players can add/remove these freely during play.
      statuses: new ArrayField(statusSchema(), {
        required: true,
        initial: [],
      }),

      // ── Biography ────────────────────────────────────────────────────────
      // Freeform character notes. HTMLField allows rich text via ProseMirror.
      biography: new HTMLField({ required: false, blank: true, initial: "" }),
    };
  }

  /* -------------------------------------------- */
  /*  Derived Data                                */
  /* -------------------------------------------- */

  prepareDerivedData() {
    super.prepareDerivedData();

    // Convenience: total status modifier (sum of all status values).
    // Useful for roll logic to grab in one call.
    this.totalStatusModifier = this.statuses.reduce((sum, s) => sum + s.value, 0);

    // Convenience: root skill (always "Do Anything", parentId = "")
    this.rootSkill = this.skills.find((s) => s.parentId === "") ?? null;

    // Convenience: skill count by level, useful for sheet display.
    this.skillsByLevel = this.skills.reduce((acc, s) => {
      acc[s.level] = (acc[s.level] ?? 0) + 1;
      return acc;
    }, {});
  }
}

/* -------------------------------------------- */
/*  NpcData                                     */
/* -------------------------------------------- */

/**
 * NPCs have two modes, toggled per-actor:
 *
 * "fixed" mode → The NPC has a single flat difficulty number.
 *   The GM sets `difficulty` and players roll against it.
 *   No skill tree, no XP, no advancement.
 *   Fast to set up, good for environmental hazards and mooks.
 *
 * "full" mode → The NPC uses full PC rules (skill tree, XP, advancement).
 *   Good for named rivals, recurring antagonists, or ally NPCs.
 *   The mode field is on the NPC; the sheet shows different UI per mode.
 */
export class NpcData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      // ── Mode toggle ───────────────────────────────────────────────────────
      // "fixed" | "full"  (see RFS.npcModes in config.mjs)
      mode: new StringField({
        required: true,
        blank: false,
        initial: "fixed",
        choices: ["fixed", "full"],
      }),

      // ── Fixed mode fields ─────────────────────────────────────────────────
      // Only used when mode === "fixed".
      // difficulty: the static number players must beat with their roll.
      // description: short flavour text for the NPC.
      difficulty: new NumberField({ required: true, integer: true, min: 0, initial: 6 }),
      description: new HTMLField({ required: false, blank: true, initial: "" }),

      // ── Full mode fields ──────────────────────────────────────────────────
      // Identical schema to CharacterData. Only meaningful when mode === "full".
      // We include them always so the data model is consistent; the sheet
      // simply hides them when mode === "fixed".
      skills: new ArrayField(skillSchema(), {
        required: true,
        initial: [
          {
            id: "root",
            name: "Do Anything",
            level: 1,
            parentId: "",
            notes: "",
          },
        ],
      }),
      xp:       new NumberField({ required: true, integer: true, min: 0, initial: 0 }),
      statuses: new ArrayField(statusSchema(), { required: true, initial: [] }),
    };
  }

  prepareDerivedData() {
    super.prepareDerivedData();

    if (this.mode === "full") {
      this.totalStatusModifier = this.statuses.reduce((sum, s) => sum + s.value, 0);
      this.rootSkill = this.skills.find((s) => s.parentId === "") ?? null;
    }
  }

  /** Convenience getter: is this NPC running under PC rules? */
  get isFullMode() {
    return this.mode === "full";
  }
}
