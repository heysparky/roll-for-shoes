/**
 * roll-for-shoes.mjs
 * ==================
 * Entry point for the Roll for Shoes game system.
 */

import { CharacterData, NpcData } from "./src/data/actor-data.mjs";
import { RfsActor } from "./src/documents/actor.mjs";
import { RfsCharacterSheet } from "./src/sheets/character-sheet.mjs";
import { RfsNpcSheet } from "./src/sheets/npc-sheet.mjs";
import { RfsTokenHUD } from "./src/hud/token-hud.mjs";
import { preloadHandlebarsTemplates, registerHandlebarsHelpers } from "./src/helpers/templates.mjs";
import { registerSystemSettings, getActiveChallenge, recordChallengeRoll, rebuildChallengeCard } from "./src/helpers/settings.mjs";
import { RFS } from "./src/helpers/config.mjs";
import { RfsSkillRoll } from "./src/rolls/skill-roll.mjs";
import { RfsChallengePlayerDialog } from "./src/dialogs/challenge-player-dialog.mjs";

/* -------------------------------------------- */
/*  Init Hook                                   */
/* -------------------------------------------- */

Hooks.once("init", function () {
  console.log("RFS | Initialising Roll for Shoes");

  game.rfs = {
    RfsActor,
    RfsSkillRoll,
    RfsChallengePlayerDialog,
    config: RFS,
  };

  registerSystemSettings();

  CONFIG.Actor.dataModels.character = CharacterData;
  CONFIG.Actor.dataModels.npc = NpcData;
  CONFIG.Actor.documentClass = RfsActor;
  CONFIG.Token.hudClass = RfsTokenHUD;

  const { DocumentSheetConfig } = foundry.applications.apps;

  DocumentSheetConfig.unregisterSheet(Actor, "core", foundry.appv1.sheets.ActorSheet);

  DocumentSheetConfig.registerSheet(Actor, "roll-for-shoes", RfsCharacterSheet, {
    types: ["character"],
    makeDefault: true,
    label: "RFS.SheetLabel.Character",
  });

  DocumentSheetConfig.registerSheet(Actor, "roll-for-shoes", RfsNpcSheet, {
    types: ["npc"],
    makeDefault: true,
    label: "RFS.SheetLabel.Npc",
  });

  registerHandlebarsHelpers();
  return preloadHandlebarsTemplates();
});

/* -------------------------------------------- */
/*  Ready Hook                                  */
/* -------------------------------------------- */

Hooks.once("ready", function () {
  console.log("RFS | Roll for Shoes is ready.");

  game.socket.on("system.roll-for-shoes", async (data) => {
    switch (data.type) {

      // ── Players receive: auto-open their challenge popup ────────────────
      case "openChallengeDialog":
        if (game.user.isGM) break;
        for (const { tokenId, actorId } of data.tokens) {
          const actor = game.actors.get(actorId);
          if (actor?.testUserPermission(game.user, "OWNER")) {
            RfsChallengePlayerDialog.open(tokenId, actorId, data.challengeId);
            break;
          }
        }
        break;

      // ── GM receives: record a player's roll result in world settings ────
      case "recordChallengeRoll":
        if (!game.user.isGM) break;
        await recordChallengeRoll(data.tokenId, data.rollResult);
        break;

      // ── GM receives: mark a skill as claimed on the challenge card ──────
      case "claimAdvancement": {
        if (!game.user.isGM) break;
        const challenge = getActiveChallenge();
        if (!challenge?.results?.[data.tokenId]) break;
        const updatedResults = {
          ...challenge.results,
          [data.tokenId]: {
            ...challenge.results[data.tokenId],
            skillClaimed:       true,
            claimedSkillName:   data.newSkillName,
            advancementPending: false,
          },
        };
        const updated = { ...challenge, results: updatedResults };
        await game.settings.set("roll-for-shoes", "activeChallenge", updated);
        await rebuildChallengeCard(updated);
        break;
      }
    }
  });
});

/* -------------------------------------------- */
/*  Actor Creation Hook                         */
/* -------------------------------------------- */

Hooks.on("preCreateActor", (actor, data, options, userId) => {
  if (actor.type === "character") {
    actor.updateSource({ "prototypeToken.actorLink": true });
  }
});

/* -------------------------------------------- */
/*  Chat Message Hook                           */
/* -------------------------------------------- */

/**
 * Wire up all interactive RFS chat card buttons.
 *
 * Card types and their actions:
 *   playerWidget       → rfsWidgetRoll       (skill picker + roll button)
 *   advancementWidget  → rfsClaimFromWidget  (text input + claim button)
 *   xpSpendWidget      → rfsWidgetSpendXp    (spend XP to force advancement)
 *   standalone card    → rfsClaimAdvancement (old dialog-based flow)
 *   standalone card    → rfsSpendXp          (standalone XP spend)
 */
Hooks.on("renderChatMessageHTML", (message, html) => {

  // ── Challenge Card: open player popup ─────────────────────────────────────
  html.querySelectorAll("[data-action='rfsOpenChallengeDialog']").forEach(btn => {
    btn.addEventListener("click", () => {
      const { tokenId, actorId, challengeId } = btn.dataset;
      RfsChallengePlayerDialog.open(tokenId, actorId, challengeId);
    });
  });

  // ── Standalone: Claim Skill (opens dialog) ─────────────────────────────────
  html.querySelectorAll("[data-action='rfsClaimAdvancement']").forEach(btn => {
    btn.addEventListener("click", () => {
      const { actorId, skillId, messageId } = btn.dataset;
      RfsSkillRoll.claimAdvancement(actorId, skillId, messageId);
    });
  });

  // ── Standalone: Spend XP ──────────────────────────────────────────────────
  html.querySelectorAll("[data-action='rfsSpendXp']").forEach(btn => {
    btn.addEventListener("click", () => {
      RfsSkillRoll.spendXpOnCard(message.id);
    });
  });

});
