/**
 * roll-for-shoes.mjs
 * ==================
 * Entry point for the Roll for Shoes game system.
 */

import { CharacterData, NpcData } from "./src/data/actor-data.mjs";
import { RfsActor } from "./src/documents/actor.mjs";
import { RfsCharacterSheet } from "./src/sheets/character-sheet.mjs";
import { RfsNpcSheet } from "./src/sheets/npc-sheet.mjs";
import { RfsDcTracker } from "./src/apps/dc-tracker.mjs";
import { preloadHandlebarsTemplates, registerHandlebarsHelpers } from "./src/helpers/templates.mjs";
import { registerSystemSettings, buildAdvancementCardContent } from "./src/helpers/settings.mjs";
import { RFS } from "./src/helpers/config.mjs";
import { RfsSkillRoll } from "./src/rolls/skill-roll.mjs";
import { RollSplash } from "./src/ui/roll-splash.mjs";

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

  CONFIG.Actor.dataModels.character = CharacterData;
  CONFIG.Actor.dataModels.npc = NpcData;
  CONFIG.Actor.documentClass = RfsActor;

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

Hooks.once("ready", async function () {
  console.log("RFS | Roll for Shoes is ready.");

  // Render the persistent DC tracker bar for all users
  game.rfs.dcTracker = new RfsDcTracker();
  await game.rfs.dcTracker.render({ force: true });

  // Update portraits when users connect or disconnect
  Hooks.on("userConnected", () => game.rfs?.dcTracker?.render());

  game.socket.on("system.roll-for-shoes", async (data) => {
    switch (data.type) {

      // ── Splash broadcast (splashAudience "all" or "roller_gm") ──────────
      case "splashShow":
        if (!data.gmOnly || game.user.isGM) RollSplash.show(data.kind);
        break;

      // ── GM receives: name a new skill for a player (GM-namer path) ──────
      case "advancementNeeded": {
        if (!game.user.isGM) break;
        const advSkill     = { name: data.skillName, level: data.skillLevel };
        const newSkillName = await RfsSkillRoll._promptGmSkillName(data.actorName, advSkill, data.xpSpent ?? false);
        if (!newSkillName) break;

        const advActor = game.actors.get(data.actorId);
        if (!advActor) break;
        await advActor.addSkill(newSkillName, data.skillId);

        if (data.messageId) {
          const msg = game.messages.get(data.messageId);
          if (msg) {
            const flags    = msg.getFlag("roll-for-shoes", "rollData");
            const newFlags = { ...flags, skillClaimed: true, claimedSkillName: newSkillName, xpPending: false };
            const skillObj = { id: flags.skillId, name: flags.skillName, level: flags.skillLevel };
            await msg.update({
              content: RfsSkillRoll._buildStandaloneContent(
                flags.actorName, skillObj, flags.xpSpent ? flags.dice.map(() => 6) : flags.dice,
                flags.rawTotal, flags.modifier, flags.total,
                flags.allSixes || !!flags.xpSpent, flags.failed, flags.difficulty,
                newFlags, data.messageId, 0,
              ),
              flags: { "roll-for-shoes": { rollData: newFlags } },
            });
          }
        }
        await ChatMessage.create({
          content: buildAdvancementCardContent(
            data.actorName, newSkillName,
            data.skillName, data.skillLevel + 1,
            data.xpSpent ?? false, data.xpCost ?? 0,
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
 * advancement card → rfsClaimAdvancement (all-sixes: claim new skill)
 * standalone card  → rfsSpendXp          (failure: spend XP to advance)
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
