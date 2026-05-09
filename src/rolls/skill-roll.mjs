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

import { getActiveChallenge, recordChallengeRoll, rebuildChallengeCard, buildAdvancementCardContent } from "../helpers/settings.mjs";

const { DialogV2 } = foundry.applications.api;

export class RfsSkillRoll {

  /* -------------------------------------------- */
  /*  Public API                                  */
  /* -------------------------------------------- */

  static async roll(actor, skill, options = {}) {
    const { difficulty, challengeId, tokenId } = RfsSkillRoll._resolveDifficulty(actor, options);
    options = { ...options, difficulty, challengeId, tokenId };

    const roll = new Roll(`${skill.level}d6`);
    await roll.evaluate();

    // Show 3D dice (DSN) or play the built-in Foundry dice sound.
    // Neither path uses roll.toMessage() any more, so we always handle this explicitly.
    if (game.dice3d) await game.dice3d.showForRoll(roll, game.user, true);
    else foundry.audio.AudioHelper.play({ src: CONFIG.sounds.dice, volume: 0.8, loop: false }, true);

    const dice     = roll.terms[0].results.map(r => r.result);
    const rawTotal = roll.total;
    const modifier = actor.system.totalStatusModifier ?? 0;
    const total    = rawTotal + modifier;
    const allSixes = dice.every(d => d === 6);
    const failed   = total < difficulty;

    // Award XP before posting so the card reflects the current XP balance
    if (failed) await actor.addXp(1);

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

    return { dice, allSixes, failed, nonSixCount: dice.filter(d => d !== 6).length, total, rawTotal, modifier };
  }

  /**
   * Standalone card XP spend (non-challenge rolls).
   * Confirms cost, deducts XP, then routes naming to advancementNamer.
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

    const skill = { id: flags.skillId, name: flags.skillName, level: flags.skillLevel };

    const confirmed = await RfsSkillRoll._confirmXpSpend(skill, nonSixCount);
    if (!confirmed) return;

    await actor.spendXp(nonSixCount);

    const namer = game.settings.get("roll-for-shoes", "advancementNamer") ?? "gm";
    if (namer === "gm" && !game.user.isGM) {
      // Mark card as pending GM name then emit socket
      const pendingFlags = { ...flags, xpSpent: true, xpCost: nonSixCount, xpPending: true };
      await message.update({
        content: RfsSkillRoll._buildStandaloneContent(
          flags.actorName, skill, flags.dice,
          flags.rawTotal, flags.modifier, flags.total,
          flags.allSixes, flags.failed, flags.difficulty,
          pendingFlags, messageId, nonSixCount,
        ),
        flags: { "roll-for-shoes": { rollData: pendingFlags } },
      });
      game.socket.emit("system.roll-for-shoes", {
        type:       "advancementNeeded",
        tokenId:    null,  challengeId: null,  messageId,
        actorId:    flags.actorId,   actorName:  flags.actorName,
        skillId:    flags.skillId,   skillName:  flags.skillName,   skillLevel: flags.skillLevel,
        xpSpent:    true,            xpCost:     nonSixCount,
      });
      return;
    }

    const name = await RfsSkillRoll._promptSkillName(skill, true);
    if (!name) return;

    await actor.addSkill(name, flags.skillId);

    const newDice  = flags.dice.map(() => 6);
    const newFlags = {
      ...flags,
      dice:             newDice,
      xpSpent:          true,
      xpCost:           nonSixCount,
      allSixes:         true,
      nonSixCount:      0,
      skillClaimed:     true,
      claimedSkillName: name,
    };

    await message.update({
      content: RfsSkillRoll._buildStandaloneContent(
        flags.actorName, skill, newDice,
        flags.rawTotal, flags.modifier, flags.total,
        true, flags.failed, flags.difficulty,
        newFlags, messageId, 0,
      ),
      flags: { "roll-for-shoes": { rollData: newFlags } },
    });
  }

  /**
   * Claim advancement on a standalone result card (non-challenge rolls).
   * Routes naming to advancementNamer — player names locally, GM via socket.
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

    const namer = game.settings.get("roll-for-shoes", "advancementNamer") ?? "gm";
    if (namer === "gm" && !game.user.isGM) {
      game.socket.emit("system.roll-for-shoes", {
        type:       "advancementNeeded",
        tokenId:    null,   challengeId: null,   messageId,
        actorId:    actor.id,   actorName:  actor.name,
        skillId:    skill.id,   skillName:  skill.name,   skillLevel: skill.level,
        xpSpent:    false,      xpCost:     0,
      });
      return;
    }

    const name = await RfsSkillRoll._promptSkillName(skill, false);
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
            newFlags, messageId, flags.nonSixCount ?? 0,
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
    const tokenId     = options.tokenId ?? actor.getActiveTokens()?.[0]?.id;
    const namer       = game.settings.get("roll-for-shoes", "advancementNamer") ?? "gm";

    const rollResult = {
      actorName:          actor.name,
      actorImg:           actor.img,
      skillName:          skill.name,
      skillLevel:         skill.level,
      dice, rawTotal, modifier, total, allSixes, failed,
      actorId:            actor.id,
      skillId:            skill.id,
      nonSixCount,
      skillClaimed:       false,
      advancementPending: allSixes,
    };

    // ── XP Spend (any roll that isn't all-sixes) ──────────────────────────
    // actor.system.xp is already current (XP was awarded on failure before this call).
    if (!allSixes && nonSixCount > 0 && actor.system.xp >= nonSixCount) {
      const confirmed = await RfsSkillRoll._confirmXpSpend(skill, nonSixCount);
      if (confirmed) {
        await actor.spendXp(nonSixCount);
        rollResult.xpSpent            = true;
        rollResult.xpCost             = nonSixCount;
        rollResult.advancementPending = true;

        if (namer === "player" || game.user.isGM) {
          const newSkillName = await RfsSkillRoll._promptSkillName(skill, true);
          if (newSkillName) {
            await actor.addSkill(newSkillName, skill.id);
            rollResult.skillClaimed       = true;
            rollResult.claimedSkillName   = newSkillName;
            rollResult.advancementPending = false;
          }
        }
        // namer=gm + player client: emit advancementNeeded after recordChallengeRoll below
      }
    }

    // ── Record roll: GM writes directly; players send via socket ──────────
    if (tokenId) {
      if (game.user.isGM) {
        await recordChallengeRoll(tokenId, rollResult);
      } else {
        game.socket.emit("system.roll-for-shoes", {
          type: "recordChallengeRoll",
          tokenId,
          rollResult,
        });
      }
    }

    // ── XP Spend → GM naming (emit after recording so card shows pending) ─
    if (rollResult.xpSpent && !rollResult.skillClaimed && !game.user.isGM && tokenId) {
      game.socket.emit("system.roll-for-shoes", {
        type:       "advancementNeeded",
        tokenId,    challengeId,
        actorId:    actor.id,   actorName:  actor.name,
        skillId:    skill.id,   skillName:  skill.name,   skillLevel: skill.level,
        xpSpent:    true,       xpCost:     nonSixCount,
      });
    }

    // ── Natural advancement (all sixes, not already claimed via XP) ───────
    if (allSixes && !rollResult.skillClaimed) {
      if (namer === "player") {
        const newSkillName = await RfsSkillRoll._promptSkillName(skill, false);
        if (newSkillName && tokenId) {
          await actor.addSkill(newSkillName, skill.id);
          if (game.user.isGM) {
            await RfsSkillRoll._gmMarkAdvancementClaimed(tokenId, newSkillName, actor.name, skill.name, skill.level + 1, false, 0);
          } else {
            game.socket.emit("system.roll-for-shoes", {
              type:            "claimAdvancement",
              tokenId,         challengeId,
              newSkillName,
              actorName:       actor.name,
              parentSkillName: skill.name,
              newLevel:        skill.level + 1,
            });
          }
        }
      } else {
        // GM namer
        if (game.user.isGM) {
          const newSkillName = await RfsSkillRoll._promptGmSkillName(actor.name, skill, false);
          if (newSkillName) {
            await actor.addSkill(newSkillName, skill.id);
            await RfsSkillRoll._gmMarkAdvancementClaimed(tokenId, newSkillName, actor.name, skill.name, skill.level + 1, false, 0);
          }
        } else if (tokenId) {
          game.socket.emit("system.roll-for-shoes", {
            type:       "advancementNeeded",
            tokenId,    challengeId,
            actorId:    actor.id,   actorName:  actor.name,
            skillId:    skill.id,   skillName:  skill.name,   skillLevel: skill.level,
            xpSpent:    false,      xpCost:     0,
          });
        }
      }
    }
  }

  // Updates challenge state after the GM has named a new skill,
  // then posts the advancement announcement card.
  static async _gmMarkAdvancementClaimed(tokenId, newSkillName, actorName, parentSkillName, newLevel, xpSpent = false, xpCost = 0) {
    const challenge = getActiveChallenge();
    if (challenge?.results?.[tokenId]) {
      const updated = {
        ...challenge,
        results: {
          ...challenge.results,
          [tokenId]: {
            ...challenge.results[tokenId],
            skillClaimed:       true,
            claimedSkillName:   newSkillName,
            advancementPending: false,
            xpSpent,
            xpCost,
          },
        },
      };
      await game.settings.set("roll-for-shoes", "activeChallenge", updated);
      await rebuildChallengeCard(updated);
    }
    await ChatMessage.create({
      content: buildAdvancementCardContent(actorName, newSkillName, parentSkillName, newLevel, xpSpent, xpCost),
    });
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

    // Put the skill name in the speaker alias so it appears in Foundry's native
    // message header — no custom header div needed inside the card content.
    const speaker = { ...ChatMessage.getSpeaker({ actor }), alias: `${actor.name} · ${skill.name} (${skill.level}d6)` };

    const message = await ChatMessage.create({
      speaker,
      content: RfsSkillRoll._buildStandaloneContent(
        actor.name, skill, dice, rawTotal, modifier, total,
        allSixes, failed, options.difficulty, rollData, "PENDING", nonSixCount,
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
      return { difficulty: options.difficulty, challengeId: null, tokenId: null };
    }

    if (options.challengeId) {
      const challenge = getActiveChallenge();
      if (challenge && challenge.challengeId === options.challengeId) {
        return { difficulty: challenge.dc, challengeId: challenge.challengeId, tokenId: options.tokenId ?? null };
      }
    }

    const challenge = getActiveChallenge();
    if (challenge) {
      const actorTokens = actor.getActiveTokens?.() ?? [];
      const matchingToken = actorTokens.find(t => challenge.tokenIds.includes(t.id));
      if (matchingToken) {
        return { difficulty: challenge.dc, challengeId: challenge.challengeId, tokenId: matchingToken.id };
      }
    }

    return { difficulty: 4, challengeId: null, tokenId: null };
  }

  static _buildStandaloneContent(actorName, skill, dice, rawTotal, modifier, total, allSixes, failed, difficulty, rollData, messageId, nonSixCount = 0) {
    const resultLine = failed
      ? `<div class="rfs-roll__result rfs-roll__result--failure">&#x2718; ${game.i18n.localize("RFS.Chat.Failure")} (${total} vs ${difficulty}) &mdash; +1 XP</div>`
      : `<div class="rfs-roll__result rfs-roll__result--success">&#x2714; ${game.i18n.localize("RFS.Chat.Success")} (${total} vs ${difficulty})</div>`;

    let actionArea = "";

    if (rollData.skillClaimed) {
      const note = rollData.xpSpent
        ? game.i18n.format("RFS.Chat.ClaimedXp", { name: rollData.claimedSkillName, cost: rollData.xpCost })
        : game.i18n.format("RFS.Chat.Claimed",   { name: rollData.claimedSkillName });
      actionArea = `<div class="rfs-roll__claimed">${note}</div>`;
    } else if (rollData.xpPending) {
      actionArea = `<div class="rfs-roll__claimed rfs-roll__claimed--pending">${game.i18n.localize("RFS.Chat.AdvancementWaiting")}</div>`;
    } else if (allSixes) {
      actionArea = RfsSkillRoll._advancementButton(
        { id: rollData.actorId },
        { id: rollData.skillId },
        messageId,
      );
    } else if (!rollData.xpSpent && nonSixCount > 0) {
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
        <div class="rfs-roll__dice-row">
          ${dice.map(d => `<span class="rfs-die${d === 6 ? " rfs-die--six" : ""}">${d}</span>`).join("")}
        </div>
        ${resultLine}
        ${actionArea}
      </div>`;
  }

  // ── Themed advancement dialogs ────────────────────────────────────────

  static async _confirmXpSpend(skill, cost) {
    return DialogV2.confirm({
      window:  { title: game.i18n.localize("RFS.Chat.XpSpendTitle") },
      content: `
        <div class="rfs-adv-dlg rfs-adv-dlg--spend">
          <p class="rfs-adv-dlg__headline">${game.i18n.format("RFS.Dialog.Advancement.SpendHeadline", { cost })}</p>
          <p class="rfs-adv-dlg__detail">${game.i18n.format("RFS.Dialog.Advancement.Hint", { skill: skill.name, level: skill.level + 1 })}</p>
        </div>`,
      yes: { label: game.i18n.format("RFS.Chat.SpendXp", { cost }) },
      no:  { label: game.i18n.localize("RFS.Dialog.Challenge.Cancel") },
    });
  }

  static async _promptSkillName(skill, xpSpent) {
    const headline = xpSpent
      ? game.i18n.localize("RFS.Dialog.Advancement.SpendNamingHeadline")
      : game.i18n.localize("RFS.Dialog.Advancement.EarnHeadline");
    const title    = xpSpent
      ? game.i18n.localize("RFS.Dialog.Advancement.SpendTitle")
      : game.i18n.localize("RFS.Dialog.Advancement.Title");
    const result = await DialogV2.input({
      window:  { title },
      content: `
        <div class="rfs-adv-dlg ${xpSpent ? "rfs-adv-dlg--spend" : "rfs-adv-dlg--earn"}">
          <p class="rfs-adv-dlg__headline">${headline}</p>
          <p class="rfs-adv-dlg__detail">${game.i18n.format("RFS.Dialog.Advancement.Hint", { skill: skill.name, level: skill.level + 1 })}</p>
          <input type="text" name="skillName"
                 placeholder="${game.i18n.localize("RFS.Dialog.NewSkill.Placeholder")}"
                 autofocus style="width:100%;margin-top:0.75rem">
        </div>`,
      ok: { label: game.i18n.localize("RFS.Dialog.Advancement.Confirm") },
    });
    return result?.skillName?.trim() ?? null;
  }

  static async _promptGmSkillName(actorName, skill, xpSpent) {
    const headline = xpSpent
      ? game.i18n.format("RFS.Dialog.Advancement.GmSpendHeadline", { actor: actorName })
      : game.i18n.format("RFS.Dialog.Advancement.GmEarnHeadline",  { actor: actorName });
    const title    = `${actorName} — ${xpSpent
      ? game.i18n.localize("RFS.Dialog.Advancement.SpendTitle")
      : game.i18n.localize("RFS.Dialog.Advancement.Title")}`;
    const result = await DialogV2.input({
      window:  { title },
      content: `
        <div class="rfs-adv-dlg rfs-adv-dlg--gm">
          <p class="rfs-adv-dlg__headline">${headline}</p>
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
