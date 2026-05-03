/**
 * src/rolls/skill-roll.mjs
 * ============================
 * Core roll logic for Roll for Shoes.
 *
 * API:
 *
 *   RfsSkillRoll.roll(actor, skill, options)
 *     - Rolls Nd6 where N = skill.level
 *     - Applies status modifiers to the total
 *     - Detects all-sixes (advancement trigger)
 *     - On challenge: posts result to the shared challenge card via recordChallengeRoll
 *     - On non-challenge roll: posts a standalone result card (same as before)
 *     - On failure: calls actor.addXp(1)
 *
 *   RfsSkillRoll.rollFromWidget(messageId, skillId)
 *     - Called when a player clicks the big Roll button on their widget card
 *     - Looks up actor + skill from widget flags, delegates to roll()
 *     - Disables the widget after rolling so it can't be double-submitted
 *
 *   RfsSkillRoll.spendXpOnCard(messageId)
 *     - Called when player clicks "Spend XP" on a standalone result card
 *     - Only relevant for non-challenge rolls (challenge results are on the shared card)
 *
 *   RfsSkillRoll.claimAdvancement(actorId, skillId, messageId)
 *     - Opens naming dialog, adds the new child skill
 *     - Locks the card via flags + _buildRollContent
 *
 * CARD ARCHITECTURE:
 *   Challenge roll  → result updates a row on the shared challenge card (no orphan card)
 *   Standalone roll → posts its own result card as before
 *
 * XP SPEND RULE (per RFS rules):
 *   A player may spend XP to turn dice to 6 for advancement purposes only.
 *   Cost = count of non-six dice. Checked at click time against live XP.
 *   Success/failure against DC is never affected by XP spend.
 */

import { getActiveChallenge, recordChallengeRoll } from "../helpers/settings.mjs";

export class RfsSkillRoll {

  /* -------------------------------------------- */
  /*  Public API                                  */
  /* -------------------------------------------- */

  /**
   * Core roll. Called from the sheet (direct roll) or from rollFromWidget.
   *
   * @param {RfsActor} actor
   * @param {object}   skill   - { id, name, level }
   * @param {object}   options - { difficulty, challengeId, flavor }
   */
  static async roll(actor, skill, options = {}) {
    const { difficulty, challengeId } = RfsSkillRoll._resolveDifficulty(actor, options);
    options = { ...options, difficulty, challengeId };

    const roll = new Roll(`${skill.level}d6`);
    await roll.evaluate();

    const dice     = roll.terms[0].results.map(r => r.result);
    const rawTotal = roll.total;
    const modifier = actor.system.totalStatusModifier ?? 0;
    const total    = rawTotal + modifier;
    const allSixes = dice.every(d => d === 6);
    const failed   = total < difficulty;

    if (challengeId) {
      // Challenge roll — update the shared card, no orphan card
      await RfsSkillRoll._postChallengeResult({
        actor, skill, roll, dice, rawTotal, modifier, total,
        allSixes, failed, options,
      });
    } else {
      // Standalone roll — post its own result card
      await RfsSkillRoll._postStandaloneMessage({
        actor, skill, roll, dice, rawTotal, modifier, total,
        allSixes, failed, options,
      });
    }

    if (failed) await actor.addXp(1);
  }

  /**
   * Called when a player clicks the Roll button on their whispered widget card.
   * Reads actor + skill from the widget's flags, then delegates to roll().
   * Disables the widget card after rolling so it can't be double-submitted.
   *
   * @param {string} messageId  - ID of the widget ChatMessage
   * @param {string} skillId    - ID of the skill selected in the dropdown
   */
  static async rollFromWidget(messageId, skillId) {
    const message = game.messages.get(messageId);
    if (!message) return;

    const flags = message.flags?.["roll-for-shoes"];
    if (!flags || flags.type !== "playerWidget") return;

    // Guard: already rolled from this widget
    if (flags.rolled) return;

    const actor = game.actors.get(flags.actorId);
    if (!actor) {
      ui.notifications.warn(game.i18n.localize("RFS.Warn.NoActor"));
      return;
    }

    const skill = actor.getSkillById(skillId);
    if (!skill) {
      ui.notifications.warn(game.i18n.localize("RFS.Warn.NoSkill"));
      return;
    }

    // Roll first, then delete the widget — if the roll errors the widget
    // stays in chat so the player can try again.
    await RfsSkillRoll.roll(actor, skill, {
      challengeId: flags.challengeId,
      tokenId:     flags.tokenId,
    });

    // Delete the widget card — result is now on the challenge card.
    message.delete().catch(err => console.warn("RFS | Could not delete widget:", err));
  }

  /**
   * Called when a player clicks "Spend XP" on a standalone result card.
   */
  static async spendXpOnCard(messageId) {
    const message = game.messages.get(messageId);
    if (!message) return;

    const flags = message.getFlag("roll-for-shoes", "rollData");
    if (!flags) return;

    if (flags.xpSpent) {
      ui.notifications.warn(game.i18n.localize("RFS.Warn.XpAlreadySpent"));
      return;
    }

    const actor = game.actors.get(flags.actorId);
    if (!actor) return;

    const nonSixCount = flags.nonSixCount ?? flags.dice.filter(d => d !== 6).length;

    if (actor.system.xp < nonSixCount) {
      ui.notifications.warn(game.i18n.format("RFS.Warn.NotEnoughXp", { cost: nonSixCount, xp: actor.system.xp }));
      return;
    }

    await actor.spendXp(nonSixCount);

    const newDice  = flags.dice.map(() => 6);
    const newFlags = {
      ...flags,
      dice:        newDice,
      xpSpent:     true,
      xpCost:      nonSixCount,
      allSixes:    true,
      nonSixCount: 0,
      skillClaimed: false,
    };

    const skill = { id: flags.skillId, name: flags.skillName, level: flags.skillLevel };

    await message.update({
      content: RfsSkillRoll._buildStandaloneContent(
        flags.actorName, skill, newDice,
        flags.rawTotal, flags.modifier, flags.total,
        true, flags.failed, flags.difficulty,
        newFlags, messageId, 0
      ),
      flags: { "roll-for-shoes": { rollData: newFlags } },
    });
  }

  /**
   * Called when a player clicks "Claim Skill" on any result card.
   * Works for both challenge rows and standalone cards.
   */
  static async claimAdvancement(actorId, skillId, messageId) {
    const actor = game.actors.get(actorId);
    if (!actor) return;
    const skill = actor.getSkillById(skillId);
    if (!skill) return;

    if (messageId) {
      const message = game.messages.get(messageId);
      const flags   = message?.getFlag("roll-for-shoes", "rollData");
      if (flags?.skillClaimed) return;
    }

    const result = await foundry.applications.api.DialogV2.input({
      window: { title: game.i18n.localize("RFS.Dialog.Advancement.Title") },
      content: `
        <p>${game.i18n.format("RFS.Dialog.Advancement.Hint", { skill: skill.name, level: skill.level + 1 })}</p>
        <input type="text" name="skillName"
               placeholder="${game.i18n.localize("RFS.Dialog.NewSkill.Placeholder")}"
               autofocus style="width:100%">`,
      ok: { label: game.i18n.localize("RFS.Dialog.Advancement.Confirm") },
    });

    const name = result?.skillName?.trim();
    if (!name) return;

    await actor.addSkill(name, skill.id);

    if (messageId) {
      // Standalone card — lock it via flags + rebuild
      const message = game.messages.get(messageId);
      if (message) {
        const flags = message.getFlag("roll-for-shoes", "rollData");
        if (flags) {
          const newFlags   = { ...flags, skillClaimed: true, claimedSkillName: name };
          const skillObj   = { id: flags.skillId, name: flags.skillName, level: flags.skillLevel };
          const newContent = RfsSkillRoll._buildStandaloneContent(
            flags.actorName, skillObj, flags.dice,
            flags.rawTotal, flags.modifier, flags.total,
            flags.allSixes, flags.failed, flags.difficulty,
            newFlags, messageId, flags.nonSixCount ?? 0
          );
          await message.update({
            content: newContent,
            flags: { "roll-for-shoes": { rollData: newFlags } },
          });
        }
      }
    } else {
      // Challenge card — update the result in settings so the card rebuilds
      const { getActiveChallenge, rebuildChallengeCard } = await import("../helpers/settings.mjs");
      const challenge = getActiveChallenge();
      if (challenge) {
        const token  = actor.getActiveTokens()?.[0];
        const tokenId = token?.id;
        if (tokenId && challenge.results?.[tokenId]) {
          const updatedResults = {
            ...challenge.results,
            [tokenId]: {
              ...challenge.results[tokenId],
              skillClaimed:     true,
              claimedSkillName: name,
            },
          };
          const updated = { ...challenge, results: updatedResults };
          await game.settings.set("roll-for-shoes", "activeChallenge", updated);
          await rebuildChallengeCard(updated);
        }
      }
    }
  }

  static async opposed(actorA, skillA, actorB, skillB) {
    const rollA = new Roll(`${skillA.level}d6`);
    const rollB = new Roll(`${skillB.level}d6`);
    await Promise.all([rollA.evaluate(), rollB.evaluate()]);

    const diceA     = rollA.terms[0].results.map(r => r.result);
    const diceB     = rollB.terms[0].results.map(r => r.result);
    const modA      = actorA.system.totalStatusModifier ?? 0;
    const modB      = actorB.system.totalStatusModifier ?? 0;
    const totalA    = rollA.total + modA;
    const totalB    = rollB.total + modB;
    const allSixesA = diceA.every(d => d === 6);
    const allSixesB = diceB.every(d => d === 6);

    const winner = totalA > totalB ? actorA.name
                 : totalB > totalA ? actorB.name
                 : game.i18n.localize("RFS.Chat.Tie");

    const content = `
      <div class="rfs-roll rfs-roll--opposed">
        <div class="rfs-roll__header">
          <strong>${game.i18n.localize("RFS.Chat.OpposedRoll")}</strong>
        </div>
        <div class="rfs-roll__row">
          <span class="rfs-roll__actor">${actorA.name}</span>
          <span class="rfs-roll__skill">${skillA.name} (${skillA.level}d6)</span>
          <span class="rfs-roll__dice">[${diceA.join(", ")}]</span>
          <span class="rfs-roll__total">${RfsSkillRoll._modifierString(rollA.total, modA)} = <strong>${totalA}</strong></span>
          ${allSixesA ? `<span class="rfs-roll__allsixes">✦ ${game.i18n.localize("RFS.Chat.AllSixes")}</span>` : ""}
          ${allSixesA ? RfsSkillRoll._advancementButton(actorA, skillA) : ""}
        </div>
        <div class="rfs-roll__row">
          <span class="rfs-roll__actor">${actorB.name}</span>
          <span class="rfs-roll__skill">${skillB.name} (${skillB.level}d6)</span>
          <span class="rfs-roll__dice">[${diceB.join(", ")}]</span>
          <span class="rfs-roll__total">${RfsSkillRoll._modifierString(rollB.total, modB)} = <strong>${totalB}</strong></span>
          ${allSixesB ? `<span class="rfs-roll__allsixes">✦ ${game.i18n.localize("RFS.Chat.AllSixes")}</span>` : ""}
          ${allSixesB ? RfsSkillRoll._advancementButton(actorB, skillB) : ""}
        </div>
        <div class="rfs-roll__result">
          ${game.i18n.format("RFS.Chat.Winner", { name: winner })}
        </div>
      </div>`;

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: actorA }),
      content,
      rolls: [rollA, rollB],
    });

    if (totalA < totalB) await actorA.addXp(1);
    else if (totalB < totalA) await actorB.addXp(1);
  }

  static async rollVsDifficulty(actor, skill, difficulty) {
    return RfsSkillRoll.roll(actor, skill, { difficulty });
  }

  /* -------------------------------------------- */
  /*  Challenge Result                            */
  /* -------------------------------------------- */

  /**
   * Handle a roll that's part of an active challenge.
   * Records the result in settings → triggers challenge card rebuild.
   * Also posts the Foundry dice roll to chat for dice-so-nice etc.
   */
  static async _postChallengeResult({ actor, skill, roll, dice, rawTotal, modifier, total, allSixes, failed, options }) {
    const { challengeId } = options;

    const rollResult = {
      actorName:  actor.name,
      skillName:  skill.name,
      skillLevel: skill.level,
      dice,
      rawTotal,
      modifier,
      total,
      allSixes,
      failed,
      actorId:    actor.id,
      skillId:    skill.id,
      skillClaimed: false,
    };

    // Post the dice roll to chat (for Dice So Nice, roll history, etc.)
    // Whisper to GM + the rolling player so it doesn't flood public chat
    const rollingUser = game.users.find(u => u.character?.id === actor.id && !u.isGM);
    const whisper = [
      ...game.users.filter(u => u.isGM).map(u => u.id),
      ...(rollingUser ? [rollingUser.id] : []),
    ];

    await roll.toMessage({
      speaker:  ChatMessage.getSpeaker({ actor }),
      flavor:   `${actor.name}: ${skill.name} (${skill.level}d6)`,
      whisper,
      flags: {
        "roll-for-shoes": {
          type:        "challengeRoll",
          challengeId,
          rollResult,
        },
      },
    });

    // Record result — this rebuilds the challenge card automatically.
    // Prefer tokenId passed from the widget (reliable), fall back to
    // canvas lookup (works for sheet rolls where no widget is involved).
    const tokenId = options.tokenId ?? actor.getActiveTokens()?.[0]?.id;
    if (tokenId) await recordChallengeRoll(tokenId, rollResult);
  }

  /* -------------------------------------------- */
  /*  Standalone Result Card                      */
  /* -------------------------------------------- */

  static async _postStandaloneMessage({ actor, skill, roll, dice, rawTotal, modifier, total, allSixes, failed, options }) {
    const nonSixCount = dice.filter(d => d !== 6).length;

    const rollData = {
      actorId:      actor.id,
      actorName:    actor.name,
      skillId:      skill.id,
      skillName:    skill.name,
      skillLevel:   skill.level,
      dice,
      rawTotal,
      modifier,
      total,
      difficulty:   options.difficulty,
      allSixes,
      failed,
      xpSpent:      false,
      xpCost:       0,
      nonSixCount,
      skillClaimed: false,
    };

    const flavor = options.flavor ?? `${actor.name}: ${skill.name} (${skill.level}d6)`;

    const message = await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor,
      content: RfsSkillRoll._buildStandaloneContent(
        actor.name, skill, dice, rawTotal, modifier, total,
        allSixes, failed, options.difficulty, rollData, "PENDING", nonSixCount
      ),
      flags: { "roll-for-shoes": { rollData } },
    });

    await message.update({
      content: RfsSkillRoll._buildStandaloneContent(
        actor.name, skill, dice, rawTotal, modifier, total,
        allSixes, failed, options.difficulty, rollData, message.id, nonSixCount
      ),
    });
  }

  /* -------------------------------------------- */
  /*  Internal Helpers                            */
  /* -------------------------------------------- */

  static _resolveDifficulty(actor, options) {
    if (options.difficulty !== undefined) {
      return { difficulty: options.difficulty, challengeId: null };
    }

    // If a challengeId was passed directly (from widget), use it
    if (options.challengeId) {
      const challenge = getActiveChallenge();
      if (challenge && challenge.challengeId === options.challengeId) {
        return { difficulty: challenge.dc, challengeId: challenge.challengeId };
      }
    }

    const challenge = getActiveChallenge();
    if (challenge) {
      const actorTokens = actor.getActiveTokens?.() ?? [];
      const isCalledToken = actorTokens.some(t => challenge.tokenIds.includes(t.id));
      if (isCalledToken) {
        return { difficulty: challenge.dc, challengeId: challenge.challengeId };
      }
    }

    return { difficulty: 4, challengeId: null };
  }

  /**
   * Build HTML for a standalone result card.
   * Card state is driven entirely by flags — never reconstruct from HTML.
   */
  static _buildStandaloneContent(actorName, skill, dice, rawTotal, modifier, total, allSixes, failed, difficulty, rollData, messageId, nonSixCount = 0) {
    const modStr = RfsSkillRoll._modifierString(rawTotal, modifier);
    const flavor = `${actorName}: ${skill.name} (${skill.level}d6)`;

    const resultLine = failed
      ? `<div class="rfs-roll__result rfs-roll__result--failure">✘ ${game.i18n.localize("RFS.Chat.Failure")} (vs ${difficulty}) — +1 XP</div>`
      : `<div class="rfs-roll__result rfs-roll__result--success">✔ ${game.i18n.localize("RFS.Chat.Success")} (vs ${difficulty})</div>`;

    let actionArea = "";

    if (rollData.skillClaimed) {
      actionArea = `<div class="rfs-roll__xp-note">✦ ${game.i18n.format("RFS.Chat.SkillClaimed", { name: rollData.claimedSkillName })}</div>`;
    } else if (allSixes) {
      if (rollData.xpSpent) {
        actionArea = `<div class="rfs-roll__xp-note">✦ ${game.i18n.format("RFS.Chat.XpSpentAllSixes", { cost: rollData.xpCost })}</div>`;
      }
      actionArea += RfsSkillRoll._advancementButton(
        { id: rollData.actorId },
        { id: rollData.skillId },
        messageId
      );
    } else if (failed && !rollData.xpSpent && nonSixCount > 0) {
      const actor  = game.actors.get(rollData.actorId);
      const liveXp = actor?.system.xp ?? 0;
      if (liveXp >= nonSixCount) {
        actionArea = `
          <button type="button"
                  class="rfs-btn rfs-btn--spend-xp"
                  data-action="rfsSpendXp"
                  data-message-id="${messageId}">
            🎲 ${game.i18n.format("RFS.Chat.SpendXp", { cost: nonSixCount })}
          </button>`;
      }
    }

    return `
      <div class="rfs-roll">
        <div class="rfs-roll__header"><strong>${flavor}</strong></div>
        <div class="rfs-roll__dice-row">
          ${dice.map(d => `<span class="rfs-die${d === 6 ? " rfs-die--six" : ""}">${d}</span>`).join("")}
        </div>
        <div class="rfs-roll__total">${modStr} = <strong>${total}</strong></div>
        ${allSixes ? `<div class="rfs-roll__allsixes">✦ ${game.i18n.localize("RFS.Chat.AllSixes")}</div>` : ""}
        ${actionArea}
        ${resultLine}
      </div>`;
  }

  static _advancementButton(actor, skill, messageId = "") {
    return `
      <button type="button"
              class="rfs-btn rfs-btn--advancement"
              data-action="rfsClaimAdvancement"
              data-actor-id="${actor.id}"
              data-skill-id="${skill.id}"
              data-message-id="${messageId}">
        ✦ ${game.i18n.localize("RFS.Dialog.Advancement.Confirm")}
      </button>`;
  }

  static _modifierString(rawTotal, modifier) {
    if (modifier === 0) return `${rawTotal}`;
    if (modifier > 0)   return `${rawTotal} + ${modifier}`;
    return `${rawTotal} − ${Math.abs(modifier)}`;
  }
}
