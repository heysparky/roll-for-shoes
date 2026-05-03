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
 *     - On failure: calls actor.addXp(1)
 *     - Checks for an active challenge and uses its DC if applicable
 *
 *   RfsSkillRoll.spendXpOnCard(messageId)
 *     - Called when player clicks "Spend XP" on a result card
 *     - Cost = number of non-six dice (must turn ALL to 6 for advancement)
 *     - Checks live actor XP at click time — NOT at render time
 *     - Spends the full cost, turns all non-six dice to 6
 *     - Result is always all-sixes → Claim Skill button appears
 *     - Updates the chat message in place
 *
 *   RfsSkillRoll.claimAdvancement(actorId, skillId)
 *     - Opens naming dialog, adds the new child skill
 *
 * XP SPEND RULE (per RFS rules):
 *   A player may spend XP to turn dice to 6 for advancement purposes only.
 *   Each XP turns one die. To trigger advancement, ALL dice must show 6.
 *   Cost = count of non-six dice. Checked at click time against live XP,
 *   because the roll itself just awarded +1 XP which isn't reflected until
 *   after the card renders.
 *   Success/failure against the DC is never affected by XP spend.
 */

import { getActiveChallenge, recordChallengeRoll } from "../helpers/settings.mjs";

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

    await RfsSkillRoll._postRollMessage(actor, skill, roll, dice, rawTotal, modifier, total, allSixes, failed, options);

    if (failed) await actor.addXp(1);

    if (challengeId) {
      const token = actor.getActiveTokens()?.[0];
      if (token) await recordChallengeRoll(token.id);
    }
  }

  /**
   * Called when a player clicks "Spend XP" on a result card.
   *
   * Checks live actor XP at click time — the card was rendered before
   * addXp(1) ran, so we cannot use render-time XP for the guard.
   *
   * Turns ALL non-six dice to 6 (costs 1 XP per die).
   * Result is always all-sixes → Claim Skill button appears.
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

    // Cost = number of dice not showing 6 — read from flags (set at roll time)
    const nonSixCount = flags.nonSixCount ?? flags.dice.filter(d => d !== 6).length;

    // Live XP check at click time
    if (actor.system.xp < nonSixCount) {
      ui.notifications.warn(game.i18n.format("RFS.Warn.NotEnoughXp", { cost: nonSixCount, xp: actor.system.xp }));
      return;
    }

    await actor.spendXp(nonSixCount);

    // All dice become 6
    const newDice = flags.dice.map(() => 6);

    const newFlags = {
      ...flags,
      dice:        newDice,
      xpSpent:     true,
      xpCost:      nonSixCount,
      allSixes:    true,
      nonSixCount: 0,
    };

    const skill = { id: flags.skillId, name: flags.skillName, level: flags.skillLevel };

    await message.update({
      content: RfsSkillRoll._buildRollContent(
        flags.actorName, skill, newDice,
        flags.rawTotal, flags.modifier, flags.total,
        true, flags.failed, flags.difficulty,
        newFlags, messageId, 0
      ),
      flags: { "roll-for-shoes": { rollData: newFlags } },
    });
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

  static async _postRollMessage(actor, skill, roll, dice, rawTotal, modifier, total, allSixes, failed, options) {
    // nonSixCount stored in flags so spendXpOnCard can read it without recalculating
    const nonSixCount = dice.filter(d => d !== 6).length;

    const rollData = {
      actorId:     actor.id,
      actorName:   actor.name,
      skillId:     skill.id,
      skillName:   skill.name,
      skillLevel:  skill.level,
      dice,
      rawTotal,
      modifier,
      total,
      difficulty:  options.difficulty,
      allSixes,
      failed,
      xpSpent:     false,
      xpCost:      0,
      nonSixCount, // cost to spend for advancement — checked live at click time
    };

    const flavor = options.flavor ?? `${actor.name}: ${skill.name} (${skill.level}d6)`;

    const message = await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor,
      content: RfsSkillRoll._buildRollContent(
        actor.name, skill, dice, rawTotal, modifier, total,
        allSixes, failed, options.difficulty, rollData, "PENDING", nonSixCount
      ),
      flags: { "roll-for-shoes": { rollData } },
    });

    // Update with real message ID so the Spend XP button's data-message-id is correct
    await message.update({
      content: RfsSkillRoll._buildRollContent(
        actor.name, skill, dice, rawTotal, modifier, total,
        allSixes, failed, options.difficulty, rollData, message.id, nonSixCount
      ),
    });
  }

  /**
   * Build the HTML content for a roll result card.
   *
   * XP spend button:
   *   - Shown whenever: failed && !xpSpent && nonSixCount > 0
   *   - Affordability is NOT checked here — it's checked at click time
   *     because addXp(1) runs after this renders, making render-time XP stale.
   *   - nonSixCount is shown in the button label so players know the cost.
   */
  static _buildRollContent(actorName, skill, dice, rawTotal, modifier, total, allSixes, failed, difficulty, rollData, messageId, nonSixCount = 0) {
    const modStr = RfsSkillRoll._modifierString(rawTotal, modifier);
    const flavor = `${actorName}: ${skill.name} (${skill.level}d6)`;

    const resultLine = failed
      ? `<div class="rfs-roll__result rfs-roll__result--failure">✘ ${game.i18n.localize("RFS.Chat.Failure")} (vs ${difficulty}) — +1 XP</div>`
      : `<div class="rfs-roll__result rfs-roll__result--success">✔ ${game.i18n.localize("RFS.Chat.Success")} (vs ${difficulty})</div>`;

    let actionArea = "";

    if (allSixes) {
      if (rollData.xpSpent) {
        actionArea = `<div class="rfs-roll__xp-note">✦ ${game.i18n.format("RFS.Chat.XpSpentAllSixes", { cost: rollData.xpCost })}</div>`;
      }
      actionArea += RfsSkillRoll._advancementButton(
        { id: rollData.actorId },
        { id: rollData.skillId }
      );
    } else if (failed && !rollData.xpSpent && nonSixCount > 0) {
      actionArea = `
        <button type="button"
                class="rfs-btn rfs-btn--spend-xp"
                data-action="rfsSpendXp"
                data-message-id="${messageId}">
          🎲 ${game.i18n.format("RFS.Chat.SpendXp", { cost: nonSixCount })}
        </button>`;
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

  static _modifierString(rawTotal, modifier) {
    if (modifier === 0) return `${rawTotal}`;
    if (modifier > 0)   return `${rawTotal} + ${modifier}`;
    return `${rawTotal} − ${Math.abs(modifier)}`;
  }
}
