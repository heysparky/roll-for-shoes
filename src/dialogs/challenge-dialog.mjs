/**
 * src/dialogs/challenge-dialog.mjs
 * =====================================
 * GM-facing dialog for initiating a Roll for Shoes challenge.
 *
 * Opened via the shoe button on a token HUD or the Q keybinding
 * with tokens selected on the canvas.
 *
 * GM sets a DC number, reviews the called tokens, and posts.
 * The challenge card appears in public chat; each called player's
 * popup opens automatically via socket.
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
    position: { width: 320, height: "auto" },
    form: {
      handler: RfsChallengeDialog._onSubmit,
      closeOnSubmit: true,
    },
    actions: {
      removeToken: RfsChallengeDialog._onRemoveToken,
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
    this._tokens = [...(options.tokens ?? [])];
    this._dc     = 4;
  }

  /* -------------------------------------------- */
  /*  Context Preparation                         */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    return {
      ...await super._prepareContext(options),
      tokens: this._tokens.map(t => ({ id: t.id, name: t.name })),
      dc:     this._dc,
    };
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  static async _onRemoveToken(event, target) {
    const tokenId = target.dataset.tokenId;
    this._tokens  = this._tokens.filter(t => t.id !== tokenId);
    await this.render();
  }

  /* -------------------------------------------- */
  /*  Form Submission                             */
  /* -------------------------------------------- */

  static async _onSubmit(event, form, formData) {
    const finalDc = Math.max(1, parseInt(formData.object.dc ?? 4, 10) || 4);
    await RfsChallengeDialog._postChallenge({ tokens: this._tokens, finalDc });
  }

  /* -------------------------------------------- */
  /*  Post Challenge                              */
  /* -------------------------------------------- */

  static async _postChallenge({ tokens, finalDc }) {
    const challengeId = foundry.utils.randomID();
    const tokenIds    = tokens.map(t => t.id);

    const challengeState = {
      challengeId,
      dc:        finalDc,
      dcVisible: true,
      tokenIds,
      rolledIds: [],
      results:   {},
      widgetIds: {},
      timestamp: Date.now(),
      complete:  false,
    };

    const cardContent   = buildChallengeCardContent(challengeState);
    const challengeCard = await ChatMessage.create({
      speaker: { alias: game.i18n.localize("RFS.Chat.Challenge.Speaker") },
      content: cardContent,
      flags: {
        "roll-for-shoes": {
          type:        "challenge",
          challengeId,
          dc:          finalDc,
          tokenIds,
        },
      },
    });

    challengeState.challengeCardId = challengeCard.id;
    await setActiveChallenge(challengeState);

    game.socket.emit("system.roll-for-shoes", {
      type:        "openChallengeDialog",
      challengeId,
      dc:          finalDc,
      dcVisible:   true,
      prompt:      "",
      tokens:      tokens.map(t => ({ tokenId: t.id, actorId: t.actor?.id ?? "" })),
    });
  }

  /* -------------------------------------------- */
  /*  Player Roll Widget (unused — kept for ref)  */
  /* -------------------------------------------- */

  static async _postPlayerWidget({ token, challengeId, challengeCardId, dc, dcVisible, prompt }) {
    const actor = token.actor ?? game.actors.get(token.document?.actorId);

    let whisperTargets = [];
    if (actor) {
      whisperTargets = game.users.filter(u =>
        !u.isGM && actor.testUserPermission(u, "OWNER")
      ).map(u => u.id);
    }
    if (!whisperTargets.length) {
      whisperTargets = game.users.filter(u => !u.isGM).map(u => u.id);
    }

    const skills = actor?.system?.skills ?? [{ id: "root", name: "Do Anything", level: 1 }];

    const skillOptions = skills
      .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name))
      .map(s => {
        const pips = "&#x25cf;".repeat(s.level);
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
            <option value="" disabled selected>&#x2014; ${game.i18n.localize("RFS.Widget.SelectSkill")} &#x2014;</option>
            ${skillOptions}
          </select>
        </div>
        <button type="button"
                class="rfs-widget__roll-btn rfs-btn rfs-btn--roll"
                data-action="rfsWidgetRoll"
                disabled>
          ${game.i18n.localize("RFS.Widget.RollButton")}
        </button>
      </div>`;

    await ChatMessage.create({
      content,
      whisper: whisperTargets,
      flags: {
        "roll-for-shoes": {
          type:           "playerWidget",
          challengeId,
          challengeCardId,
          actorId:        actor?.id ?? "",
          tokenId:        token.id,
        },
      },
    });
  }
}
