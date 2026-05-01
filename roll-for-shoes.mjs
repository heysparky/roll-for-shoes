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
 *  - styles/ uses CSS custom properties for theming (one base file, N theme files).
 */

import { CharacterData, NpcData } from "./src/data/actor-data.mjs";
import { RfsActor } from "./src/documents/actor.mjs";
import { RfsCharacterSheet } from "./src/sheets/character-sheet.mjs";
import { RfsNpcSheet } from "./src/sheets/npc-sheet.mjs";
import { preloadHandlebarsTemplates, registerHandlebarsHelpers } from "./src/helpers/templates.mjs";
import { registerSystemSettings } from "./src/helpers/settings.mjs";
import { RFS } from "./src/helpers/config.mjs";

/* -------------------------------------------- */
/*  Init Hook                                   */
/* -------------------------------------------- */

Hooks.once("init", function () {
  console.log("RFS | Initialising Roll for Shoes");

  // Expose a convenient namespace on the global game object.
  // Useful for macros and modules: game.rfs.RfsActor, game.rfs.config, etc.
  game.rfs = {
    RfsActor,
    config: RFS,
  };

  // Register system-wide game settings (theme picker, optional NPC rules, etc.)
  registerSystemSettings();

  // ── Data Models ────────────────────────────────────────────────────────────
  // TypeDataModel replaces template.json schema in v14. The type names here
  // must match what's declared in template.json.
  CONFIG.Actor.dataModels.character = CharacterData;
  CONFIG.Actor.dataModels.npc = NpcData;

  // ── Document Classes ───────────────────────────────────────────────────────
  CONFIG.Actor.documentClass = RfsActor;

  // ── Sheet Registration ─────────────────────────────────────────────────────
  // Unregister the default ActorSheet so ours is the only option.
  Actors.unregisterSheet("core", ActorSheet);

  Actors.registerSheet("roll-for-shoes", RfsCharacterSheet, {
    types: ["character"],
    makeDefault: true,
    label: "RFS.SheetLabel.Character",
  });

  Actors.registerSheet("roll-for-shoes", RfsNpcSheet, {
    types: ["npc"],
    makeDefault: true,
    label: "RFS.SheetLabel.Npc",
  });

  // ── Handlebars Helpers & Templates ────────────────────────────────────────
  // Helpers must be registered before templates are preloaded and rendered.
  registerHandlebarsHelpers();
  return preloadHandlebarsTemplates();
});

/* -------------------------------------------- */
/*  Ready Hook                                  */
/* -------------------------------------------- */

Hooks.once("ready", function () {
  // Anything that needs the world to be fully loaded goes here.
  // For now: just a console confirmation.
  console.log("RFS | Roll for Shoes is ready.");
});
