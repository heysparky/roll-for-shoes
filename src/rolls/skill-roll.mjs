/**
 * src/rolls/skill-roll.mjs
 * ============================
 * Core roll logic for Roll for Shoes.
 *
 * CARD ARCHITECTURE:
 *   Challenge roll  → result row on the shared challenge card (no orphan card)
 *                   → advancement whisper card if all-sixes
 *                   → XP spend whisper card if failed with non-sixes
 *   Standalone roll → posts its own result card as before
 *
 * WHISPER CARD LIFECYCLE:
 *   Cards are never deleted — deleting shifts the chat queue and makes the
 *   UI jumpy. Instead, each card crystallises in place when its action
 *   completes: content is replaced with a quiet confirmation, inputs are
 *   gone, nothing can be clicked again.
 *
 * XP SPEND RULE:
 *   Cost = count of non-six dice. Checked at click time against live XP.
 *   Success/failure against DC is never affected by XP spend.
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
   * Called when a player clicks the Roll button on their whispered widget card.
   * After rolling, crystallises the widget in place so chat queue stays stable.
   */
  static async rollFromWidget(messageId, skillId) {
    const message = game.messages.get(messageId);
    if (!message) return;

    const flags = message.flags?.["roll-for-shoes"];
    if (!flags || flags.type !== "playerWidget") return;
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

    // Roll first — if it errors the widget stays interactive so the player can retry
    await RfsSkillRoll.roll(actor, skill, {
      challengeId: flags.challengeId,
      tokenId:     flags.tokenId,
    });

    // Crystallise the widget in place — never delete, deletion shifts the queue
    await message.update({
      content: `<div class="rfs-widget rfs-widget--done">
        <span class="rfs-widget__done-note">
          \u2713 ${game.i18n.localize("RFS.Widget.RollSent")}
        </span>
      </div>`,
      flags: { "roll-for-shoes": { ...flags, rolled: true } },
    });
  }

  /**
   * Finalise a skill claim from an advancement widget.
   * Called by the renderChatMessageHTML hook with the name the player typed.
   * Crystallises the widget and updates the challenge card row.
   *
   * @param {string} messageId     - the advancement widget message ID
   * @param {string} newSkillName  - name the player entered
   */
  static async finaliseAdvancement(messageId, newSkillName) {
    const message = game.messages.get(messageId);
    if (!message) return;

    const flags = message.flags?.["roll-for-shoes"];
    if (!flags || flags.type !== "advancementWidget") return;
    if (flags.claimed) return;

    const name = newSkillName?.trim();
    if (!name) return;

    const actor = game.actors.get(flags.actorId);
    if (!actor) return;
    const skill = actor.getSkillById(flags.skillId);
    if (!skill) return;

    // Add the new skill to the actor
    await actor.addSkill(name, flags.skillId);

    // Crystallise the advancement widget in place
    await message.update({
      content: `<div class="rfs-advancement-widget rfs-advancement-widget--done">
        <span class="rfs-advancement-widget__done-note">
          \u2726 ${game.i18n.format("RFS.Chat.SkillClaimed", { name })}
        </span>
      </div>`,
      flags: { "roll-for-shoes": { ...flags, claimed: true } },
    });

    // Update the challenge card row to show the new skill name
    if (flags.challengeId && flags.tokenId) {
      const { getActiveChallenge, rebuildChallengeCard } = await import("../helpers/settings.mjs");
      const challenge = getActiveChallenge();
      if (challenge && challenge.results?.[flags.tokenId]) {
        const updatedResults = {
          ...challenge.results,
          [flags.tokenId]: {
            ...challenge.results[flags.tokenId],
            skillClaimed:       true,
            claimedSkillName:   name,
            advancementPending: false,
          },
        };
        const updated = { ...challenge, results: updatedResults };
        await game.settings.set("roll-for-shoes", "activeChallenge", updated);
        await rebuildChallengeCard(updated);
      }
    }
  }

  /**
   * Called when a player clicks "Spend XP" on their XP spend widget card.
   * Spends XP, crystallises the widget, then posts an advancement widget.
   */
  static async spendXpFromWidget(messageId) {
    const message = game.messages.get(messageId);
    if (!message) return;

    const flags = message.flags?.["roll-for-shoes"];
    if (!flags || flags.type !== "xpSpendWidget") return;
    if (flags.spent) return;

    const actor = game.actors.get(flags.actorId);
    if (!actor) return;

    const nonSixCount = flags.nonSixCount;
    if (actor.system.xp < nonSixCount) {
      ui.notifications.warn(game.i18n.format("RFS.Warn.NotEnoughXp", {
        cost: nonSixCount,
        xp:   actor.system.xp,
      }));
      return;
    }

    await actor.spendXp(nonSixCount);

    // Crystallise the XP spend widget in place
    await message.update({
      content: `<div class="rfs-xpspend-widget rfs-xpspend-widget--done">
        <span class="rfs-xpspend-widget__done-note">
          ${game.i18n.format("RFS.Chat.XpSpentAdvancement", { cost: nonSixCount })}
        </span>
      </div>`,
      flags: { "roll-for-shoes": { ...flags, spent: true } },
    });

    // Post the advancement widget — spend triggers advancement
    const skill = actor.getSkillById(flags.skillId);
    if (skill) {
      await RfsSkillRoll._postAdvancementWidget({
        actor,
        skill,
        tokenId:     flags.tokenId,
        challengeId: flags.challengeId,
        xpPurchased: true,  // came from XP spend, not natural all-sixes
      });
    }
  }

  /**
   * Standalone card XP spend (non-challenge rolls). Preserved from original.
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
          ${allSixesA ? `<span class="rfs-roll__allsixes">\u2726 ${game.i18n.localize("RFS.Chat.AllSixes")}</span>` : ""}
          ${allSixesA ? RfsSkillRoll._advancementButton(actorA, skillA) : ""}
        </div>
        <div class="rfs-roll__row">
          <span class="rfs-roll__actor">${actorB.name}</span>
          <span class="rfs-roll__skill">${skillB.name} (${skillB.level}d6)</span>
          <span class="rfs-roll__dice">[${diceB.join(", ")}]</span>
          <span class="rfs-roll__total">${RfsSkillRoll._modifierString(rollB.total, modB)} = <strong>${totalB}</strong></span>
          ${allSixesB ? `<span class="rfs-roll__allsixes">\u2726 ${game.i18n.localize("RFS.Chat.AllSixes")}</span>` : ""}
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

    // Record result — rebuilds the challenge card row automatically.
    // Prefer tokenId from widget flags (reliable); fall back to canvas lookup.
    const tokenId = options.tokenId ?? actor.getActiveTokens()?.[0]?.id;
    if (tokenId) await recordChallengeRoll(tokenId, rollResult);

    // Personal whisper cards — challenge card stays clean, no buttons there
    if (allSixes) {
      await RfsSkillRoll._postAdvancementWidget({
        actor, skill, tokenId, challengeId, xpPurchased: false,
      });
    } else if (failed && nonSixCount > 0) {
      await RfsSkillRoll._postXpSpendWidget({
        actor, skill, dice, nonSixCount, tokenId, challengeId, whisperTargets,
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
  /*  Advancement & XP Spend Whisper Cards        */
  /* -------------------------------------------- */

  /**
   * Post a whispered advancement card to the player who earned all sixes.
   * The player types their new skill name inline and clicks Claim.
   * The shared challenge card has no button — this card is their personal moment.
   * Card crystallises in place when claimed rather than being deleted.
   *
   * @param {object}   opts
   * @param {RfsActor} opts.actor
   * @param {object}   opts.skill        - { id, name, level }
   * @param {string}   opts.tokenId
   * @param {string}   opts.challengeId
   * @param {boolean}  opts.xpPurchased  - true when triggered by XP spend, not natural all-sixes
   */
  static async _postAdvancementWidget({ actor, skill, tokenId, challengeId, xpPurchased }) {
    const whisperTargets = RfsSkillRoll._whisperTargetsForActor(actor);

    // ── Prompt text ───────────────────────────────────────────────────────────
    // TODO: write distinct prompt copy for each advancement type.
    //   Natural all-sixes (xpPurchased === false):
    //     Celebratory — "All sixes! You've earned a new skill."
    //   XP purchased  (xpPurchased === true):
    //     Acknowledge the cost — "You push through. Name what you've learned."
    // For now both paths use the same RFS.Dialog.Advancement.Hint text.
    // Come back here once copy is finalised.
    const promptText = game.i18n.format("RFS.Dialog.Advancement.Hint", {
      skill: skill.name,
      level: skill.level + 1,
    });

    const content = `
      <div class="rfs-advancement-widget"
           data-actor-id="${actor.id}"
           data-skill-id="${skill.id}"
           data-token-id="${tokenId ?? ""}"
           data-challenge-id="${challengeId ?? ""}"
           data-xp-purchased="${xpPurchased}">
        <div class="rfs-advancement-widget__header">
          <strong>\u2726 ${game.i18n.localize("RFS.Dialog.Advancement.Title")}</strong>
        </div>
        <div class="rfs-advancement-widget__prompt">${promptText}</div>
        <div class="rfs-advancement-widget__input-row">
          <input type="text"
                 class="rfs-advancement-widget__name-input"
                 placeholder="${game.i18n.localize("RFS.Dialog.NewSkill.Placeholder")}"
                 maxlength="60">
          <button type="button"
                  class="rfs-btn rfs-btn--primary rfs-advancement-widget__claim-btn"
                  data-action="rfsClaimFromWidget"
                  disabled>
            \u2726 ${game.i18n.localize("RFS.Dialog.Advancement.Confirm")}
          </button>
        </div>
      </div>`;

    await ChatMessage.create({
      content,
      whisper: whisperTargets,
      flags: {
        "roll-for-shoes": {
          type:        "advancementWidget",
          actorId:     actor.id,
          skillId:     skill.id,
          tokenId:     tokenId ?? "",
          challengeId: challengeId ?? "",
          xpPurchased,
          claimed:     false,
        },
      },
    });
  }

  /**
   * Post a whispered XP spend card for a failed challenge roll.
   * Lets the player spend XP to force all-sixes and trigger advancement.
   * Card crystallises in place after spending rather than being deleted.
   */
  static async _postXpSpendWidget({ actor, skill, dice, nonSixCount, tokenId, challengeId, whisperTargets }) {
    const liveXp    = actor.system.xp ?? 0;
    const canAfford = liveXp >= nonSixCount;

    const diceHtml = dice
      .map(d => `<span class="rfs-die${d === 6 ? " rfs-die--six" : ""}">${d}</span>`)
      .join("");

    const content = `
      <div class="rfs-xpspend-widget"
           data-actor-id="${actor.id}"
           data-skill-id="${skill.id}"
           data-token-id="${tokenId ?? ""}"
           data-challenge-id="${challengeId ?? ""}"
           data-non-six-count="${nonSixCount}">
        <div class="rfs-xpspend-widget__header">
          <strong>${game.i18n.localize("RFS.Chat.XpSpendTitle")}</strong>
        </div>
        <div class="rfs-xpspend-widget__dice">${diceHtml}</div>
        ${canAfford
          ? `<button type="button"
                     class="rfs-btn rfs-btn--spend-xp"
                     data-action="rfsWidgetSpendXp">
               ${game.i18n.format("RFS.Chat.SpendXp", { cost: nonSixCount })}
             </button>`
          : `<div class="rfs-xpspend-widget__cant-afford">
               ${game.i18n.format("RFS.Warn.NotEnoughXp", { cost: nonSixCount, xp: liveXp })}
             </div>`
        }
      </div>`;

    await ChatMessage.create({
      content,
      whisper: whisperTargets,
      flags: {
        "roll-for-shoes": {
          type:        "xpSpendWidget",
          actorId:     actor.id,
          skillId:     skill.id,
          tokenId:     tokenId ?? "",
          challengeId: challengeId ?? "",
          nonSixCount,
          spent:       false,
        },
      },
    });
  }

  /**
   * Whisper targets = GM(s) + the player who owns this actor.
   * @param {RfsActor} actor
   * @returns {string[]} user IDs
   */
  static _whisperTargetsForActor(actor) {
    const rollingUser = game.users.find(u => u.character?.id === actor.id && !u.isGM);
    return [
      ...game.users.filter(u => u.isGM).map(u => u.id),
      ...(rollingUser ? [rollingUser.id] : []),
    ];
  }

  /* -------------------------------------------- */
  /*  Internal Helpers                            */
  /* -------------------------------------------- */

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
      ? `<div class="rfs-roll__result rfs-roll__result--failure">\u2718 ${game.i18n.localize("RFS.Chat.Failure")} (vs ${difficulty}) \u2014 +1 XP</div>`
      : `<div class="rfs-roll__result rfs-roll__result--success">\u2714 ${game.i18n.localize("RFS.Chat.Success")} (vs ${difficulty})</div>`;

    let actionArea = "";

    if (rollData.skillClaimed) {
      actionArea = `<div class="rfs-roll__xp-note">\u2726 ${game.i18n.format("RFS.Chat.SkillClaimed", { name: rollData.claimedSkillName })}</div>`;
    } else if (allSixes) {
      if (rollData.xpSpent) {
        actionArea = `<div class="rfs-roll__xp-note">\u2726 ${game.i18n.format("RFS.Chat.XpSpentAllSixes", { cost: rollData.xpCost })}</div>`;
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
        ${allSixes ? `<div class="rfs-roll__allsixes">\u2726 ${game.i18n.localize("RFS.Chat.AllSixes")}</div>` : ""}
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
        \u2726 ${game.i18n.localize("RFS.Dialog.Advancement.Confirm")}
      </button>`;
  }

  static _modifierString(rawTotal, modifier) {
    if (modifier === 0) return `${rawTotal}`;
    if (modifier > 0)   return `${rawTotal} + ${modifier}`;
    return `${rawTotal} \u2212 ${Math.abs(modifier)}`;
  }
}
