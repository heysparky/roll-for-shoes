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
import { registerSystemSettings, getActiveChallenge, recordChallengeRoll, rebuildChallengeCard, buildAdvancementCardContent } from "./src/helpers/settings.mjs";
import { RFS } from "./src/helpers/config.mjs";
import { RfsSkillRoll } from "./src/rolls/skill-roll.mjs";

/* -------------------------------------------- */
/*  Init Hook                                   */
/* -------------------------------------------- */

Hooks.once("init", function () {
  console.log("RFS | Initialising Roll for Shoes");

  game.rfs = {
    RfsActor,
    RfsSkillRoll,
    config: RFS,
  };

  registerSystemSettings();

  game.keybindings.register("roll-for-shoes", "callForRoll", {
    name:       "RFS.Keybinding.CallForRoll",
    hint:       "RFS.Keybinding.CallForRollHint",
    editable:   [{ key: "KeyQ", modifiers: [] }],
    restricted: true,
    precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL,
    onDown:     async () => {
      if (!game.user.isGM) return false;
      const tokens = canvas.tokens?.controlled ?? [];
      if (!tokens.length) return false;
      const { RfsChallengeDialog } = await import("./src/dialogs/challenge-dialog.mjs");
      RfsChallengeDialog.open(tokens);
      return true;
    },
  });

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

      // ── GM receives: record a player's roll result in world settings ────
      case "recordChallengeRoll":
        if (!game.user.isGM) break;
        await recordChallengeRoll(data.tokenId, data.rollResult);
        break;

      // ── GM receives: mark a skill as claimed (player-namer path) ────────
      case "claimAdvancement": {
        if (!game.user.isGM) break;
        const challenge = getActiveChallenge();
        if (!challenge?.results?.[data.tokenId]) break;
        const claimResults = {
          ...challenge.results,
          [data.tokenId]: {
            ...challenge.results[data.tokenId],
            skillClaimed:       true,
            claimedSkillName:   data.newSkillName,
            advancementPending: false,
          },
        };
        const claimUpdated = { ...challenge, results: claimResults };
        await game.settings.set("roll-for-shoes", "activeChallenge", claimUpdated);
        await rebuildChallengeCard(claimUpdated);
        await ChatMessage.create({
          content: buildAdvancementCardContent(
            data.actorName ?? "", data.newSkillName,
            data.parentSkillName ?? "", data.newLevel ?? 2,
            false, 0
          ),
        });
        break;
      }

      // ── GM receives: name a new skill for a player (GM-namer path) ──────
      case "advancementNeeded": {
        if (!game.user.isGM) break;
        const { DialogV2 } = foundry.applications.api;
        const gmResult = await DialogV2.input({
          window: { title: `${data.actorName} — ${game.i18n.localize("RFS.Dialog.Advancement.Title")}` },
          content: `<p>${game.i18n.format("RFS.Dialog.Advancement.Hint", {
            skill: data.skillName, level: data.skillLevel + 1,
          })}</p><input type="text" name="skillName"
            placeholder="${game.i18n.localize("RFS.Dialog.NewSkill.Placeholder")}"
            autofocus style="width:100%;margin-top:0.5em">`,
          ok: { label: game.i18n.localize("RFS.Dialog.Advancement.Confirm") },
        });

        const newSkillName = gmResult?.skillName?.trim();
        if (!newSkillName) break;

        const advActor = game.actors.get(data.actorId);
        if (!advActor) break;
        await advActor.addSkill(newSkillName, data.skillId);

        const advChallenge = getActiveChallenge();
        if (advChallenge?.results?.[data.tokenId]) {
          const advResults = {
            ...advChallenge.results,
            [data.tokenId]: {
              ...advChallenge.results[data.tokenId],
              skillClaimed:       true,
              claimedSkillName:   newSkillName,
              advancementPending: false,
            },
          };
          const advUpdated = { ...advChallenge, results: advResults };
          await game.settings.set("roll-for-shoes", "activeChallenge", advUpdated);
          await rebuildChallengeCard(advUpdated);
        }

        await ChatMessage.create({
          content: buildAdvancementCardContent(
            data.actorName, newSkillName,
            data.skillName, data.skillLevel + 1,
            false, 0
          ),
        });
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

  // ── Challenge Card: portrait → open character sheet ──────────────────────
  html.querySelectorAll("[data-action='rfsOpenSheet']").forEach(btn => {
    btn.addEventListener("click", () => {
      const actor = game.actors.get(btn.dataset.actorId);
      actor?.sheet?.render(true);
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
