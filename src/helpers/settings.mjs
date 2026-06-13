/**
 * src/helpers/settings.mjs
 * ============================
 * Registers all Roll for Shoes world and client settings.
 *
 * World settings  → stored in the DB, shared across all players.
 * Client settings → stored in localStorage, per-device.
 *
 * Call this inside Hooks.once("init") before sheets are registered.
 */

import { RFS } from "./config.mjs";

export function registerSystemSettings() {

  // ── Theme ──────────────────────────────────────────────────────────────────
  game.settings.register(RFS.id, "theme", {
    name: "RFS.Settings.Theme.Name",
    hint: "RFS.Settings.Theme.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: RFS.themes,
    default: RFS.defaultTheme,
    requiresReload: false,
    onChange: (value) => applyTheme(value),
  });

  // ── NPC Default Mode ───────────────────────────────────────────────────────
  game.settings.register(RFS.id, "npcDefaultMode", {
    name: "RFS.Settings.NpcMode.Name",
    hint: "RFS.Settings.NpcMode.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: RFS.npcModes,
    default: "fixed",
    requiresReload: false,
  });

  // ── Splash Audience ────────────────────────────────────────────────────────
  game.settings.register(RFS.id, "splashAudience", {
    name: "RFS.Settings.SplashAudience.Name",
    hint: "RFS.Settings.SplashAudience.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      "roller":    "RFS.Settings.SplashAudience.Roller",
      "roller_gm": "RFS.Settings.SplashAudience.RollerGm",
      "all":       "RFS.Settings.SplashAudience.All",
    },
    default: "roller",
    requiresReload: false,
  });

  // ── Difficulty Mode ────────────────────────────────────────────────────────
  game.settings.register(RFS.id, "difficultyMode", {
    name: "RFS.Settings.DifficultyMode.Name",
    hint: "RFS.Settings.DifficultyMode.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      "standard": "RFS.Settings.DifficultyMode.Standard",
      "moreXp":   "RFS.Settings.DifficultyMode.MoreXp",
    },
    default: "standard",
    requiresReload: false,
  });

  // ── Sheet Text Size ────────────────────────────────────────────────────────
  game.settings.register(RFS.id, "sheetTextSize", {
    name: "RFS.Settings.SheetTextSize.Name",
    hint: "RFS.Settings.SheetTextSize.Hint",
    scope: "client",
    config: true,
    type: String,
    choices: {
      "12px": "RFS.Settings.SheetTextSize.12",
      "13px": "RFS.Settings.SheetTextSize.13",
      "14px": "RFS.Settings.SheetTextSize.14",
      "15px": "RFS.Settings.SheetTextSize.15",
      "16px": "RFS.Settings.SheetTextSize.16",
      "18px": "RFS.Settings.SheetTextSize.18",
    },
    default: "14px",
    requiresReload: false,
    onChange: (value) => applySheetTextSize(value),
  });

  // ── Target Name Picker ────────────────────────────────────────────────────
  // Which UI surface the GM uses to jump the DC to a named tier.
  game.settings.register(RFS.id, "targetNamePicker", {
    name: "RFS.Settings.TargetNamePicker.Name",
    hint: "RFS.Settings.TargetNamePicker.Hint",
    scope:  "world",
    config: true,
    type:   String,
    choices: {
      "none":  "RFS.Settings.TargetNamePicker.None",
      "chips": "RFS.Settings.TargetNamePicker.Chips",
      "menu":  "RFS.Settings.TargetNamePicker.Menu",
      "rail":  "RFS.Settings.TargetNamePicker.Rail",
    },
    default: "chips",
    requiresReload: false,
    onChange: () => game.rfs?.dcTracker?.render(),
  });

  // ── Sync Token Name ───────────────────────────────────────────────────────
  game.settings.register(RFS.id, "syncTokenName", {
    name: "RFS.Settings.SyncTokenName.Name",
    hint: "RFS.Settings.SyncTokenName.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    requiresReload: false,
  });

  // ── Global DC ─────────────────────────────────────────────────────────────
  // The room-temperature difficulty shown on the DC tracker bar.
  // GMs adjust it via the tracker; all clients read it when a skill is rolled.
  game.settings.register(RFS.id, "globalDc", {
    scope:   "world",
    config:  false,
    type:    Number,
    default: 4,
    onChange: () => game.rfs?.dcTracker?.render(),
  });

  // ── Apply theme and text size on load ─────────────────────────────────────
  Hooks.once("ready", () => {
    applyTheme(game.settings.get(RFS.id, "theme"));
    applySheetTextSize(game.settings.get(RFS.id, "sheetTextSize"));
  });
}

/**
 * Apply a theme by toggling a data-attribute on <body>.
 * @param {string} themeId - Key from RFS.themes
 */
export function applyTheme(themeId) {
  document.body.dataset.rfsTheme = themeId ?? RFS.defaultTheme;
}

/**
 * Apply the sheet body text size by setting a CSS custom property on :root.
 * @param {string} size - e.g. "14px"
 */
export function applySheetTextSize(size) {
  document.documentElement.style.setProperty("--rfs-sheet-font-size", size ?? "14px");
}

/* -------------------------------------------- */
/*  Advancement Announcement Card               */
/* -------------------------------------------- */

/**
 * Build the HTML for the blingy skill-claimed announcement card.
 * Posted publicly to chat whenever a skill is gained (natural or XP-bought).
 *
 * @param {string}  actorName
 * @param {string}  newSkillName
 * @param {string}  parentSkillName
 * @param {number}  newLevel
 * @param {boolean} xpSpent
 * @param {number}  xpCost
 * @returns {string}
 */
export function buildAdvancementCardContent(actorName, newSkillName, parentSkillName, newLevel, xpSpent = false, xpCost = 0) {
  const meta = game.i18n.format("RFS.Chat.AdvancementCard.Meta", { parent: parentSkillName });

  return `<div class="rfs-advancement">
    <div class="rfs-advancement__header">
      <span class="rfs-advancement__mark">✦</span>
      <span class="rfs-advancement__title">${game.i18n.localize("RFS.Chat.AdvancementCard.Title")}</span>
      <span class="rfs-advancement__mark">✦</span>
    </div>
    <div class="rfs-advancement__body">
      <div class="rfs-advancement__actor">${actorName}</div>
      <div class="rfs-advancement__skill">${newSkillName}</div>
      <div class="rfs-advancement__meta">${meta}</div>
    </div>
  </div>`;
}
