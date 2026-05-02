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
 *     - Posts a rich chat message with result
 *     - On failure (vs difficulty): calls actor.addXp(1)
 *     - On all-sixes: embeds a "Claim Skill" button in the chat card
 *       The player clicks it when ready; the naming dialog opens then.
 *     - Checks for an active challenge (set by RfsChallengeDialog) and
 *       uses its DC if the rolling actor's token is in the called list.
 *
 *   RfsSkillRoll.spendXpOnCard(messageId)
 *     - Called when the player clicks "Spend XP" on a result card
 *     - Spends 1 XP from the actor
 *     - Turns the lowest die to a 6 (per RFS rules)
 *     - If all dice are now 6 → swaps button to "Claim Skill"
 *     - If not → shows "XP Spent" note, no claim button
 *     - Updates the chat message in place
 *
 *   RfsSkillRoll.claimAdvancement(actorId, skillId)
 *     - Called when the player clicks the "Claim Skill" button in chat
 *     - Opens the naming dialog and adds the new skill
 *
 * OPTIONS shape:
 *   {
 *     flavor:     string,   // optional override for chat message flavor
 *     difficulty: number,   // static threshold (undefined = use challenge DC or default 4)
 *   }
 */

import { getActiveChallenge, recordChallengeRoll } from "../helpers/settings.mjs";

export class RfsSkillRoll {

  /* -------------------------------------------- */
  /*  Public API                                  */
  /* -------------------------------------------- */

  /**
   * Roll a skill for an actor. The core RFS roll.
   *
   * DC resolution order:
   *   1. options.difficulty if explicitly passed (e.g. rollVsDifficulty)
   *   2. Active challenge DC if this actor's token is in the called list
   *   3. Default DC of 4
   *
   * @param {RfsActor} actor
   * @param {object}   skill    - skill object from actor.system.skills
   * @param {object}   options
   * @returns {Promise<void>}
   */
  static async roll(actor, skill, options = {}) {
    // Resolve difficulty from active challenge if applicable
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

    await RfsSkillRoll._postRollMessage(actor, skill, roll, dice, rawTotal, modifier, total, allSixes, failed, options);

    // Every failed roll grants XP
    if (failed) {
      await actor.addXp(1);
    }

    // If this roll was part of a challenge, record it.
    // This may clear the challenge if all tokens have now rolled.
    if (challengeId) {
      const token = actor.getActiveTokens()?.[0];
      if (token) await recordChallengeRoll(token.id);
    }
  }

  /**
   * Called when a player clicks "Spend XP" on a result card in chat.
   *
   * RFS rules: spending XP turns your lowest die to a 6 for advancement
   * purposes only — it does NOT change success/failure against the DC.
   *
   * Flow:
   *   1. Read roll state from the message's flags
   *   2. Verify the actor still has XP to spend
   *   3. Spend 1 XP
   *   4. Replace the lowest die with a 6
   *   5. Check if all dice are now 6 → advancement trigger
   *   6. Update the chat message in place with new state
   *
   * @param {string} messageId  - The ChatMessage document ID
   * @returns {Promise<void>}
   */
  static async spendXpOnCard(messageId) {
    const message = game.messages.get(messageId);
    if (!message) return;

    const flags = message.getFlag("roll-for-shoes", "rollData");
    if (!flags) return;

    const actor = game.actors.get(flags.actorId);
    if (!actor) return;

    // Guard: can't spend what you don't have, and can't spend twice
    if (actor.system.xp < 1) {
      ui.notifications.warn(game.i18n.localize("RFS.Warn.NoXpToSpend"));
      return;
    }
    if (flags.xpSpent) {
      ui.notifications.warn(game.i18n.localize("RFS.Warn.XpAlreadySpent"));
      return;
    }

    // Spend the XP
    await actor.spendXp(1);

    // Turn the lowest die to a 6 (RFS advancement rule)
    const newDice = [...flags.dice];
    const lowestIdx = newDice.indexOf(Math.min(...newDice));
    newDice[lowestIdx] = 6;

    const allSixesAfterSpend = newDice.every(d => d === 6);

    // Update flags with new state
    const newFlags = {
      ...flags,
      dice:     newDice,
      xpSpent:  true,
      allSixes: allSixesAfterSpend,
    };

    const skill = {
      id:    flags.skillId,
      name:  flags.skillName,
      level: flags.skillLevel,
    };

    const newContent = RfsSkillRoll._buildRollContent(
      flags.actorName, skill, newDice,
      flags.rawTotal, flags.modifier, flags.total,
      allSixesAfterSpend, flags.failed, flags.difficulty,
      newFlags, messageId
    );

    await message.update({
      content: newContent,
      flags: { "roll-for-shoes": { rollData: newFlags } },
    });
  }

  /**
   * Roll two actors against each other. Higher modified total wins.
   *
   * @param {RfsActor} actorA
   * @param {object}   skillA
   * @param {RfsActor} actorB
   * @param {object}   skillB
   * @returns {Promise<void>}
   */
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

    const advA = allSixesA ? RfsSkillRoll._advancementButton(actorA, skillA) : "";
    const advB = allSixesB ? RfsSkillRoll._advancementButton(actorB, skillB) : "";

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
          ${advA}
        </div>
        <div class="rfs-roll__row">
          <span class="rfs-roll__actor">${actorB.name}</span>
          <span class="rfs-roll__skill">${skillB.name} (${skillB.level}d6)</span>
          <span class="rfs-roll__dice">[${diceB.join(", ")}]</span>
          <span class="rfs-roll__total">${RfsSkillRoll._modifierString(rollB.total, modB)} = <strong>${totalB}</strong></span>
          ${allSixesB ? `<span class="rfs-roll__allsixes">✦ ${game.i18n.localize("RFS.Chat.AllSixes")}</span>` : ""}
          ${advB}
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

    // XP for the loser
    if (totalA < totalB) await actorA.addXp(1);
    else if (totalB < totalA) await actorB.addXp(1);
  }

  /**
   * Roll a skill against a static difficulty number.
   */
  static async rollVsDifficulty(actor, skill, difficulty) {
    return RfsSkillRoll.roll(actor, skill, { difficulty });
  }

  /**
   * Called when a player clicks the "Claim Skill" button in a chat card.
   * Opens the naming dialog and adds the new skill to the actor.
   *
   * @param {string} actorId
   * @param {string} skillId
   * @returns {Promise<void>}
   */
  static async claimAdvancement(actorId, skillId) {
    const actor = game.actors.get(actorId);
    if (!actor) return;
    const skill = actor.getSkillById(skillId);
    if (!skill) return;

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
    return actor.addSkill(name, skill.id);
  }

  /* -------------------------------------------- */
  /*  Internal Helpers                            */
  /* -------------------------------------------- */

  /**
   * Resolve the difficulty for a roll.
   * @private
   */
  static _resolveDifficulty(actor, options) {
    if (options.difficulty !== undefined) {
      return { difficulty: options.difficulty, challengeId: null };
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
   * Build and post the initial chat message for a single-actor roll.
   * Stores full roll state in flags so the card can be updated in place
   * when the player spends XP.
   * @private
   */
  static async _postRollMessage(actor, skill, roll, dice, rawTotal, modifier, total, allSixes, failed, options) {
    const rollData = {
      actorId:    actor.id,
      actorName:  actor.name,
      skillId:    skill.id,
      skillName:  skill.name,
      skillLevel: skill.level,
      dice,
      rawTotal,
      modifier,
      total,
      difficulty: options.difficulty,
      allSixes,
      failed,
      xpSpent:    false,
    };

    const flavor = options.flavor ?? `${actor.name}: ${skill.name} (${skill.level}d6)`;

    // Post with placeholder message ID — we don't know the ID until after creation
    const message = await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor,
      content: RfsSkillRoll._buildRollContent(
        actor.name, skill, dice, rawTotal, modifier, total,
        allSixes, failed, options.difficulty, rollData, "PENDING"
      ),
      flags: { "roll-for-shoes": { rollData } },
    });

    // Update with real message ID so the Spend XP button works
    await message.update({
      content: RfsSkillRoll._buildRollContent(
        actor.name, skill, dice, rawTotal, modifier, total,
        allSixes, failed, options.difficulty, rollData, message.id
      ),
    });
  }

  /**
   * Build the HTML content for a roll result card.
   * Called on initial post and on XP spend updates.
   *
   * @param {string}   actorName
   * @param {object}   skill        - { id, name, level }
   * @param {number[]} dice         - current die values (may change after XP spend)
   * @param {number}   rawTotal     - original roll total (never changes)
   * @param {number}   modifier     - status modifier (never changes)
   * @param {number}   total        - rawTotal + modifier (never changes)
   * @param {boolean}  allSixes     - current all-sixes state (may change after XP spend)
   * @param {boolean}  failed       - whether the roll failed vs DC (never changes)
   * @param {number}   difficulty   - the DC (never changes)
   * @param {object}   rollData     - full flag state
   * @param {string}   messageId    - ChatMessage ID for button data attributes
   * @returns {string} HTML
   * @private
   */
  static _buildRollContent(actorName, skill, dice, rawTotal, modifier, total, allSixes, failed, difficulty, rollData, messageId) {
    const modStr = RfsSkillRoll._modifierString(rawTotal, modifier);
    const flavor = `${actorName}: ${skill.name} (${skill.level}d6)`;

    // Success/failure line — never changes even after XP spend
    const resultLine = failed
      ? `<div class="rfs-roll__result rfs-roll__result--failure">✘ ${game.i18n.localize("RFS.Chat.Failure")} (vs ${difficulty}) — +1 XP</div>`
      : `<div class="rfs-roll__result rfs-roll__result--success">✔ ${game.i18n.localize("RFS.Chat.Success")} (vs ${difficulty})</div>`;

    // Action area: Claim Skill, Spend XP, or spent note
    let actionArea = "";
    if (allSixes) {
      // Natural all-sixes OR achieved via XP spend
      if (rollData.xpSpent) {
        actionArea = `<div class="rfs-roll__xp-note">✦ ${game.i18n.localize("RFS.Chat.XpSpentAllSixes")}</div>`;
      }
      actionArea += RfsSkillRoll._advancementButton(
        { id: rollData.actorId },
        { id: rollData.skillId }
      );
    } else if (failed && !rollData.xpSpent) {
      // Failed, XP not yet spent — offer the button
      actionArea = `
        <button type="button"
                class="rfs-btn rfs-btn--spend-xp"
                data-action="rfsSpendXp"
                data-message-id="${messageId}">
          🎲 ${game.i18n.localize("RFS.Chat.SpendXp")}
        </button>`;
    } else if (failed && rollData.xpSpent && !allSixes) {
      // Spent XP but no all-sixes — show note only
      actionArea = `<div class="rfs-roll__xp-note">${game.i18n.localize("RFS.Chat.XpSpentNoSixes")}</div>`;
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

  /**
   * Build the "Claim Skill" button HTML.
   * @private
   */
  static _advancementButton(actor, skill) {
    return `
      <button type="button"
              class="rfs-btn rfs-btn--advancement"
              data-action="rfsClaimAdvancement"
              data-actor-id="${actor.id}"
              data-skill-id="${skill.id}">
        ✦ ${game.i18n.localize("RFS.Dialog.Advancement.Confirm")}
      </button>`;
  }

  /**
   * Format a raw total + modifier as a readable string.
   * @private
   */
  static _modifierString(rawTotal, modifier) {
    if (modifier === 0) return `${rawTotal}`;
    if (modifier > 0)   return `${rawTotal} + ${modifier}`;
    return `${rawTotal} − ${Math.abs(modifier)}`;
  }
}
