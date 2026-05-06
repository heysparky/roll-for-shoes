/**
 * src/dialogs/challenge-dialog.mjs
 * =====================================
 * GM-facing dialog for initiating a Roll for Shoes challenge.
 *
 * Opened via the shoe button on a token HUD or the Q keybinding
 * with tokens selected on the canvas.
 *
 * GM sets a DC (typed or rolled as Nd6), reviews the called tokens,
 * and posts. The challenge card appears in public chat; each called
 * player's popup opens automatically via socket.
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
    position: { width: 340, height: "auto" },
    form: {
      handler: RfsChallengeDialog._onSubmit,
      closeOnSubmit: true,
    },
    actions: {
      removeToken: RfsChallengeDialog._onRemoveToken,
      stepDc:      RfsChallengeDialog._onStepDc,
      setDc:       RfsChallengeDialog._onSetDc,
      selectDice:  RfsChallengeDialog._onSelectDice,
    },
  };

  /** @override */
  static PARTS = {
    form: {
      template: "systems/roll-for-shoes/templates/dialog/challenge-dialog.hbs",
    },
  };

  /* -------------------------------------------- */
  /*  Dynamic Title                               */
  /* -------------------------------------------- */

  /** Show "Roll for [name(s)]" in the title bar. */
  get title() {
    const names = this._tokens.map(t => t.name);
    if (!names.length) return game.i18n.localize("RFS.Dialog.Challenge.Title");
    if (names.length === 1) return `Roll for ${names[0]}`;
    if (names.length <= 3) return `Roll for ${names.slice(0, -1).join(", ")} & ${names.at(-1)}`;
    return `Roll for ${names.length} characters`;
  }

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
    this._tokens  = [...(options.tokens ?? [])];
    const moreXp  = game.settings.get("roll-for-shoes", "difficultyMode") === "moreXp";
    this._dc      = moreXp ? 4 : 3;
    this._dcDice  = 1;
  }

  /* -------------------------------------------- */
  /*  Context Preparation                         */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const moreXp = game.settings.get("roll-for-shoes", "difficultyMode") === "moreXp";
    const step   = moreXp ? 4 : 3;

    const canonicals = [];
    for (let v = step; v <= 24; v += step) {
      canonicals.push({ value: v, active: v === this._dc });
    }

    const diceOptions = [1, 2, 3, 4].map(n => ({
      n,
      label:    `${n}d6`,
      selected: this._dcDice === n,
    }));

    return {
      ...await super._prepareContext(options),
      tokens:      this._tokens.map(t => ({ id: t.id, name: t.name })),
      dc:          this._dc,
      dcDice:      this._dcDice,
      canonicals,
      diceOptions,
      isRolled:    this._dcDice > 1,
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

  static async _onStepDc(event, target) {
    const dir = parseInt(target.dataset.dir ?? "0", 10);
    this._dc  = Math.max(2, Math.min(24, this._dc + dir));
    await this.render();
  }

  static async _onSetDc(event, target) {
    const val = parseInt(target.dataset.value ?? "", 10);
    if (!isNaN(val)) {
      this._dc = val;
      await this.render();
    }
  }

  static async _onSelectDice(event, target) {
    const n      = parseInt(target.dataset.dice ?? "1", 10);
    this._dcDice = n;
    await this.render();
  }

  /* -------------------------------------------- */
  /*  Form Submission                             */
  /* -------------------------------------------- */

  static async _onSubmit(event, form, formData) {
    let finalDc;
    if (this._dcDice > 1) {
      const roll = new Roll(`${this._dcDice}d6`);
      await roll.evaluate();
      finalDc = roll.total;
    } else {
      finalDc = this._dc;
    }
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
