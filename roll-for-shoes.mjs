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

  // ── Player Roll Widget ─────────────────────────────────────────────────────
  const rollWidget = html.querySelector(".rfs-widget");
  if (rollWidget) {
    const select  = rollWidget.querySelector(".rfs-widget__skill-select");
    const rollBtn = rollWidget.querySelector("[data-action='rfsWidgetRoll']");

    if (select && rollBtn) {
      const flags = message.flags?.["roll-for-shoes"];

      if (flags?.rolled) {
        select.disabled  = true;
        rollBtn.disabled = true;
        rollBtn.textContent = game.i18n.localize("RFS.Widget.AlreadyRolled");
        return;
      }

      select.addEventListener("change", () => {
        rollBtn.disabled = !select.value;
      });

      rollBtn.addEventListener("click", () => {
        const skillId = select.value;
        if (!skillId) return;
        rollBtn.disabled = true;
        select.disabled  = true;
        RfsSkillRoll.rollFromWidget(message.id, skillId);
      });
    }
  }

  // ── Advancement Widget ─────────────────────────────────────────────────────
  // Player types a skill name and clicks Claim. Button enables only when
  // the input has content. On click: finaliseAdvancement deletes this card
  // and updates the challenge card row with the new skill name.
  const advWidget = html.querySelector(".rfs-advancement-widget");
  if (advWidget) {
    const nameInput = advWidget.querySelector(".rfs-advancement-widget__name-input");
    const claimBtn  = advWidget.querySelector("[data-action='rfsClaimFromWidget']");

    if (nameInput && claimBtn) {
      const flags = message.flags?.["roll-for-shoes"];

      if (flags?.claimed) {
        nameInput.disabled = true;
        claimBtn.disabled  = true;
        return;
      }

      // Enable claim button only when the player has typed something
      nameInput.addEventListener("input", () => {
        claimBtn.disabled = !nameInput.value.trim();
      });

      // Also allow pressing Enter in the input field
      nameInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && nameInput.value.trim()) {
          claimBtn.disabled = true;
          nameInput.disabled = true;
          RfsSkillRoll.finaliseAdvancement(message.id, nameInput.value.trim());
        }
      });

      claimBtn.addEventListener("click", () => {
        const name = nameInput.value.trim();
        if (!name) return;
        claimBtn.disabled  = true;
        nameInput.disabled = true;
        RfsSkillRoll.finaliseAdvancement(message.id, name);
      });
    }
  }

  // ── XP Spend Widget ───────────────────────────────────────────────────────
  // Player clicks to spend XP and convert all dice to 6, triggering
  // advancement. After spending, an advancement widget appears and this
  // card deletes itself.
  const xpWidget = html.querySelector(".rfs-xpspend-widget");
  if (xpWidget) {
    const spendBtn = xpWidget.querySelector("[data-action='rfsWidgetSpendXp']");
    if (spendBtn) {
      const flags = message.flags?.["roll-for-shoes"];

      if (flags?.spent) {
        spendBtn.disabled = true;
        return;
      }

      spendBtn.addEventListener("click", () => {
        spendBtn.disabled = true;
        RfsSkillRoll.spendXpFromWidget(message.id);
      });
    }
  }

});
