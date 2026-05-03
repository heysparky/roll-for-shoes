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
 * Wire up interactive buttons in RFS chat cards.
 *
 * Three card types:
 *   rfsClaimAdvancement — standalone result cards and challenge card rows
 *   rfsSpendXp          — standalone result cards only
 *   rfsWidgetRoll       — player widget cards (the skill picker + roll button)
 */
Hooks.on("renderChatMessageHTML", (message, html) => {

  // ── Claim Skill (advancement) ──────────────────────────────────────────────
  html.querySelectorAll("[data-action='rfsClaimAdvancement']").forEach(btn => {
    btn.addEventListener("click", () => {
      const { actorId, skillId, messageId } = btn.dataset;
      RfsSkillRoll.claimAdvancement(actorId, skillId, messageId);
    });
  });

  // ── Spend XP ──────────────────────────────────────────────────────────────
  html.querySelectorAll("[data-action='rfsSpendXp']").forEach(btn => {
    btn.addEventListener("click", () => {
      const { messageId } = btn.dataset;
      RfsSkillRoll.spendXpOnCard(messageId);
    });
  });

  // ── Player Widget Roll Button ──────────────────────────────────────────────
  // Enable/disable the roll button based on whether a skill is selected.
  // Fire the roll when the button is clicked.
  const widget = html.querySelector(".rfs-widget");
  if (widget) {
    const select = widget.querySelector(".rfs-widget__skill-select");
    const rollBtn = widget.querySelector("[data-action='rfsWidgetRoll']");

    if (select && rollBtn) {
      const flags = message.getFlag("roll-for-shoes", null);

      // If already rolled, disable everything permanently
      if (flags?.rolled) {
        select.disabled = true;
        rollBtn.disabled = true;
        rollBtn.textContent = game.i18n.localize("RFS.Widget.AlreadyRolled");
        return;
      }

      // Enable button only when a skill is chosen
      select.addEventListener("change", () => {
        rollBtn.disabled = !select.value;
      });

      rollBtn.addEventListener("click", () => {
        const skillId = select.value;
        if (!skillId) return;
        // Disable immediately for UX — server update will confirm
        rollBtn.disabled = true;
        select.disabled = true;
        RfsSkillRoll.rollFromWidget(message.id, skillId);
      });
    }
  }

});
