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

  // ── Active Challenge ───────────────────────────────────────────────────────
  // Stores the currently active GM challenge so skill rolls can pick up
  // the correct DC and widget cards know what challenge they belong to.
  //
  // Shape: {
  //   challengeId:  string,    — unique ID matching the challenge card flag
  //   dc:           number,    — the rolled or static difficulty
  //   dcVisible:    boolean,   — whether players can see the DC before rolling
  //   prompt:       string,    — GM's situation prompt shown on player widget
  //   tokenIds:     string[],  — token IDs called to roll
  //   rolledIds:    string[],  — token IDs that have already rolled
  //   widgetIds:    object,    — { [tokenId]: messageId } — player widget cards
  //   challengeCardId: string, — messageId of the shared challenge card
  //   timestamp:    number,    — Date.now() when the challenge was posted
  // }
  game.settings.register(RFS.id, "activeChallenge", {
    scope:  "world",
    config: false,
    type:   Object,
    default: null,
  });

  // ── Apply theme on load ────────────────────────────────────────────────────
  Hooks.once("ready", () => {
    const storedTheme = game.settings.get(RFS.id, "theme");
    applyTheme(storedTheme);
  });
}

/**
 * Apply a theme by toggling a data-attribute on <body>.
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
 * @param {object} challenge  - { challengeId, dc, dcVisible, prompt, tokenIds, challengeCardId }
 */
export async function setActiveChallenge(challenge) {
  await game.settings.set(RFS.id, "activeChallenge", {
    ...challenge,
    rolledIds: [],
    widgetIds: {},
    timestamp: Date.now(),
  });
}

/**
 * Get the active challenge if one exists and hasn't timed out.
 * Returns null if there's no challenge or it has expired.
 *
 * @returns {object|null}
 */
export function getActiveChallenge() {
  const challenge = game.settings.get(RFS.id, "activeChallenge");
  if (!challenge) return null;

  const TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes
  const age = Date.now() - (challenge.timestamp ?? 0);
  if (age > TIMEOUT_MS) {
    clearActiveChallenge();
    return null;
  }

  return challenge;
}

/**
 * Record that a token has rolled for the active challenge.
 * Updates the challenge card row and clears the challenge if all have rolled.
 *
 * @param {string} tokenId
 * @param {object} rollResult  - { actorName, skillName, skillLevel, dice, total, allSixes, failed }
 */
export async function recordChallengeRoll(tokenId, rollResult) {
  const challenge = getActiveChallenge();
  if (!challenge) return;

  const rolledIds = [...(challenge.rolledIds ?? []), tokenId];
  const results   = { ...(challenge.results ?? {}), [tokenId]: rollResult };

  const allRolled = challenge.tokenIds.every(id => rolledIds.includes(id));

  const updated = { ...challenge, rolledIds, results };

  if (allRolled) {
    // Keep the challenge data for card rendering but mark it complete
    updated.complete = true;
  }

  await game.settings.set(RFS.id, "activeChallenge", updated);

  // Rebuild the challenge card so the new result row appears
  await rebuildChallengeCard(updated);

  if (allRolled) {
    // Small delay so the final card update lands before we clear
    setTimeout(() => clearActiveChallenge(), 2000);
  }
}

/**
 * Rebuild the shared challenge card with current results.
 * Called every time a player rolls so the card updates in place.
 *
 * @param {object} challenge  - current challenge state from settings
 */
export async function rebuildChallengeCard(challenge) {
  if (!challenge?.challengeCardId) return;
  const message = game.messages.get(challenge.challengeCardId);
  if (!message) return;

  const content = buildChallengeCardContent(challenge);
  await message.update({ content });
}

/**
 * Build the HTML content for the shared challenge card.
 * Called on initial post and on every roll update.
 *
 * @param {object} challenge
 * @returns {string}
 */
export function buildChallengeCardContent(challenge) {
  const {
    prompt, dc, dcVisible, tokenIds, results = {}, complete = false,
  } = challenge;

  const dcDisplay = dcVisible
    ? `<span class="rfs-challenge__dc-value">${game.i18n.format("RFS.Chat.Challenge.DcValue", { dc })}</span>`
    : `<span class="rfs-challenge__dc-hidden">${game.i18n.localize("RFS.Chat.Challenge.DcHidden")}</span>`;

  const rows = tokenIds.map(tokenId => {
    const result = results[tokenId];

    if (!result) {
      // Player hasn't rolled yet
      return `
        <tr class="rfs-challenge__row rfs-challenge__row--pending">
          <td class="rfs-challenge__name">${result?.actorName ?? "…"}</td>
          <td class="rfs-challenge__skill">—</td>
          <td class="rfs-challenge__dice">—</td>
          <td class="rfs-challenge__outcome rfs-challenge__outcome--pending">
            ${game.i18n.localize("RFS.Chat.Challenge.Pending")}
          </td>
        </tr>`;
    }

    const diceHtml = result.dice
      .map(d => `<span class="rfs-die${d === 6 ? " rfs-die--six" : ""}">${d}</span>`)
      .join("");

    const outcomeClass = result.failed ? "rfs-challenge__outcome--fail" : "rfs-challenge__outcome--success";
    const outcomeText  = result.failed
      ? game.i18n.localize("RFS.Chat.Failure")
      : game.i18n.localize("RFS.Chat.Success");

    // All-sixes: badge on the shared card only.
    // The Claim Skill action happens on the player's personal advancement widget card.
    // Once claimed, show the new skill name in place of the pending note.
    const allSixesHtml = result.allSixes ? `
      <div class="rfs-challenge__allsixes">&#x2726; ${
        result.skillClaimed
          ? result.claimedSkillName ?? ""
          : `<em>${game.i18n.localize("RFS.Chat.Challenge.AdvancementPending")}</em>`
      }</div>` : "";

    const nameBtn = `<button type="button" class="rfs-challenge__name-btn"
        data-action="rfsOpenChallengeDialog"
        data-token-id="${tokenId}"
        data-actor-id="${result.actorId}"
        data-challenge-id="${challenge.challengeId}">${result.actorName}</button>`;

    return `
      <tr class="rfs-challenge__row rfs-challenge__row--done">
        <td class="rfs-challenge__name">${nameBtn}</td>
        <td class="rfs-challenge__skill">${result.skillName} (${"&#x25cf;".repeat(result.skillLevel)})</td>
        <td class="rfs-challenge__dice">${diceHtml}</td>
        <td class="rfs-challenge__outcome ${outcomeClass}">
          ${outcomeText}
          ${allSixesHtml}
        </td>
      </tr>`;
  });

  // Pending rows for tokens with no result yet need actor names.
  // We look them up from the canvas tokens.
  const pendingRows = tokenIds
    .filter(id => !results[id])
    .map(id => {
      const token   = canvas.tokens?.get(id);
      const actor   = token?.actor;
      const name    = token?.name ?? game.i18n.localize("RFS.Chat.Challenge.UnknownToken");
      const actorId = actor?.id ?? "";

      const nameBtn = `<button type="button" class="rfs-challenge__name-btn"
          data-action="rfsOpenChallengeDialog"
          data-token-id="${id}"
          data-actor-id="${actorId}"
          data-challenge-id="${challenge.challengeId}">${name}</button>`;

      return `
        <tr class="rfs-challenge__row rfs-challenge__row--pending">
          <td class="rfs-challenge__name">${nameBtn}</td>
          <td class="rfs-challenge__skill">—</td>
          <td class="rfs-challenge__dice">—</td>
          <td class="rfs-challenge__outcome rfs-challenge__outcome--pending">
            ${game.i18n.localize("RFS.Chat.Challenge.Pending")}
          </td>
        </tr>`;
    });

  // Merge: done rows first in tokenId order, pending rows fill the rest
  const allRows = tokenIds.map(id => {
    if (results[id]) {
      return rows[tokenIds.indexOf(id)];
    }
    return pendingRows.shift() ?? "";
  });

  const completeNote = complete
    ? `<div class="rfs-challenge__complete">${game.i18n.localize("RFS.Chat.Challenge.Complete")}</div>`
    : "";

  return `
    <div class="rfs-challenge" data-challenge-id="${challenge.challengeId}">
      <div class="rfs-challenge__header">
        <strong>${game.i18n.localize("RFS.Chat.Challenge.Title")}</strong>
      </div>
      <div class="rfs-challenge__prompt">${prompt}</div>
      <div class="rfs-challenge__dc">${dcDisplay}</div>
      <table class="rfs-challenge__table">
        <thead>
          <tr>
            <th>${game.i18n.localize("RFS.Chat.Challenge.ColName")}</th>
            <th>${game.i18n.localize("RFS.Chat.Challenge.ColSkill")}</th>
            <th>${game.i18n.localize("RFS.Chat.Challenge.ColDice")}</th>
            <th>${game.i18n.localize("RFS.Chat.Challenge.ColOutcome")}</th>
          </tr>
        </thead>
        <tbody>
          ${allRows.join("")}
        </tbody>
      </table>
      ${completeNote}
    </div>`;
}

/**
 * Clear the active challenge.
 */
export async function clearActiveChallenge() {
  await game.settings.set(RFS.id, "activeChallenge", null);
}
