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
 *     - On all-sixes: triggers advancement prompt
 *
 *   RfsSkillRoll.opposed(actorA, skillA, actorB, skillB)
 *     - Rolls both actors simultaneously
 *     - Compares totals (with status modifiers)
 *     - Posts a combined chat card
 *
 *   RfsSkillRoll.rollVsDifficulty(actor, skill, difficulty)
 *     - Rolls actor's skill against a static difficulty number
 *     - Used for NPC fixed-mode opposition and GM-set thresholds
 *
 * OPTIONS shape:
 *   {
 *     flavor:     string,   // optional override for chat message flavor
 *     difficulty: number,   // static threshold (undefined = narrative only)
 *     spendXp:    boolean,  // true if the player is spending XP to boost
 *   }
 */

export class RfsSkillRoll {

  /* -------------------------------------------- */
  /*  Public API                                  */
  /* -------------------------------------------- */

  /**
   * Roll a skill for an actor. The core RFS roll.
   *
   * @param {RfsActor} actor
   * @param {object}   skill    - skill object from actor.system.skills
   * @param {object}   options
   * @returns {Promise<void>}
   */
  static async roll(actor, skill, options = {}) {
    const roll = new Roll(`${skill.level}d6`);
    await roll.evaluate();

    const dice      = roll.terms[0].results.map(r => r.result);
    const rawTotal  = roll.total;
    const modifier  = actor.system.totalStatusModifier ?? 0;
    const total     = rawTotal + modifier;
    const allSixes  = dice.every(d => d === 6);

    // Build and post the chat message
    await RfsSkillRoll._postRollMessage(actor, skill, roll, dice, rawTotal, modifier, total, allSixes, options);

    // On all sixes — trigger advancement
    if (allSixes) {
      await RfsSkillRoll._triggerAdvancement(actor, skill);
    }

    // No difficulty set = narrative only, no pass/fail
    if (options.difficulty !== undefined) {
      if (total < options.difficulty) {
        await actor.addXp(1);
      }
      return;
    }

    // No difficulty — XP on failure isn't automatic in narrative mode.
    // The GM decides; XP can be awarded manually via the sheet.
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

    // Build chat content
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
        </div>
        <div class="rfs-roll__row">
          <span class="rfs-roll__actor">${actorB.name}</span>
          <span class="rfs-roll__skill">${skillB.name} (${skillB.level}d6)</span>
          <span class="rfs-roll__dice">[${diceB.join(", ")}]</span>
          <span class="rfs-roll__total">${RfsSkillRoll._modifierString(rollB.total, modB)} = <strong>${totalB}</strong></span>
          ${allSixesB ? `<span class="rfs-roll__allsixes">✦ ${game.i18n.localize("RFS.Chat.AllSixes")}</span>` : ""}
        </div>
        <div class="rfs-roll__result">
          ${game.i18n.format("RFS.Chat.Winner", { name: winner })}
        </div>
      </div>`;

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: actorA }),
      content,
      rolls:   [rollA, rollB],
      type:    CONST.CHAT_MESSAGE_TYPES?.ROLL ?? CONST.CHAT_MESSAGE_STYLES?.ROLL ?? 0,
    });

    // Advancement checks
    if (allSixesA) await RfsSkillRoll._triggerAdvancement(actorA, skillA);
    if (allSixesB) await RfsSkillRoll._triggerAdvancement(actorB, skillB);

    // XP for the loser
    if (totalA < totalB) await actorA.addXp(1);
    else if (totalB < totalA) await actorB.addXp(1);
  }

  /**
   * Roll a skill against a static difficulty number.
   *
   * @param {RfsActor} actor
   * @param {object}   skill
   * @param {number}   difficulty
   * @returns {Promise<void>}
   */
  static async rollVsDifficulty(actor, skill, difficulty) {
    return RfsSkillRoll.roll(actor, skill, { difficulty });
  }

  /* -------------------------------------------- */
  /*  Internal Helpers                            */
  /* -------------------------------------------- */

  /**
   * Build and post the chat message for a single-actor roll.
   * @private
   */
  static async _postRollMessage(actor, skill, roll, dice, rawTotal, modifier, total, allSixes, options) {
    const modStr   = RfsSkillRoll._modifierString(rawTotal, modifier);
    const flavor   = options.flavor ?? `${actor.name}: ${skill.name} (${skill.level}d6)`;

    let resultLine = "";
    if (options.difficulty !== undefined) {
      const success = total >= options.difficulty;
      resultLine = success
        ? `<div class="rfs-roll__result rfs-roll__result--success">✔ ${game.i18n.localize("RFS.Chat.Success")} (vs ${options.difficulty})</div>`
        : `<div class="rfs-roll__result rfs-roll__result--failure">✘ ${game.i18n.localize("RFS.Chat.Failure")} (vs ${options.difficulty}) — +1 XP</div>`;
    }

    const content = `
      <div class="rfs-roll">
        <div class="rfs-roll__header"><strong>${flavor}</strong></div>
        <div class="rfs-roll__dice-row">
          ${dice.map(d => `<span class="rfs-die${d === 6 ? " rfs-die--six" : ""}">${d}</span>`).join("")}
        </div>
        <div class="rfs-roll__total">${modStr} = <strong>${total}</strong></div>
        ${allSixes ? `<div class="rfs-roll__allsixes">✦ ${game.i18n.localize("RFS.Chat.AllSixes")}</div>` : ""}
        ${resultLine}
      </div>`;

    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor,
      content,
    });
  }

  /**
   * Format a raw total + modifier as a readable string.
   * e.g. rawTotal=8, modifier=-2 → "8 − 2"
   *      rawTotal=8, modifier=0  → "8"
   * @private
   */
  static _modifierString(rawTotal, modifier) {
    if (modifier === 0) return `${rawTotal}`;
    if (modifier > 0)   return `${rawTotal} + ${modifier}`;
    return `${rawTotal} − ${Math.abs(modifier)}`;
  }

  /**
   * Trigger the advancement prompt when all dice show 6.
   * Opens a DialogV2.input asking the player to name their new skill,
   * then calls actor.addSkill() with the parent being the skill just rolled.
   * @private
   */
  static async _triggerAdvancement(actor, skill) {
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
    if (!name) return; // player dismissed — no advancement
    return actor.addSkill(name, skill.id);
  }
}
