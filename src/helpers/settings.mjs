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
  const { dc, dcVisible, prompt, tokenIds, results = {}, complete = false } = challenge;

  const dcDisplay = dcVisible
    ? `<span class="rfs-challenge__dc">DC ${dc}</span>`
    : `<span class="rfs-challenge__dc rfs-challenge__dc--hidden">${game.i18n.localize("RFS.Chat.Challenge.DcHidden")}</span>`;

  const promptHtml = prompt
    ? `<div class="rfs-challenge__prompt">${prompt}</div>`
    : "";

  const rolledCount = tokenIds.filter(id => results[id]).length;
  const total       = tokenIds.length;
  const dotClass    = complete ? "rfs-challenge__status-dot--complete" : "rfs-challenge__status-dot--pulsing";
  const statusText  = complete
    ? game.i18n.localize("RFS.Chat.Challenge.Complete")
    : `${rolledCount} / ${total} ${game.i18n.localize("RFS.Chat.Challenge.Rolled")}`;

  const playerRows = tokenIds.map(tokenId => {
    const result = results[tokenId];

    if (!result) {
      const token   = canvas.tokens?.get(tokenId);
      const actor   = token?.actor;
      const name    = token?.name ?? game.i18n.localize("RFS.Chat.Challenge.UnknownToken");
      const actorId = actor?.id ?? "";
      const img     = actor?.img ?? "icons/svg/mystery-man.svg";

      return `<div class="rfs-challenge__player rfs-challenge__player--pending">
        <button type="button" class="rfs-challenge__player-btn"
                data-action="rfsOpenChallengeDialog"
                data-token-id="${tokenId}"
                data-actor-id="${actorId}"
                data-challenge-id="${challenge.challengeId}">
          <img class="rfs-challenge__portrait" src="${img}" alt="${name}">
        </button>
        <div class="rfs-challenge__player-info">
          <span class="rfs-challenge__player-name">${name}</span>
          <span class="rfs-challenge__player-skill rfs-challenge__player-skill--waiting">${game.i18n.localize("RFS.Chat.Challenge.Waiting")}</span>
        </div>
        <div class="rfs-challenge__player-result">
          <span class="rfs-challenge__player-total rfs-challenge__player-total--waiting">--</span>
        </div>
      </div>`;
    }

    const succeeded = !result.failed;
    const tied      = result.total === dc;
    const outcomeClass = tied ? "rfs-challenge__player--tie"
                       : succeeded ? "rfs-challenge__player--success"
                       : "rfs-challenge__player--failure";
    const totalClass   = tied ? "rfs-challenge__player-total--tie"
                       : succeeded ? "rfs-challenge__player-total--success"
                       : "rfs-challenge__player-total--failure";

    let skillLine = `${result.skillName} ${result.skillLevel ?? 1}`;
    if (result.allSixes) {
      skillLine += result.skillClaimed
        ? ` &#x2192; &#x2726; ${result.claimedSkillName}`
        : ` &#x2014; <em>${game.i18n.localize("RFS.Chat.Challenge.AdvancementPending")}</em>`;
    }

    const diceDisplay = result.dice?.length
      ? `<span class="rfs-challenge__player-dice">[${result.dice.join(", ")}]</span>`
      : "";

    return `<div class="rfs-challenge__player ${outcomeClass}">
      <img class="rfs-challenge__portrait" src="${result.actorImg ?? "icons/svg/mystery-man.svg"}" alt="${result.actorName}">
      <div class="rfs-challenge__player-info">
        <span class="rfs-challenge__player-name">${result.actorName}</span>
        <span class="rfs-challenge__player-skill">${skillLine}</span>
      </div>
      <div class="rfs-challenge__player-result">
        <span class="rfs-challenge__player-total ${totalClass}">${result.total}</span>
        ${diceDisplay}
      </div>
    </div>`;
  });

  return `<div class="rfs-challenge" data-challenge-id="${challenge.challengeId}">
    <div class="rfs-challenge__header">
      <span class="rfs-challenge__gear">&#9881;</span>
      <span class="rfs-challenge__title">${game.i18n.localize("RFS.Chat.Challenge.Title")}</span>
      ${dcDisplay}
    </div>
    ${promptHtml}
    <div class="rfs-challenge__players">
      ${playerRows.join("")}
    </div>
    <div class="rfs-challenge__footer">
      <span class="rfs-challenge__status-dot ${dotClass}"></span>
      <span class="rfs-challenge__status-text">${statusText}</span>
    </div>
  </div>`;
}

/**
 * Clear the active challenge.
 */
export async function clearActiveChallenge() {
  await game.settings.set(RFS.id, "activeChallenge", null);
}
