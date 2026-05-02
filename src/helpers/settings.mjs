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

  // ── Active Challenge ───────────────────────────────────────────────────────
  // Stores the currently active GM challenge so skill rolls can pick up
  // the correct DC. Cleared automatically when all called tokens have rolled
  // or when the challenge times out.
  //
  // Shape: {
  //   challengeId: string,   — unique ID matching the chat card flag
  //   dc:          number,   — the rolled or static difficulty
  //   tokenIds:    string[], — token IDs called to roll
  //   rolledIds:   string[], — token IDs that have already rolled
  //   timestamp:   number,   — Date.now() when the challenge was posted
  // }
  //
  // ╔══════════════════════════════════════════════════════════╗
  // ║  CHALLENGE TIMEOUT — change the default value below     ║
  // ║  Default: 3 minutes (180000 ms)                         ║
  // ║  To adjust: edit RFS_CHALLENGE_TIMEOUT_MS in config.mjs ║
  // ╚══════════════════════════════════════════════════════════╝
  game.settings.register(RFS.id, "activeChallenge", {
    scope:  "world",
    config: false,   // Hidden from the settings UI — managed programmatically
    type:   Object,
    default: null,
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

/* -------------------------------------------- */
/*  Challenge Setting Helpers                   */
/* -------------------------------------------- */

/**
 * Set the active challenge. Called by RfsChallengeDialog when a card posts.
 *
 * @param {object} challenge  - { challengeId, dc, tokenIds }
 */
export async function setActiveChallenge(challenge) {
  await game.settings.set(RFS.id, "activeChallenge", {
    ...challenge,
    rolledIds: [],
    timestamp: Date.now(),
  });
}

/**
 * Get the active challenge if one exists and hasn't timed out.
 * Returns null if there's no challenge or it has expired.
 *
 * Timeout is checked here — no timer needed, just a staleness check
 * every time a roll happens.
 *
 * @returns {object|null}
 */
export function getActiveChallenge() {
  const challenge = game.settings.get(RFS.id, "activeChallenge");
  if (!challenge) return null;

  // ╔══════════════════════════════════════════════════════════╗
  // ║  CHALLENGE TIMEOUT VALUE                                 ║
  // ║  Default: 3 minutes. Increase for slower tables.        ║
  // ║  Move to RFS.challengeTimeoutMs in config.mjs to make   ║
  // ║  this a GM-configurable setting in the future.          ║
  // ╚══════════════════════════════════════════════════════════╝
  const TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes

  const age = Date.now() - (challenge.timestamp ?? 0);
  if (age > TIMEOUT_MS) {
    // Expired — clear it silently and return null
    // Fire-and-forget: don't await so rolls aren't blocked
    clearActiveChallenge();
    return null;
  }

  return challenge;
}

/**
 * Record that a token has rolled for the active challenge.
 * If all called tokens have now rolled, clears the challenge automatically.
 *
 * @param {string} tokenId
 */
export async function recordChallengeRoll(tokenId) {
  const challenge = getActiveChallenge();
  if (!challenge) return;

  const rolledIds = [...(challenge.rolledIds ?? []), tokenId];

  // Check if everyone has rolled
  const allRolled = challenge.tokenIds.every(id => rolledIds.includes(id));

  if (allRolled) {
    await clearActiveChallenge();
  } else {
    await game.settings.set(RFS.id, "activeChallenge", {
      ...challenge,
      rolledIds,
    });
  }
}

/**
 * Clear the active challenge. Called on timeout, completion, or manually.
 */
export async function clearActiveChallenge() {
  await game.settings.set(RFS.id, "activeChallenge", null);
}
