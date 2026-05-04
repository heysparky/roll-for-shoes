/**
 * src/dialogs/challenge-player-dialog.mjs
 * ==========================================
 * Player-facing popup for responding to a GM challenge.
 *
 * Opened automatically via socket when a challenge is posted, and re-openable
 * by clicking the player's name on the shared challenge card.
 *
 * Handles the full player flow in one surface:
 *   pick-skill → rolling → xp-spend | advancement → done
 *
 * One instance per token, tracked in a static Map so duplicate opens bring
 * the existing dialog to the front rather than spawning a second one.
 */

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

import { getActiveChallenge, rebuildChallengeCard } from "../helpers/settings.mjs";
import { RfsSkillRoll } from "../rolls/skill-roll.mjs";

export class RfsChallengePlayerDialog extends HandlebarsApplicationMixin(ApplicationV2) {

  /* -------------------------------------------- */
  /*  Static Configuration                        */
  /* -------------------------------------------- */

  static DEFAULT_OPTIONS = {
    classes: ["roll-for-shoes", "challenge-player-dialog"],
    window: {
      title: "RFS.Dialog.ChallengePlayer.Title",
      resizable: false,
    },
    position: { width: 400, height: "auto" },
    actions: {
      rfsDialogRoll:    RfsChallengePlayerDialog._onRoll,
      rfsDialogSpendXp: RfsChallengePlayerDialog._onSpendXp,
      rfsDialogClaim:   RfsChallengePlayerDialog._onClaim,
      rfsDialogDismiss: RfsChallengePlayerDialog._onDismiss,
    },
  };

  static PARTS = {
    main: {
      template: "systems/roll-for-shoes/templates/dialog/challenge-player-dialog.hbs",
    },
  };

  /* -------------------------------------------- */
  /*  Instance Tracking                           */
  /* -------------------------------------------- */

  /** @type {Map<string, RfsChallengePlayerDialog>} tokenId → dialog */
  static _openDialogs = new Map();

  /**
   * Open the challenge popup for a specific token.
   * If already open, re-renders and brings to front.
   *
   * @param {string} tokenId
   * @param {string} actorId
   * @param {string} challengeId
   * @returns {RfsChallengePlayerDialog|null}
   */
  static open(tokenId, actorId, challengeId) {
    const existing = RfsChallengePlayerDialog._openDialogs.get(tokenId);
    if (existing) {
      existing.render({ force: true });
      return existing;
    }

    const actor = game.actors.get(actorId);
    if (!actor) return null;

    const dialog = new RfsChallengePlayerDialog({ tokenId, actorId, challengeId });
    RfsChallengePlayerDialog._openDialogs.set(tokenId, dialog);
    dialog.render({ force: true });
    return dialog;
  }

  /* -------------------------------------------- */
  /*  Constructor                                 */
  /* -------------------------------------------- */

  constructor(options = {}) {
    super(options);
    this._tokenId    = options.tokenId;
    this._actorId    = options.actorId;
    this._challengeId = options.challengeId;

    // Determine initial step from existing challenge state (e.g. player already
    // rolled from their sheet, or dialog re-opened after being closed)
    this._step             = "pick-skill";
    this._rollResult       = null;
    this._skillId          = null;
    this._skillName        = null;
    this._skillLevel       = null;
    this._claimedSkillName = null;

    const challenge = getActiveChallenge();
    const existing  = challenge?.results?.[options.tokenId];
    if (existing) {
      this._rollResult = existing;
      this._skillId    = existing.skillId;
      this._skillName  = existing.skillName;
      this._skillLevel = existing.skillLevel;

      if (existing.skillClaimed) {
        this._step             = "done";
        this._claimedSkillName = existing.claimedSkillName ?? null;
      } else if (existing.advancementPending) {
        this._step = "advancement";
      } else if (existing.failed && existing.nonSixCount > 0) {
        this._step = "xp-spend";
      } else {
        this._step = "done";
      }
    }
  }

  /* -------------------------------------------- */
  /*  Context Preparation                         */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);

    const actor     = game.actors.get(this._actorId);
    const challenge = getActiveChallenge();

    const isOwner     = actor?.testUserPermission(game.user, "OWNER") ?? false;
    const canInteract = isOwner && !game.user.isGM;

    const skills = (actor?.system?.skills ?? [])
      .slice()
      .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));

    const result      = this._rollResult;
    const xpCost      = result?.nonSixCount ?? 0;
    const currentXp   = actor?.system?.xp ?? 0;
    const canAffordXp = currentXp >= xpCost;

    const diceHtml = result?.dice
      ?.map(d => `<span class="rfs-die${d === 6 ? " rfs-die--six" : ""}">${d}</span>`)
      .join("") ?? "";

    const newSkillPrompt = this._skillName
      ? game.i18n.format("RFS.Dialog.Advancement.Hint", {
          skill: this._skillName,
          level: (this._skillLevel ?? 1) + 1,
        })
      : "";

    const doneNote = this._claimedSkillName
      ? game.i18n.format("RFS.Chat.SkillClaimed", { name: this._claimedSkillName })
      : game.i18n.localize("RFS.Dialog.ChallengePlayer.RollComplete");

    return {
      ...context,
      actorName:     actor?.name ?? "",
      skills,
      prompt:        challenge?.prompt ?? "",
      dc:            challenge?.dc,
      dcVisible:     challenge?.dcVisible ?? true,
      canInteract,
      rollResult:    result,
      diceHtml,
      xpCost,
      currentXp,
      canAffordXp,
      newSkillPrompt,
      doneNote,
      // Step flags — computed here so the template needs no helpers
      isPickSkill:   this._step === "pick-skill",
      isRolling:     this._step === "rolling",
      isXpSpend:     this._step === "xp-spend",
      isAdvancement: this._step === "advancement",
      isDone:        this._step === "done",
      showResult:    ["xp-spend", "advancement", "done"].includes(this._step),
    };
  }

  /* -------------------------------------------- */
  /*  Render Hook                                 */
  /* -------------------------------------------- */

  /** Wire live listeners that can't be handled via data-action. */
  _onRender(context, options) {
    // Skill select → enable roll button
    const select  = this.element?.querySelector(".rfs-cpd__skill-select");
    const rollBtn = this.element?.querySelector("[data-action='rfsDialogRoll']");
    if (select && rollBtn) {
      select.addEventListener("change", () => {
        rollBtn.disabled = !select.value;
      });
    }

    // Skill name input → enable claim button
    const nameInput = this.element?.querySelector(".rfs-cpd__skill-name-input");
    const claimBtn  = this.element?.querySelector("[data-action='rfsDialogClaim']");
    if (nameInput && claimBtn) {
      nameInput.addEventListener("input", () => {
        claimBtn.disabled = !nameInput.value.trim();
      });
      nameInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && nameInput.value.trim()) {
          RfsChallengePlayerDialog._onClaim.call(this, e, claimBtn);
        }
      });
      nameInput.focus();
    }
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  static async _onRoll(event, target) {
    const select  = this.element?.querySelector(".rfs-cpd__skill-select");
    const skillId = select?.value;
    if (!skillId) return;

    target.disabled = true;
    if (select) select.disabled = true;
    this._step = "rolling";
    await this.render();

    const actor = game.actors.get(this._actorId);
    const skill = actor?.getSkillById(skillId);
    if (!actor || !skill) {
      this._step = "pick-skill";
      await this.render();
      return;
    }

    this._skillId    = skill.id;
    this._skillName  = skill.name;
    this._skillLevel = skill.level;

    const result = await RfsSkillRoll.roll(actor, skill, {
      challengeId: this._challengeId,
      tokenId:     this._tokenId,
    });

    this._rollResult = result;

    if (result.allSixes) {
      this._step = "advancement";
    } else if (result.failed && result.nonSixCount > 0) {
      this._step = "xp-spend";
    } else {
      this._step = "done";
    }

    await this.render();
  }

  static async _onSpendXp(event, target) {
    const actor = game.actors.get(this._actorId);
    if (!actor) return;

    const cost = this._rollResult?.nonSixCount ?? 0;
    if (actor.system.xp < cost) {
      ui.notifications.warn(game.i18n.format("RFS.Warn.NotEnoughXp", {
        cost,
        xp: actor.system.xp,
      }));
      return;
    }

    target.disabled = true;
    await actor.spendXp(cost);
    this._step = "advancement";
    await this.render();
  }

  static async _onClaim(event, target) {
    const nameInput = this.element?.querySelector(".rfs-cpd__skill-name-input");
    const name = nameInput?.value?.trim();
    if (!name) return;

    if (target) target.disabled = true;
    if (nameInput) nameInput.disabled = true;

    const actor = game.actors.get(this._actorId);
    if (!actor) return;

    await actor.addSkill(name, this._skillId);
    this._claimedSkillName = name;

    // Update the challenge card row to show the claimed skill name
    const challenge = getActiveChallenge();
    if (challenge?.results?.[this._tokenId]) {
      const updatedResults = {
        ...challenge.results,
        [this._tokenId]: {
          ...challenge.results[this._tokenId],
          skillClaimed:       true,
          claimedSkillName:   name,
          advancementPending: false,
        },
      };
      const updated = { ...challenge, results: updatedResults };
      await game.settings.set("roll-for-shoes", "activeChallenge", updated);
      await rebuildChallengeCard(updated);
    }

    this._step = "done";
    await this.render();
  }

  static async _onDismiss(event, target) {
    await this.close();
  }

  /* -------------------------------------------- */
  /*  Close                                       */
  /* -------------------------------------------- */

  /** @override */
  async close(options = {}) {
    RfsChallengePlayerDialog._openDialogs.delete(this._tokenId);
    return super.close(options);
  }
}
