/**
 * src/dialogs/challenge-dialog.mjs
 * =====================================
 * GM-facing dialog for initiating a Roll for Shoes challenge.
 *
 * Opened by clicking the "Call for Roll" shoe button on a token.
 * Lets the GM:
 *   1. Write an optional situation prompt (default: "calls for a roll")
 *   2. Choose DC mode: roll Nd6 (default 1d6) or enter a static number
 *   3. Toggle whether players can see the DC before they roll (default: visible)
 *   4. Review/adjust which tokens are being called
 *   5. Confirm — posts a live-updating Challenge Card + whispered player widgets
 *
 * Uses HandlebarsApplicationMixin(ApplicationV2) for re-rendering on toggles.
 *
 * Static entry point:
 *   RfsChallengeDialog.open(selectedTokens)
 */

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

import {
  setActiveChallenge,
  buildChallengeCardContent,
} from "../helpers/settings.mjs";

export class RfsChallengeDialog extends HandlebarsApplicationMixin(ApplicationV2) {

  /* -------------------------------------------- */
  /*  Static Configuration                        */
  /* -------------------------------------------- */

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "rfs-challenge-dialog",
    classes: ["roll-for-shoes", "challenge-dialog"],
    tag: "form",
    window: {
      title: "RFS.Dialog.Challenge.Title",
      resizable: false,
    },
    position: { width: 440, height: "auto" },
    form: {
      handler: RfsChallengeDialog._onSubmit,
      closeOnSubmit: true,
    },
    actions: {
      toggleDcMode:     RfsChallengeDialog._onToggleDcMode,
      toggleDcVisible:  RfsChallengeDialog._onToggleDcVisible,
      removeToken:      RfsChallengeDialog._onRemoveToken,
    },
  };

  /** @override */
  static PARTS = {
    form: {
      template: "systems/roll-for-shoes/templates/dialog/challenge-dialog.hbs",
    },
  };

  /* -------------------------------------------- */
  /*  Static Entry Point                          */
  /* -------------------------------------------- */

  static async open(tokens) {
    if (!game.user.isGM) return;
    const dialog = new RfsChallengeDialog({ tokens });
    return dialog.render({ force: true });
  }

  /* -------------------------------------------- */
  /*  Constructor                                 */
  /* -------------------------------------------- */

  constructor(options = {}) {
    super(options);
    this._tokens    = [...(options.tokens ?? [])];
    this._dcMode    = "roll";
    this._dcDice    = 1;
    this._dcValue   = 4;
    this._dcVisible = true;   // default: players can see the DC
    this._prompt    = "";     // default: empty → falls back to i18n default
  }

  /* -------------------------------------------- */
  /*  Context Preparation                         */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    return {
      ...context,
      tokens:       this._tokens.map(t => ({ id: t.id, name: t.name })),
      dcMode:       this._dcMode,
      dcDice:       this._dcDice,
      dcValue:      this._dcValue,
      dcVisible:    this._dcVisible,
      prompt:       this._prompt,
      isRollMode:   this._dcMode === "roll",
      isStaticMode: this._dcMode === "static",
    };
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  static async _onToggleDcMode(event, target) {
    this._dcMode = this._dcMode === "roll" ? "static" : "roll";
    await this.render();
  }

  static async _onToggleDcVisible(event, target) {
    this._dcVisible = !this._dcVisible;
    await this.render();
  }

  static async _onRemoveToken(event, target) {
    const tokenId = target.dataset.tokenId;
    this._tokens = this._tokens.filter(t => t.id !== tokenId);
    await this.render();
  }

  /* -------------------------------------------- */
  /*  Form Submission                             */
  /* -------------------------------------------- */

  static async _onSubmit(event, form, formData) {
    const data = formData.object;

    // Capture prompt before it's lost — fall back to i18n default
    this._prompt = (data.prompt ?? "").trim()
      || game.i18n.localize("RFS.Dialog.Challenge.DefaultPrompt");

    const dcMode  = this._dcMode;
    const dcDice  = parseInt(data.dcDice  ?? this._dcDice,  10) || 1;
    const dcValue = parseInt(data.dcValue ?? this._dcValue, 10) || 4;

    let finalDc = dcValue;
    let dcRoll  = null;

    if (dcMode === "roll") {
      dcRoll  = new Roll(`${dcDice}d6`);
      await dcRoll.evaluate();
      finalDc = dcRoll.total;
    }

    await RfsChallengeDialog._postChallenge({
      tokens:    this._tokens,
      dcMode,
      dcDice,
      dcRoll,
      finalDc,
      dcVisible: this._dcVisible,
      prompt:    this._prompt,
    });
  }

  /* -------------------------------------------- */
  /*  Post Challenge                              */
  /* -------------------------------------------- */

  /**
   * Post the shared challenge card and whisper a roll widget to each
   * called player. Stores everything in the activeChallenge setting so
   * skill rolls resolve against the correct DC.
   */
  static async _postChallenge({ tokens, dcMode, dcDice, dcRoll, finalDc, dcVisible, prompt }) {
    const challengeId = foundry.utils.randomID();
    const tokenIds    = tokens.map(t => t.id);

    // ── 1. Build the initial challenge state ──────────────────────────────
    const challengeState = {
      challengeId,
      dc:        finalDc,
      dcVisible,
      prompt,
      tokenIds,
      rolledIds: [],
      results:   {},
      widgetIds: {},
      timestamp: Date.now(),
      complete:  false,
    };

    // ── 2. Post the shared challenge card ─────────────────────────────────
    const cardContent = buildChallengeCardContent(challengeState);

    const challengeCard = await ChatMessage.create({
      speaker: { alias: game.i18n.localize("RFS.Chat.Challenge.Speaker") },
      content: cardContent,
      flags: {
        "roll-for-shoes": {
          type:        "challenge",
          challengeId,
          dc:          finalDc,
          dcVisible,
          tokenIds,
        },
      },
      rolls: dcRoll ? [dcRoll] : [],
    });

    // Store the card's messageId so we can update it as results come in
    challengeState.challengeCardId = challengeCard.id;

    // ── 3. Store the active challenge ────────────────────────────────────
    await setActiveChallenge(challengeState);

    // ── 4. Whisper a roll widget to each called player ───────────────────
    // We match tokens to users by looking for a player who has that token's
    // actor as their character. If no match, widget goes to all players
    // (edge case: GM-owned tokens, unlinked tokens, etc.).
    for (const token of tokens) {
      await RfsChallengeDialog._postPlayerWidget({
        token,
        challengeId,
        challengeCardId: challengeCard.id,
        dc:        finalDc,
        dcVisible,
        prompt,
      });
    }
  }

  /* -------------------------------------------- */
  /*  Player Roll Widget                          */
  /* -------------------------------------------- */

  /**
   * Post a whispered roll widget for a single token/player.
   * The widget shows the situation prompt, optionally the DC,
   * a skill dropdown, and a big roll button.
   *
   * The widget is whispered to the player who owns this token's actor.
   * If ownership can't be determined, it's whispered to all players.
   *
   * @param {object} opts
   */
  static async _postPlayerWidget({ token, challengeId, challengeCardId, dc, dcVisible, prompt }) {
    // Find the actor linked to this token
    const actor = token.actor ?? game.actors.get(token.document?.actorId);

    // Find the player(s) who own this actor
    let whisperTargets = [];
    if (actor) {
      whisperTargets = game.users.filter(u =>
        !u.isGM && actor.testUserPermission(u, "OWNER")
      ).map(u => u.id);
    }
    // Fall back to all non-GM players if we can't pin it down
    if (!whisperTargets.length) {
      whisperTargets = game.users.filter(u => !u.isGM).map(u => u.id);
    }

    // Build the skill list for this actor
    const skills = actor?.system?.skills ?? [{ id: "root", name: "Do Anything", level: 1 }];

    const skillOptions = skills
      .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name))
      .map(s => {
        const pips = "●".repeat(s.level);
        return `<option value="${s.id}" data-level="${s.level}">${pips} ${s.name} (${s.level}d6)</option>`;
      })
      .join("");

    const dcLine = dcVisible
      ? `<div class="rfs-widget__dc">${game.i18n.format("RFS.Chat.Challenge.DcValue", { dc })}</div>`
      : "";

    const content = `
      <div class="rfs-widget"
           data-challenge-id="${challengeId}"
           data-challenge-card-id="${challengeCardId}"
           data-actor-id="${actor?.id ?? ""}"
           data-token-id="${token.id}">
        <div class="rfs-widget__header">
          <strong>${game.i18n.localize("RFS.Chat.Challenge.Title")}</strong>
        </div>
        <div class="rfs-widget__prompt">${prompt}</div>
        ${dcLine}
        <div class="rfs-widget__skill-row">
          <label class="rfs-widget__skill-label">
            ${game.i18n.localize("RFS.Widget.ChooseSkill")}
          </label>
          <select class="rfs-widget__skill-select" name="skillId">
            <option value="" disabled selected>— ${game.i18n.localize("RFS.Widget.SelectSkill")} —</option>
            ${skillOptions}
          </select>
        </div>
        <button type="button"
                class="rfs-widget__roll-btn rfs-btn rfs-btn--roll"
                data-action="rfsWidgetRoll"
                disabled>
          🎲 ${game.i18n.localize("RFS.Widget.RollButton")}
        </button>
      </div>`;

    await ChatMessage.create({
      content,
      whisper: whisperTargets,
      flags: {
        "roll-for-shoes": {
          type:       "playerWidget",
          challengeId,
          challengeCardId,
          actorId:    actor?.id ?? "",
          tokenId:    token.id,
        },
      },
    });
  }
}
