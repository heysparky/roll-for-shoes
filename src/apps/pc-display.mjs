/**
 * src/apps/pc-display.mjs
 * =======================
 * Persistent PC portrait display — always visible at the top of the viewport,
 * immediately to the right of the DC tracker card.
 *
 * Portraits are driven by the actor folder named in the "pcFolder" world
 * setting (default "PCs"). Re-renders when actors are created, moved between
 * folders, or deleted — via hooks registered in roll-for-shoes.mjs.
 *
 * Single click: pan canvas to the character's token and select it.
 * Double click (owner / GM): open the character sheet.
 */

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class RfsPcDisplay extends HandlebarsApplicationMixin(ApplicationV2) {

  #clickTimer = null;

  /* -------------------------------------------- */
  /*  Static Configuration                        */
  /* -------------------------------------------- */

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "rfs-pc-display",
    classes: ["roll-for-shoes", "rfs-app", "rfs-pc-display"],
    window: { frame: false },
  };

  /** @override */
  static PARTS = {
    display: {
      template: "systems/roll-for-shoes/templates/apps/pc-display.hbs",
    },
  };

  /* -------------------------------------------- */
  /*  Context Preparation                         */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const folderName = game.settings.get("roll-for-shoes", "pcFolder") ?? "PCs";
    const folder     = game.folders.find(f => f.type === "Actor" && f.name === folderName);
    const seen       = new Set();
    const portraits  = (folder?.contents ?? [])
      .filter(a => !seen.has(a.id) && seen.add(a.id))
      .map(a => ({
        name:    a.name,
        img:     a.img,
        initial: a.name?.[0]?.toUpperCase() ?? "?",
        actorId: a.id,
      }));

    return { ...await super._prepareContext(options), portraits };
  }

  /* -------------------------------------------- */
  /*  Lifecycle                                   */
  /* -------------------------------------------- */

  /** @override */
  setPosition(pos = {}) {
    return this.position;
  }

  /** @override */
  _onRender(context, options) {
    // Position flush at nav bottom, immediately right of the DC tracker card
    const nav       = document.querySelector("#navigation");
    const trackerEl = document.getElementById("rfs-dc-tracker");
    const navBottom = nav ? nav.getBoundingClientRect().bottom : 0;
    this.element.style.top = `${navBottom}px`;
    if (trackerEl) {
      this.element.style.left = `${trackerEl.getBoundingClientRect().right + 16}px`;
    }

    // Click: pan to token + select; double-click: open sheet
    this.element.querySelectorAll(".rfs-portrait-peg[data-actor-id]").forEach(el => {
      el.addEventListener("click", (event) => {
        clearTimeout(this.#clickTimer);
        this.#clickTimer = setTimeout(() => RfsPcDisplay._onPortraitClick(event), 250);
      });
      el.addEventListener("dblclick", (event) => {
        clearTimeout(this.#clickTimer);
        RfsPcDisplay._onPortraitDblClick(event);
      });
    });
  }

  /* -------------------------------------------- */
  /*  Portrait Interactions                       */
  /* -------------------------------------------- */

  static async _onPortraitClick(event) {
    const actorId = event.currentTarget.dataset.actorId;
    const token = canvas.tokens?.placeables?.find(t => t.actor?.id === actorId);
    if (!token) return;
    await canvas.animatePan({ x: token.center.x, y: token.center.y });
    token.control({ releaseOthers: true });
  }

  static async _onPortraitDblClick(event) {
    const actorId = event.currentTarget.dataset.actorId;
    const actor = game.actors.get(actorId);
    if (!actor) return;
    if (actor.isOwner) actor.sheet?.render(true);
  }
}
