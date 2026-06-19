/**
 * src/rolls/skill-roll.mjs
 * ============================
 * Core roll logic for Roll for Shoes.
 *
 * All rolls use the global DC from the DC tracker (game.settings "globalDc").
 * Results fire the RollSplash overlay, then open a RfsVerdictDialog for
 * actionable outcomes (all-sixes or failure with enough XP to spend).
 * Plain successes show the splash only — no dialog.
 */

import { buildAdvancementCardContent } from "../helpers/settings.mjs";
import { RollSplash } from "../ui/roll-splash.mjs";
import { RfsVerdictDialog } from "../ui/roll-verdict-dialog.mjs";

const { DialogV2 } = foundry.applications.api;

export class RfsSkillRoll {

  /* -------------------------------------------- */
  /*  Public API                                  */
  /* -------------------------------------------- */

  static async roll(actor, skill, options = {}) {
    const difficulty = RfsSkillRoll._resolveDifficulty(options);
    options = { ...options, difficulty };

    const roll = new Roll(`${skill.level}d6`);
    await roll.evaluate();

    // Show 3D dice (DSN) or play the built-in Foundry dice sound.
    if (game.dice3d) await game.dice3d.showForRoll(roll, game.user, true);
    else foundry.audio.AudioHelper.play({ src: CONFIG.sounds.dice, volume: 0.8, loop: false }, true);

    const dice     = roll.terms[0].results.map(r => r.result);
    const rawTotal = roll.total;
    const modifier = actor.system.totalStatusModifier ?? 0;
    const total    = rawTotal + modifier;
    const allSixes = dice.every(d => d === 6);
    const failed   = total < difficulty;

    // Award XP on failure before opening the dialog so it reflects the live balance.
    if (failed) await actor.addXp(1);

    await actor.addRollHistory({ skillName: skill.name, skillLevel: skill.level, dice, rawTotal, modifier, total, difficulty, failed, allSixes });

    // Full-screen splash — fires on the roller's client; broadcast via socket if needed.
    const splashKind     = allSixes ? "critical" : failed ? "fail" : "success";
    const splashAudience = game.settings.get("roll-for-shoes", "splashAudience");
    RollSplash.show(splashKind);
    if (splashAudience === "all" || (splashAudience === "roller_gm" && !game.user.isGM)) {
      game.socket.emit("system.roll-for-shoes", {
        type:   "splashShow",
        kind:   splashKind,
        gmOnly: splashAudience === "roller_gm",
      });
    }

    const nonSixCount = dice.filter(d => d !== 6).length;
    const canSpendXp  = failed && nonSixCount > 0 && actor.system.xp >= nonSixCount;

    // Open the verdict dialog only when there is something to do:
    //   allSixes  → claim a new skill (free)
    //   canSpendXp → spend XP to turn every die to a 6 and claim
    // Plain success: splash only, no dialog.
    if (allSixes || canSpendXp) {
      RfsVerdictDialog.open({
        actorName: actor.name,
        skillName: skill.name,
        dice,
        outcome:   allSixes ? "allsixes" : "fail",
        xpEarned:  1,
        xpCost:    nonSixCount,
        onClaim: async (name, xpWasSpent) => {
          if (xpWasSpent) await actor.spendXp(nonSixCount);
          await actor.addSkill(name, skill.id);
          await ChatMessage.create({
            content: buildAdvancementCardContent(
              actor.name, name, skill.name, skill.level + 1,
              xpWasSpent, xpWasSpent ? nonSixCount : 0,
            ),
          });
        },
        onTakeXp: () => {},
        onClose:  () => {},
      });
    }

    return { dice, allSixes, failed, nonSixCount, total, rawTotal, modifier };
  }

  /**
   * Claim a new skill from an opposed-roll all-sixes advancement button.
   * Player always names their own skill.
   */
  static async claimAdvancement(actorId, skillId) {
    const actor = game.actors.get(actorId);
    if (!actor) return;
    const skill = actor.getSkillById(skillId);
    if (!skill) return;

    const name = await RfsSkillRoll._promptSkillName(skill);
    if (!name) return;

    await actor.addSkill(name, skill.id);
    await ChatMessage.create({
      content: buildAdvancementCardContent(actor.name, name, skill.name, skill.level + 1, false, 0),
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
  /*  Internal Helpers                            */
  /* -------------------------------------------- */

  static _resolveDifficulty(options) {
    if (options.difficulty !== undefined) return options.difficulty;
    return game.settings.get("roll-for-shoes", "globalDc") ?? 4;
  }

  static async _promptSkillName(skill) {
    const result = await DialogV2.input({
      window:  { title: game.i18n.localize("RFS.Dialog.Advancement.Title") },
      content: `
        <div class="rfs-adv-dlg rfs-adv-dlg--earn">
          <p class="rfs-adv-dlg__headline">${game.i18n.localize("RFS.Dialog.Advancement.EarnHeadline")}</p>
          <p class="rfs-adv-dlg__detail">${game.i18n.format("RFS.Dialog.Advancement.Hint", { skill: skill.name, level: skill.level + 1 })}</p>
          <input type="text" name="skillName"
                 placeholder="${game.i18n.localize("RFS.Dialog.NewSkill.Placeholder")}"
                 autofocus style="width:100%;margin-top:0.75rem">
        </div>`,
      ok: { label: game.i18n.localize("RFS.Dialog.Advancement.Confirm") },
    });
    return result?.skillName?.trim() ?? null;
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
