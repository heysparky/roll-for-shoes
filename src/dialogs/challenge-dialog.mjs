/**
 * src/dialogs/challenge-dialog.mjs
 * =====================================
 * GM-facing dialog for initiating a Roll for Shoes challenge.
 *
 * Opened by clicking the "Call for Roll" shoe button on a token.
 * Lets the GM:
 *   1. Choose DC mode: roll Nd6 (default 1d6) or enter a static number
 *   2. Review/adjust which tokens are being called
 *   3. Confirm — posts a Challenge Card to chat
 *
 * Uses HandlebarsApplicationMixin(ApplicationV2) rather than DialogV2
 * because we need re-rendering when the GM toggles DC mode.
 *
 * Static entry point:
 *   RfsChallengeDialog.open(selectedTokens)
 */

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

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
    position: { width: 420, height: "auto" },
    form: {
      handler: RfsChallengeDialog._onSubmit,
      closeOnSubmit: true,
    },
    actions: {
      toggleDcMode: RfsChallengeDialog._onToggleDcMode,
      removeToken:  RfsChallengeDialog._onRemoveToken,
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

  /**
   * Open the challenge dialog for a set of tokens.
   * Called from RfsTokenHUD._onCallForRoll.
   *
   * @param {Token[]} tokens   - The tokens being called to roll
   * @returns {Promise<void>}
   */
  static async open(tokens) {
    // Only GMs can call for rolls
    if (!game.user.isGM) return;

    const dialog = new RfsChallengeDialog({ tokens });
    return dialog.render({ force: true });
  }

  /* -------------------------------------------- */
  /*  Constructor                                 */
  /* -------------------------------------------- */

  /**
   * @param {object} options
   * @param {Token[]} options.tokens  - Initial token selection
   */
  constructor(options = {}) {
    super(options);

    // Internal state — not stored on the document, just lives for the
    // lifetime of this dialog.
    this._tokens  = [...(options.tokens ?? [])];
    this._dcMode  = "roll";    // "roll" | "static"
    this._dcDice  = 1;         // number of d6s to roll for DC (default 1)
    this._dcValue = 4;         // static DC value when mode is "static"
  }

  /* -------------------------------------------- */
  /*  Context Preparation                         */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);

    return {
      ...context,
      tokens:   this._tokens.map(t => ({ id: t.id, name: t.name })),
      dcMode:   this._dcMode,
      dcDice:   this._dcDice,
      dcValue:  this._dcValue,
      isRollMode:   this._dcMode === "roll",
      isStaticMode: this._dcMode === "static",
      labels: {
        title:        game.i18n.localize("RFS.Dialog.Challenge.Title"),
        dcModeRoll:   game.i18n.localize("RFS.Dialog.Challenge.DcModeRoll"),
        dcModeStatic: game.i18n.localize("RFS.Dialog.Challenge.DcModeStatic"),
        dcDiceLabel:  game.i18n.localize("RFS.Dialog.Challenge.DcDiceLabel"),
        dcValueLabel: game.i18n.localize("RFS.Dialog.Challenge.DcValueLabel"),
        calledTokens: game.i18n.localize("RFS.Dialog.Challenge.CalledTokens"),
        noTokens:     game.i18n.localize("RFS.Dialog.Challenge.NoTokens"),
        confirm:      game.i18n.localize("RFS.Dialog.Challenge.Confirm"),
        cancel:       game.i18n.localize("RFS.Dialog.Challenge.Cancel"),
      },
    };
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  /**
   * Toggle between "roll Nd6" and "static number" DC modes.
   * Re-renders the dialog so the relevant input shows/hides.
   */
  static async _onToggleDcMode(event, target) {
    this._dcMode = this._dcMode === "roll" ? "static" : "roll";
    await this.render();
  }

  /**
   * Remove a token from the called list.
   * Re-renders to update the token list.
   */
  static async _onRemoveToken(event, target) {
    const tokenId = target.dataset.tokenId;
    this._tokens = this._tokens.filter(t => t.id !== tokenId);
    await this.render();
  }

  /* -------------------------------------------- */
  /*  Form Submission                             */
  /* -------------------------------------------- */

  /**
   * Handle form submission. Reads final DC settings, rolls DC if needed,
   * then posts the Challenge Card to chat.
   *
   * @param {SubmitEvent}  event
   * @param {HTMLFormElement} form
   * @param {FormDataExtended} formData
   */
  static async _onSubmit(event, form, formData) {
    const data = formData.object;

    // Read DC mode from internal state (toggle button, not a form input)
    const dcMode  = this._dcMode;
    const dcDice  = parseInt(data.dcDice  ?? this._dcDice,  10) || 1;
    const dcValue = parseInt(data.dcValue ?? this._dcValue, 10) || 4;

    // Roll the DC if in roll mode
    let finalDc   = dcValue;
    let dcRoll    = null;

    if (dcMode === "roll") {
      dcRoll  = new Roll(`${dcDice}d6`);
      await dcRoll.evaluate();
      finalDc = dcRoll.total;
    }

    // Post the Challenge Card to chat
    await RfsChallengeDialog._postChallengeCard({
      tokens:  this._tokens,
      dcMode,
      dcDice,
      dcRoll,
      finalDc,
    });
  }

  /* -------------------------------------------- */
  /*  Chat Card                                   */
  /* -------------------------------------------- */

  /**
   * Post the Challenge Card to chat. This is the anchor card — individual
   * player results post as separate cards beneath it referencing this
   * challenge's ID.
   *
   * FUTURE: PERSISTENT CARD UPGRADE
   * Currently posts a static anchor card. Player results are posted as
   * separate child cards (see skill-roll.mjs challengeId option).
   * When upgrading to a persistent card, replace ChatMessage.create here
   * with a version that stores challengeId in flags and updates in place
   * as results arrive. The result data structure (keyed by actorId) is
   * already designed for this. Revisit after milestone 10.
   *
   * @param {object} opts
   * @param {Token[]} opts.tokens
   * @param {string}  opts.dcMode
   * @param {number}  opts.dcDice
   * @param {Roll|null} opts.dcRoll
   * @param {number}  opts.finalDc
   */
  static async _postChallengeCard({ tokens, dcMode, dcDice, dcRoll, finalDc }) {
    const tokenList = tokens.map(t =>
      `<li class="rfs-challenge__token">${t.name}</li>`
    ).join("");

    const dcLine = dcMode === "roll"
      ? `<span class="rfs-challenge__dc-roll">
           ${game.i18n.format("RFS.Chat.Challenge.DcRolled",
             { dice: dcDice, result: finalDc })}
         </span>`
      : `<span class="rfs-challenge__dc-static">
           ${game.i18n.format("RFS.Chat.Challenge.DcStatic", { dc: finalDc })}
         </span>`;

    const content = `
      <div class="rfs-challenge" data-challenge-id="{{challengeId}}">
        <div class="rfs-challenge__header">
          <strong>${game.i18n.localize("RFS.Chat.Challenge.Title")}</strong>
        </div>
        <div class="rfs-challenge__dc">
          ${dcLine}
        </div>
        <div class="rfs-challenge__called">
          <span>${game.i18n.localize("RFS.Chat.Challenge.CalledTo")}</span>
          <ul class="rfs-challenge__token-list">${tokenList}</ul>
        </div>
        <div class="rfs-challenge__hint">
          ${game.i18n.localize("RFS.Chat.Challenge.Hint")}
        </div>
      </div>`;

    // Generate a stable ID for this challenge so result cards can reference it
    const challengeId = foundry.utils.randomID();

    const message = await ChatMessage.create({
      speaker: { alias: game.i18n.localize("RFS.Chat.Challenge.Speaker") },
      content: content.replace("{{challengeId}}", challengeId),
      flags: {
        "roll-for-shoes": {
          type:        "challenge",
          challengeId,
          dc:          finalDc,
          tokenIds:    tokens.map(t => t.id),
        },
      },
      // Include the DC roll in the message so Foundry handles dice rendering
      rolls: dcRoll ? [dcRoll] : [],
    });

    return message;
  }
}
