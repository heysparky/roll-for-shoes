/**
 * src/helpers/config.mjs
 * ==========================
 * Central configuration constants for the Roll for Shoes system.
 *
 * Keep game-rule constants here (not scattered in data models or sheets)
 * so they're easy to find and adjust without hunting through files.
 */

export const RFS = {
  // ── Identity ───────────────────────────────────────────────────────────────
  id: "roll-for-shoes",

  // ── Core Rules ────────────────────────────────────────────────────────────
  rules: {
    /** Every character starts with exactly this skill. Cannot be deleted. */
    rootSkillName: "Do Anything",
    rootSkillLevel: 1,

    /**
     * Rolling all 6s on a skill check triggers advancement.
     * New skill is level = parent level + 1.
     */
    advancementTrigger: "allSixes",

    /** Each failed roll earns this many XP. */
    xpPerFailure: 1,

    /** Die type used for all rolls. */
    dieType: "d6",
  },

  // ── Actor Types ───────────────────────────────────────────────────────────
  actorTypes: {
    character: "RFS.ActorType.Character",
    npc: "RFS.ActorType.Npc",
  },

  // ── NPC Modes ─────────────────────────────────────────────────────────────
  // NPCs can run under full PC rules (skill tree, advancement, XP)
  // or fixed mode (a flat difficulty number the GM sets).
  npcModes: {
    fixed: "RFS.NpcMode.Fixed",
    full: "RFS.NpcMode.Full",
  },

  // ── Theme Registry ────────────────────────────────────────────────────────
  // Themes are CSS files that override the custom properties defined in
  // rfs-base.css. Add an entry here + a corresponding CSS file in
  // styles/themes/ to register a new theme.
  themes: {
    "dark-factory": "RFS.Theme.DarkFactory",
    "clean-light":  "RFS.Theme.CleanLight",
    "vellum":       "RFS.Theme.Vellum",
  },

  // ── Default Theme ─────────────────────────────────────────────────────────
  defaultTheme: "vellum",

  // ── DC Tiers ──────────────────────────────────────────────────────────────
  // Named difficulty steps shown on the DC tracker bar.
  // Keyed by difficultyMode setting value.
  dcTiers: {
    standard: [
      { label: "RFS.Difficulty.Easy",      dc: 3  },
      { label: "RFS.Difficulty.Medium",    dc: 6  },
      { label: "RFS.Difficulty.Hard",      dc: 9  },
      { label: "RFS.Difficulty.Legendary", dc: 18 },
      { label: "RFS.Difficulty.Mythic",    dc: 24 },
    ],
    moreXp: [
      { label: "RFS.Difficulty.Easy",      dc: 4  },
      { label: "RFS.Difficulty.Medium",    dc: 8  },
      { label: "RFS.Difficulty.Hard",      dc: 12 },
      { label: "RFS.Difficulty.Legendary", dc: 18 },
      { label: "RFS.Difficulty.Mythic",    dc: 24 },
    ],
  },
};

/**
 * Returns the label of the highest tier whose DC anchor is ≤ the given DC.
 * Falls back to the first tier if DC is below all anchors.
 * Used to highlight the active chip/rail/menu item on the target widget.
 *
 * @param {number} dc     - The current global DC
 * @param {Array}  tiers  - Array of { label, dc } from RFS.dcTiers[mode]
 * @returns {string}      - The matching tier's label key (e.g. "RFS.Difficulty.Hard")
 */
export function tierOf(dc, tiers) {
  let result = tiers[0];
  for (const tier of tiers) {
    if (dc >= tier.dc) result = tier;
  }
  return result.label;
}
