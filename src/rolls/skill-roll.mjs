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
 *
 *   RfsSkillRoll.opposed(actorA, skillA, actorB, skillB)
 *     - Rolls both actors simultaneously
 *     - Compares totals (with status modifiers)
 *     - Posts a combined chat card
 *
 *   RfsSkillRoll.rollVsDifficulty(actor, skill, difficulty)
 *     - Rolls actor's skill against a static difficulty number
 *
 *   RfsSkillRoll.claimAdvancement(actorId, skillId)
 *     - Called when the player clicks the "Claim Skill" button in chat
 *     - Opens the naming dialog and adds the new skill
 *
 * OPTIONS shape:
 *   {
 *     flavor:     string,   // optional override for chat message flavor
 *     difficulty: number,   // static threshold (undefined = narrative only)
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
    // Default difficulty is 4 — every roll has opposition
    const difficulty = options.difficulty ?? 4;
    options = { ...options, difficulty };

    const roll = new Roll(`${skill.level}d6`);
    await roll.evaluate();

    const dice     = roll.terms[0].results.map(r => r.result);
    const rawTotal = roll.total;
    const modifier = actor.system.totalStatusModifier ?? 0;
    const total    = rawTotal + modifier;
    const allSixes = dice.every(d => d === 6);

    await RfsSkillRoll._postRollMessage(actor, skill, roll, dice, rawTotal, modifier, total, allSixes, options);

    // Every failed roll grants XP — all rolls have opposition (default difficulty 4)
    if (total < difficulty) {
      await actor.addXp(1);
    }
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
   * Build and post the chat message for a single-actor roll.
   * @private
   */
  static async _postRollMessage(actor, skill, roll, dice, rawTotal, modifier, total, allSixes, options) {
    const modStr = RfsSkillRoll._modifierString(rawTotal, modifier);
    const flavor = options.flavor ?? `${actor.name}: ${skill.name} (${skill.level}d6)`;

    let resultLine = "";
    if (options.difficulty !== undefined) {
      const success = total >= options.difficulty;
      resultLine = success
        ? `<div class="rfs-roll__result rfs-roll__result--success">✔ ${game.i18n.localize("RFS.Chat.Success")} (vs ${options.difficulty})</div>`
        : `<div class="rfs-roll__result rfs-roll__result--failure">✘ ${game.i18n.localize("RFS.Chat.Failure")} (vs ${options.difficulty}) — +1 XP</div>`;
    }

    const advButton = allSixes ? RfsSkillRoll._advancementButton(actor, skill) : "";

    const content = `
      <div class="rfs-roll">
        <div class="rfs-roll__header"><strong>${flavor}</strong></div>
        <div class="rfs-roll__dice-row">
          ${dice.map(d => `<span class="rfs-die${d === 6 ? " rfs-die--six" : ""}">${d}</span>`).join("")}
        </div>
        <div class="rfs-roll__total">${modStr} = <strong>${total}</strong></div>
        ${allSixes ? `<div class="rfs-roll__allsixes">✦ ${game.i18n.localize("RFS.Chat.AllSixes")}</div>` : ""}
        ${advButton}
        ${resultLine}
      </div>`;

    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor,
      content,
    });
  }

  /**
   * Build the "Claim Skill" button HTML for embedding in a chat card.
   * The renderChatMessage hook in roll-for-shoes.mjs wires up the click.
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
   * e.g. rawTotal=8, modifier=-2 → "8 − 2"
   *      rawTotal=8, modifier=0  → "8"
   * @private
   */
  static _modifierString(rawTotal, modifier) {
    if (modifier === 0) return `${rawTotal}`;
    if (modifier > 0)   return `${rawTotal} + ${modifier}`;
    return `${rawTotal} − ${Math.abs(modifier)}`;
  }
}
