/* =============================================================================
   src/ui/roll-verdict-dialog.mjs
   ==============================
   Roll-result "Verdict" dialog — three outcomes in one window.

   RollVerdict: framework-light render engine (adapted from design handoff).
   RfsVerdictDialog: Foundry ApplicationV2 wrapper that hosts RollVerdict.

   Outcomes:
     "allsixes" → "All sixes." + claim-a-skill inline (natural, free)
     "fail"     → "Failed." + Take XP / Spend N XP to advance (in-place transition)
     "success"  → "Success." + Close (shown if the caller opts in)

   Data contract for RfsVerdictDialog.open(data):
     actorName  {string}   — shown in window title
     skillName  {string}   — shown in window title
     dice       {number[]} — rolled face values
     outcome    {string}   — "allsixes" | "fail" | "success"
     xpEarned   {number}   — XP awarded on failure (always 1 in RfS)
     onClaim    {(name: string, xpWasSpent: boolean) => Promise<void>}
     onTakeXp   {() => void}
     onClose    {() => void}
   ============================================================================= */

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

// ── Render engine ─────────────────────────────────────────────────────────────

function renderVerdict(mount, data) {
  let dice       = [...data.dice];
  let advanced   = data.outcome === "allsixes";
  let xpWasSpent = false;

  const dieHtml = (v) =>
    `<span class="rfs-pip-die d-${v}${v === 6 ? " is-six" : ""}">${"<i></i>".repeat(9)}</span>`;

  const evidence = () =>
    `<div class="rfs-verdict__evidence">${dice.map(dieHtml).join("")}</div>`;

  const claimView = (note) => `
    <h2 class="rfs-verdict__word rfs-verdict__word--six">All sixes.</h2>
    <span class="rfs-verdict__badge">&#x2726; New skill earned</span>
    <div class="rfs-verdict__acts">
      <input class="rfs-verdict__input" data-ref="skillName"
             placeholder="Name your new skill — e.g. Kick Down Doors" />
      <button class="rfs-btn rfs-btn--gold rfs-btn--block" data-ref="claim">Claim skill</button>
      <p class="rfs-verdict__hint">${note}</p>
    </div>`;

  const failView = () => {
    const cost = dice.length;
    return `
      <h2 class="rfs-verdict__word rfs-verdict__word--fail">Failed.</h2>
      <span class="rfs-verdict__badge">&#x2726; +${data.xpEarned} XP earned</span>
      <div class="rfs-verdict__acts">
        <button class="rfs-btn rfs-btn--ghost rfs-btn--block" data-ref="takeXp">Take the XP &amp; close</button>
        <button class="rfs-btn rfs-btn--gold rfs-btn--block" data-ref="spend">Spend ${cost} XP · Advance</button>
        <p class="rfs-verdict__hint">Spending turns ${cost === 1 ? "your die" : `all ${cost} dice`} to a 6 — an automatic new skill.</p>
      </div>`;
  };

  const successView = () => `
    <h2 class="rfs-verdict__word rfs-verdict__word--win">Success.</h2>
    <span class="rfs-verdict__badge rfs-verdict__badge--win">&#x2713; Check passed</span>
    <div class="rfs-verdict__acts">
      <button class="rfs-btn rfs-btn--gold rfs-btn--block" data-ref="close">Close</button>
    </div>`;

  function paint() {
    let body;
    if (advanced) {
      const cost = dice.length;
      const note = data.outcome === "allsixes"
        ? "A natural all-sixes grants a skill for free — no XP spent."
        : `Earned by spending ${cost} XP to turn ${cost === 1 ? "your die" : "all dice"} to 6.`;
      body = evidence() + claimView(note);
    } else if (data.outcome === "success") {
      body = evidence() + successView();
    } else {
      body = evidence() + failView();
    }

    mount.className = "rfs-verdict__body" + (advanced ? " is-advance" : "");
    mount.innerHTML = body;

    const ref = (n) => mount.querySelector(`[data-ref="${n}"]`);
    ref("spend")  && ref("spend").addEventListener("click", spend);
    ref("takeXp") && ref("takeXp").addEventListener("click", () => data.onTakeXp?.());
    ref("close")  && ref("close").addEventListener("click", () => data.onClose?.());
    ref("claim")  && ref("claim").addEventListener("click", () =>
      data.onClaim?.(ref("skillName")?.value.trim() || "", xpWasSpent));
  }

  function spend() {
    dice       = dice.map(() => 6);
    advanced   = true;
    xpWasSpent = true;
    paint();
    mount.querySelector('[data-ref="skillName"]')?.focus();
  }

  paint();
  return { destroy() { mount.innerHTML = ""; } };
}

// ── Foundry ApplicationV2 wrapper ─────────────────────────────────────────────

export class RfsVerdictDialog extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    classes: ["roll-for-shoes", "rfs-app", "rfs-verdict"],
    position: { width: 340, height: "auto" },
    window: { resizable: false, minimizable: false },
  };

  static PARTS = {
    dialog: {
      template: "systems/roll-for-shoes/templates/dialog/roll-verdict-dialog.hbs",
    },
  };

  constructor(data, options = {}) {
    super(options);
    this._verdictData = data;
    this._verdictInst = null;
  }

  static open(data) {
    return new RfsVerdictDialog(data, {
      window: { title: `${data.actorName} · ${data.skillName}` },
    }).render({ force: true });
  }

  /** @override — initialize the verdict engine into the mount div after first render. */
  async _onRender(context, options) {
    if (this._verdictInst) return;
    const mount = this.element.querySelector(".rfs-verdict__body");
    if (!mount) return;

    const dialog = this;
    const data = {
      ...this._verdictData,
      onClaim: async (name, xpWasSpent) => {
        await this._verdictData.onClaim?.(name, xpWasSpent);
        await dialog.close();
      },
      onTakeXp: async () => {
        await this._verdictData.onTakeXp?.();
        await dialog.close();
      },
      onClose: async () => {
        await this._verdictData.onClose?.();
        await dialog.close();
      },
    };

    this._verdictInst = renderVerdict(mount, data);
  }

  /** @override — clean up verdict DOM on close. */
  async _preClose(options) {
    this._verdictInst?.destroy();
    return super._preClose(options);
  }
}
