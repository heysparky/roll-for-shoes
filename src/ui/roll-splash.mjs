/* =============================================================================
   src/ui/roll-splash.mjs
   ======================
   Roll-result splash overlay controller.

   A single full-screen overlay node is lazily created on <body> the first time
   show() is called, then reused. Call from the roller's OWN client when a roll
   resolves — the copy is second-person ("You earned…"), so it is personal
   feedback, NOT a broadcast. Do not call it from rebuildChallengeCard() or any
   GM-side socket handler.

   Usage:
     import { RollSplash } from "./ui/roll-splash.mjs";
     RollSplash.show("success");   // gold, no tagline
     RollSplash.show("critical");  // all-sixes → "You earned a new skill"
     RollSplash.show("fail");      // dark → "You earned XP"

   Pairs with styles/rfs-splash.css (register that file in system.json "styles").
   ============================================================================= */

/** Localise with a hard fallback so it works before lang files load / in tests. */
function t(key, fallback) {
  try {
    const s = game?.i18n?.localize(key);
    return s && s !== key ? s : fallback;
  } catch {
    return fallback;
  }
}

/** Per-kind content. Tagline reward span is filled from i18n at show() time. */
function configFor(kind) {
  switch (kind) {
    case "critical":
      return {
        word:   t("RFS.Splash.SuccessWord", "Success"),
        kicker: t("RFS.Splash.CritKicker", "All Sixes"),
        tagPre: t("RFS.Splash.CritTagPre", "You earned"),
        reward: t("RFS.Splash.CritReward", "a new skill"),
      };
    case "fail":
      return {
        word:   t("RFS.Splash.FailWord", "Fail"),
        kicker: t("RFS.Splash.FailKicker", "No matches"),
        tagPre: t("RFS.Splash.FailTagPre", "You earned"),
        reward: t("RFS.Splash.FailReward", "XP"),
      };
    case "success":
    default:
      return { word: t("RFS.Splash.SuccessWord", "Success"), kicker: "", tagPre: "", reward: "" };
  }
}

export const RollSplash = {
  _el: null,
  _refs: null,
  _hideTimer: null,

  /** Build the overlay DOM once and cache element references. */
  _build() {
    if (this._el) return;

    const el = document.createElement("div");
    el.className = "rfs-splash";
    el.setAttribute("data-kind", "success");
    el.setAttribute("aria-live", "polite");
    el.innerHTML = `
      <div class="rfs-splash__veil"></div>
      <div class="rfs-splash__ring"></div>
      <div class="rfs-splash__stack">
        <div class="rfs-splash__kicker"></div>
        <h1 class="rfs-splash__word"></h1>
        <p class="rfs-splash__tag"></p>
      </div>`;

    // Click anywhere to dismiss early.
    el.addEventListener("click", () => this.hide());

    document.body.appendChild(el);
    this._el = el;
    this._refs = {
      kicker: el.querySelector(".rfs-splash__kicker"),
      word:   el.querySelector(".rfs-splash__word"),
      tag:    el.querySelector(".rfs-splash__tag"),
    };
  },

  /**
   * Show the splash.
   * @param {"success"|"critical"|"fail"} kind
   */
  show(kind = "success") {
    this._build();
    const cfg = configFor(kind);
    const { kicker, word, tag } = this._refs;

    clearTimeout(this._hideTimer);

    // Reset so the entrance animation replays on repeat outcomes.
    this._el.classList.remove("is-on");
    this._el.setAttribute("data-kind", kind);
    word.textContent = cfg.word;
    kicker.textContent = cfg.kicker;
    tag.textContent = "";
    if (cfg.reward) {
      tag.append(`${cfg.tagPre} `);
      const span = document.createElement("span");
      span.className = "rfs-splash__reward";
      span.textContent = cfg.reward;
      tag.append(span);
    }

    // Force reflow, then arm — synchronous so it survives backgrounded tabs.
    void this._el.offsetWidth;
    this._el.classList.add("is-on");

    const dwell = kind === "success" ? 1100 : 1600;
    this._hideTimer = setTimeout(() => this.hide(), dwell);
  },

  hide() {
    clearTimeout(this._hideTimer);
    this._el?.classList.remove("is-on");
  },
};
