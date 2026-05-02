/**
 * roll-for-shoes.mjs
 * ==================
 * Entry point for the Roll for Shoes game system.
 *
 * Load order matters in Foundry — everything here runs on Hooks.once("init"),
 * which fires before the world is ready but after the core API is available.
 *
 * Architecture:
 *  - Data Models (TypeDataModel) define the schema; template.json only names types.
 *  - Sheets (HandlebarsApplicationMixin + ActorSheetV2) handle rendering and input.
 *  - RfsActor extends Actor for derived data and roll methods.
 *  - rolls/ contains pure roll logic, decoupled from the sheet.
 *  - hud/ contains the token HUD override (shoe button → Call for Roll).
 *  - styles/ uses CSS custom properties for theming (one base file, N theme files).
 */

import { CharacterData, NpcData } from "./src/data/actor-data.mjs";
import { RfsActor } from "./src/documents/actor.mjs";
import { RfsCharacterSheet } from "./src/sheets/character-sheet.mjs";
import { RfsNpcSheet } from "./src/sheets/npc-sheet.mjs";
import { RfsTokenHUD } from "./src/hud/token-hud.mjs";
import { preloadHandlebarsTemplates, registerHandlebarsHelpers } from "./src/helpers/templates.mjs";
import { registerSystemSettings } from "./src/helpers/settings.mjs";
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
});

/* -------------------------------------------- */
/*  Chat Message Hook                           */
/* -------------------------------------------- */

/**
 * Wire up interactive buttons in RFS chat cards.
 * All RFS chat buttons use data-action to identify themselves.
 * This hook fires every time a chat message is rendered — including
 * after ChatMessage#update() calls, so updated cards get fresh listeners.
 */
Hooks.on("renderChatMessageHTML", (message, html) => {

  // ── Claim Skill (advancement) ──────────────────────────────────────────────
  html.querySelectorAll("[data-action='rfsClaimAdvancement']").forEach(btn => {
    btn.addEventListener("click", () => {
      const { actorId, skillId } = btn.dataset;
      RfsSkillRoll.claimAdvancement(actorId, skillId);
    });
  });

  // ── Spend XP ──────────────────────────────────────────────────────────────
  // Button only appears on failed roll cards where xpSpent is false.
  // After clicking, the card updates in place via ChatMessage#update().
  html.querySelectorAll("[data-action='rfsSpendXp']").forEach(btn => {
    btn.addEventListener("click", () => {
      const { messageId } = btn.dataset;
      RfsSkillRoll.spendXpOnCard(messageId);
    });
  });

});
