/**
 * src/apps/dc-tracker.mjs
 * ========================
 * Persistent DC tracker bar — always visible at the top of the viewport.
 *
 * Shows the current global DC (read from the "globalDc" world setting).
 * The GM can step the DC with +/- buttons or jump to a named tier chip.
 * Players see the DC value and connected character portraits read-only.
 *
 * Rendered on the "ready" hook; re-renders automatically via the
 * globalDc setting's onChange callback and the "userConnected" hook.
 *
 * Note: window.frame = false removes Foundry's title/close chrome,
 * leaving a bare element positioned by CSS. Verify against Foundry v14
 * ApplicationV2 reference if this option behaves unexpectedly.
 */

import { RFS } from "../helpers/config.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class RfsDcTracker extends HandlebarsApplicationMixin(ApplicationV2) {

  /* -------------------------------------------- */
  /*  Static Configuration                        */
  /* -------------------------------------------- */

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "rfs-dc-tracker",
    classes: ["roll-for-shoes", "rfs-app", "rfs-dc-tracker"],
    window: { frame: false },
    actions: {
      stepDc: RfsDcTracker._onStepDc,
      setDc:  RfsDcTracker._onSetDc,
    },
  };

  /** @override */
  static PARTS = {
    tracker: {
      template: "systems/roll-for-shoes/templates/apps/dc-tracker.hbs",
    },
  };

  /* -------------------------------------------- */
  /*  Context Preparation                         */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const dc   = game.settings.get("roll-for-shoes", "globalDc") ?? 4;
    const mode = game.settings.get("roll-for-shoes", "difficultyMode") ?? "moreXp";
    const tiers = (RFS.dcTiers[mode] ?? RFS.dcTiers.moreXp).map(t => ({
      ...t,
      active: t.dc === dc,
    }));

    const players = game.users.filter(u => !u.isGM && u.active && u.character);
    const half    = Math.ceil(players.length / 2);
    const toPortrait = u => ({ name: u.character.name, img: u.character.img });

    return {
      ...await super._prepareContext(options),
      dc,
      tiers,
      isGM:  game.user.isGM,
      left:  players.slice(0, half).map(toPortrait),
      right: players.slice(half).map(toPortrait),
    };
  }

  /* -------------------------------------------- */
  /*  Actions (GM only)                           */
  /* -------------------------------------------- */

  static async _onStepDc(event, target) {
    if (!game.user.isGM) return;
    const dir = parseInt(target.dataset.dir, 10);
    const dc  = game.settings.get("roll-for-shoes", "globalDc") ?? 4;
    await game.settings.set("roll-for-shoes", "globalDc", Math.max(1, Math.min(30, dc + dir)));
  }

  static async _onSetDc(event, target) {
    if (!game.user.isGM) return;
    const val = parseInt(target.dataset.value, 10);
    if (!isNaN(val)) await game.settings.set("roll-for-shoes", "globalDc", val);
  }
}
