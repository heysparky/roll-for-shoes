/**
 * src/hud/token-hud.mjs
 * ===========================
 * Replaces Foundry's default TokenHUD with an RFS-specific version.
 *
 * Key change: the combat toggle button (meaningless in RFS — we have no
 * initiative queue) is replaced with a "Call for Roll" button. The GM
 * clicks it on a selected token to open the challenge dialog, which posts
 * a Challenge Card to chat.
 *
 * Registered in roll-for-shoes.mjs via:
 *   CONFIG.Token.hudClass = RfsTokenHUD;
 *
 * The combat action is completely replaced — RfsTokenHUD never touches
 * Foundry's Combat document. If a future milestone needs initiative-style
 * ordering, revisit this file first.
 */

const { TokenHUD } = foundry.applications.hud;

export class RfsTokenHUD extends TokenHUD {

  /* -------------------------------------------- */
  /*  Static Configuration                        */
  /* -------------------------------------------- */

  /** @override */
  static DEFAULT_OPTIONS = foundry.utils.mergeObject(
    super.DEFAULT_OPTIONS,
    {
      actions: {
        // Replace the built-in combat toggle with our Call for Roll action.
        // The key must match the data-action value in the HUD template.
        combat: RfsTokenHUD._onCallForRoll,
      },
    },
    { inplace: false }
  );

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  /**
   * After the HUD renders, swap the combat toggle button's icon and tooltip
   * for our shoe icon and label.
   *
   * We target the button by its data-action="combat" attribute — that's the
   * stable selector regardless of Foundry's internal template changes.
   *
   * @override
   */
  async _onRender(context, options) {
    await super._onRender(context, options);

    const btn = this.element.querySelector("[data-action='combat']");
    if (!btn) return;

    // Swap icon: replace whatever img/i is inside with our SVG
    btn.innerHTML = `<img
      src="systems/roll-for-shoes/assets/icons/rfs-call-for-roll.svg"
      alt="Call for Roll"
      style="width:36px; height:36px; object-fit:contain;">`;

    // Swap tooltip
    btn.dataset.tooltip = game.i18n.localize("RFS.HUD.CallForRoll");
    btn.setAttribute("aria-label", game.i18n.localize("RFS.HUD.CallForRoll"));

    // Only GMs see the button — players have no reason to call for a roll
    if (!game.user.isGM) btn.style.display = "none";
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  /**
   * Called when the GM clicks the Call for Roll (shoe) button on a token.
   *
   * Collects the token this HUD is bound to, then opens the RfsChallengeDialog.
   * The dialog handles DC setting, token selection, and posting the Challenge
   * Card to chat.
   *
   * FUTURE: PERSISTENT CARD UPGRADE
   * The challenge flow currently posts a new child card per player result.
   * The result data structure is intentionally self-contained (keyed by actorId)
   * so this can later be replaced with a ChatMessage#update() on the parent
   * challenge card without restructuring the data. See challengeId in
   * skill-roll.mjs options — that's the seam. Revisit after milestone 10.
   *
   * @param {PointerEvent}    event
   * @param {HTMLButtonElement} target
   */
  static async _onCallForRoll(event, target) {
    // `this` is the RfsTokenHUD instance (AppV2 action binding)
    const token = this.object;
    if (!token) return;

    // Collect all currently selected tokens on the canvas, falling back to
    // just the token this HUD is attached to if nothing else is selected.
    const selectedTokens = canvas.tokens.controlled.length
      ? canvas.tokens.controlled
      : [token];

    // Open the challenge dialog with the selected tokens.
    // Dynamic import keeps the HUD lean — challenge-dialog.mjs only loads
    // when the GM actually clicks the button.
    const { RfsChallengeDialog } = await import("../dialogs/challenge-dialog.mjs");
    return RfsChallengeDialog.open(selectedTokens);
  }
}
