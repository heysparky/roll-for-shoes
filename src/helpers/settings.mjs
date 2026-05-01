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
  // Which CSS theme to load. The theme class is applied to <body> so every
  // sheet and dialog picks it up automatically.
  game.settings.register(RFS.id, "theme", {
    name: "RFS.Settings.Theme.Name",
    hint: "RFS.Settings.Theme.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: RFS.themes,
    default: RFS.defaultTheme,
    requiresReload: false, // We apply the class dynamically on change
    onChange: (value) => applyTheme(value),
  });

  // ── NPC Default Mode ───────────────────────────────────────────────────────
  // World-wide default for new NPCs. GMs can override per-actor on the sheet.
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

  // ── Apply theme on load ────────────────────────────────────────────────────
  // We read the stored setting here; onChange handles runtime switches.
  Hooks.once("ready", () => {
    const storedTheme = game.settings.get(RFS.id, "theme");
    applyTheme(storedTheme);
  });
}

/**
 * Apply a theme by toggling a data-attribute on <body>.
 * CSS files use `[data-rfs-theme="dark-factory"] { ... }` selectors,
 * which means themes stack cleanly without className pollution.
 *
 * @param {string} themeId - Key from RFS.themes
 */
export function applyTheme(themeId) {
  document.body.dataset.rfsTheme = themeId ?? RFS.defaultTheme;
}
