/**
 * src/rolls/skill-roll.mjs
 * ============================
 * Core roll logic for Roll for Shoes.
 *
 * CARD ARCHITECTURE:
 *   Challenge roll  -> result row on the shared challenge card (no orphan card)
 *                   -> player popup handles advancement / XP spend (via socket)
 *   Standalone roll -> posts its own result card with inline XP spend / claim
 *
 * XP SPEND RULE:
 *   Cost = count of non-six dice. Checked at click time against live XP.
 *   Success/failure against DC is never affected by XP spend.
 */

import { getActiveChallenge } from "../helpers/settings.mjs";

export class RfsSkillRoll {

  /* -------------------------------------------- */
  /*  Public API                                  */
  /* -------------------------------------------- */

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
      await RfsSkillRoll._postChallengeResult({
        actor, skill, roll, dice, rawTotal, modifier, total,
        allSixes, failed, options,
      });
    } else {
      await RfsSkillRoll._postStandaloneMessage({
        actor, skill, roll, dice, rawTotal, modifier, total,
        allSixes, failed, options,
      });
    }

    if (failed) await actor.addXp(1);

    return { dice, allSixes, failed, nonSixCount: dice.filter(d => d !== 6).length, total, rawTotal, modifier };
  }

  /**
   * Standalone card XP spend (non-challenge rolls).
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
      dice:         newDice,
      xpSpent:      true,
      xpCost:       nonSixCount,
      allSixes:     true,
      nonSixCount:  0,
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
   * Claim advancement on a standalone result card (non-challenge rolls).
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
          ${allSixesA ? `<span class="rfs-roll__allsixes">&#x2726; ${game.i18n.localize("RFS.Chat.AllSixes")}</span>` : ""}
          ${allSixesA ? RfsSkillRoll._advancementButton(actorA, skillA) : ""}
        </div>
        <div class="rfs-roll__row">
          <span class="rfs-roll__actor">${actorB.name}</span>
          <span class="rfs-roll__skill">${skillB.name} (${skillB.level}d6)</span>
          <span class="rfs-roll__dice">[${diceB.join(", ")}]</span>
          <span class="rfs-roll__total">${RfsSkillRoll._modifierString(rollB.total, modB)} = <strong>${totalB}</strong></span>
          ${allSixesB ? `<span class="rfs-roll__allsixes">&#x2726; ${game.i18n.localize("RFS.Chat.AllSixes")}</span>` : ""}
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

  static async _postChallengeResult({ actor, skill, roll, dice, rawTotal, modifier, total, allSixes, failed, options }) {
    const { challengeId } = options;
    const nonSixCount = dice.filter(d => d !== 6).length;

    const rollResult = {
      actorName:          actor.name,
      skillName:          skill.name,
      skillLevel:         skill.level,
      dice,
      rawTotal,
      modifier,
      total,
      allSixes,
      failed,
      actorId:            actor.id,
      skillId:            skill.id,
      nonSixCount,
      skillClaimed:       false,
      advancementPending: allSixes,
    };

    const whisperTargets = RfsSkillRoll._whisperTargetsForActor(actor);

    await roll.toMessage({
      speaker:  ChatMessage.getSpeaker({ actor }),
      flavor:   `${actor.name}: ${skill.name} (${skill.level}d6)`,
      whisper:  whisperTargets,
      flags: {
        "roll-for-shoes": {
          type:        "challengeRoll",
          challengeId,
          rollResult,
        },
      },
    });

    // Ask the GM to record the result -- world settings are GM-only writes.
    const tokenId = options.tokenId ?? actor.getActiveTokens()?.[0]?.id;
    if (tokenId) {
      game.socket.emit("system.roll-for-shoes", {
        type:       "recordChallengeRoll",
        tokenId,
        rollResult,
      });
    }
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

  /**
   * Whisper targets = GM(s) + the player who owns this actor.
   * Used for the challengeRoll dice toast (Dice So Nice).
   */
  static _whisperTargetsForActor(actor) {
    const rollingUser = game.users.find(u => u.character?.id === actor.id && !u.isGM);
    return [
      ...game.users.filter(u => u.isGM).map(u => u.id),
      ...(rollingUser ? [rollingUser.id] : []),
    ];
  }

  static _resolveDifficulty(actor, options) {
    if (options.difficulty !== undefined) {
      return { difficulty: options.difficulty, challengeId: null };
    }

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

  static _buildStandaloneContent(actorName, skill, dice, rawTotal, modifier, total, allSixes, failed, difficulty, rollData, messageId, nonSixCount = 0) {
    const modStr = RfsSkillRoll._modifierString(rawTotal, modifier);
    const flavor = `${actorName}: ${skill.name} (${skill.level}d6)`;

    const resultLine = failed
      ? `<div class="rfs-roll__result rfs-roll__result--failure">&#x2718; ${game.i18n.localize("RFS.Chat.Failure")} (vs ${difficulty}) &mdash; +1 XP</div>`
      : `<div class="rfs-roll__result rfs-roll__result--success">&#x2714; ${game.i18n.localize("RFS.Chat.Success")} (vs ${difficulty})</div>`;

    let actionArea = "";

    if (rollData.skillClaimed) {
      actionArea = `<div class="rfs-roll__xp-note">&#x2726; ${game.i18n.format("RFS.Chat.SkillClaimed", { name: rollData.claimedSkillName })}</div>`;
    } else if (allSixes) {
      if (rollData.xpSpent) {
        actionArea = `<div class="rfs-roll__xp-note">&#x2726; ${game.i18n.format("RFS.Chat.XpSpentAllSixes", { cost: rollData.xpCost })}</div>`;
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
            ${game.i18n.format("RFS.Chat.SpendXp", { cost: nonSixCount })}
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
        ${allSixes ? `<div class="rfs-roll__allsixes">&#x2726; ${game.i18n.localize("RFS.Chat.AllSixes")}</div>` : ""}
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
        &#x2726; ${game.i18n.localize("RFS.Dialog.Advancement.Confirm")}
      </button>`;
  }

  static _modifierString(rawTotal, modifier) {
    if (modifier === 0) return `${rawTotal}`;
    if (modifier > 0)   return `${rawTotal} + ${modifier}`;
    return `${rawTotal} &minus; ${Math.abs(modifier)}`;
  }
}
