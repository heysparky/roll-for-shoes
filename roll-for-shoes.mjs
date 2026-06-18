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
import { RfsPcDisplay } from "./src/apps/pc-display.mjs";
import { preloadHandlebarsTemplates, registerHandlebarsHelpers } from "./src/helpers/templates.mjs";
import { registerSystemSettings } from "./src/helpers/settings.mjs";
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

  // Ensure the PC folder exists (GM only — world-level write)
  if (game.user.isGM) {
    const folderName = game.settings.get("roll-for-shoes", "pcFolder") ?? "PCs";
    const exists = game.folders.some(f => f.type === "Actor" && f.name === folderName);
    if (!exists) await Folder.create({ name: folderName, type: "Actor" });
  }

  // Render the persistent DC tracker and PC display for all users.
  // DC tracker must render first so PC display can measure its position.
  game.rfs.dcTracker = new RfsDcTracker();
  await game.rfs.dcTracker.render({ force: true });

  game.rfs.pcDisplay = new RfsPcDisplay();
  await game.rfs.pcDisplay.render({ force: true });

  // Re-render PC display when actors are created, folder-moved, or deleted.
  // createActor: GM-only, and only when the new actor lands in the PC folder.
  Hooks.on("createActor", (actor) => {
    if (!game.user.isGM) return;
    const folderName = game.settings.get("roll-for-shoes", "pcFolder") ?? "PCs";
    const folder = game.folders.find(f => f.type === "Actor" && f.name === folderName);
    if (folder && actor.folder?.id === folder.id) game.rfs?.pcDisplay?.render();
  });
  Hooks.on("updateActor", (actor, changes) => {
    if ("folder" in changes) game.rfs?.pcDisplay?.render();
  });
  Hooks.on("deleteActor", async (actor) => {
    game.rfs?.pcDisplay?.render();

    // Token cleanup — only GM runs this to avoid duplicate deletes
    if (!game.user.isGM) return;
    const folderName = game.settings.get("roll-for-shoes", "pcFolder") ?? "PCs";
    const folder = game.folders.find(f => f.type === "Actor" && f.name === folderName);
    if (!folder) return;

    // actor._source.folder holds the raw folder ID even after the document is deleted
    const actorFolderId = actor._source?.folder ?? actor.folder?.id;
    if (actorFolderId !== folder.id) return;

    for (const scene of game.scenes) {
      const toDelete = scene.tokens.filter(t => t.actorId === actor.id).map(t => t.id);
      if (toDelete.length) await scene.deleteEmbeddedDocuments("Token", toDelete);
    }
  });

  game.socket.on("system.roll-for-shoes", async (data) => {
    switch (data.type) {

      // ── Splash broadcast (splashAudience "all" or "roller_gm") ──────────
      case "splashShow":
        if (!data.gmOnly || game.user.isGM) RollSplash.show(data.kind);
        break;

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
 * opposed roll card → rfsClaimAdvancement (all-sixes: claim new skill)
 */
Hooks.on("renderChatMessageHTML", (message, html) => {

  // ── Challenge Card: portrait → open character sheet ──────────────────────
  html.querySelectorAll("[data-action='rfsOpenSheet']").forEach(btn => {
    btn.addEventListener("click", () => {
      const actor = game.actors.get(btn.dataset.actorId);
      actor?.sheet?.render(true);
    });
  });

  // ── Opposed roll: Claim Skill (all-sixes advancement) ─────────────────────
  html.querySelectorAll("[data-action='rfsClaimAdvancement']").forEach(btn => {
    btn.addEventListener("click", () => {
      const { actorId, skillId } = btn.dataset;
      RfsSkillRoll.claimAdvancement(actorId, skillId);
    });
  });

});
