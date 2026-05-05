# Vellum theme — registration

Drop-in steps to wire `styles/themes/vellum.css` into your RfS Foundry system.
Adjust to match your actual file paths if they differ.

---

## 1. `system.json` — load the stylesheet

Add `"styles/themes/vellum.css"` to the `styles` array. Foundry loads every
file listed there on world startup.

```json
{
  "id": "roll-for-shoes",
  "title": "Roll for Shoes",
  "styles": [
    "styles/rfs.css",
    "styles/themes/pneumatic.css",
    "styles/themes/cathode.css",
    "styles/themes/vellum.css"
  ]
}
```

---

## 2. `config.mjs` — register the theme

Add a `vellum` entry to whatever theme registry you already use. Typical shape:

```js
// module/config.mjs
export const RFS = {};

RFS.themes = {
  pneumatic: {
    id: "pneumatic",
    label: "RFS.Theme.Pneumatic",
    cssFile: "styles/themes/pneumatic.css"
  },
  cathode: {
    id: "cathode",
    label: "RFS.Theme.Cathode",
    cssFile: "styles/themes/cathode.css"
  },
  vellum: {
    id: "vellum",
    label: "RFS.Theme.Vellum",
    cssFile: "styles/themes/vellum.css"
  }
};
```

Make sure your settings registration uses these keys for the dropdown choices,
e.g.:

```js
// module/settings.mjs
import { RFS } from "./config.mjs";

Hooks.once("init", () => {
  game.settings.register("roll-for-shoes", "theme", {
    name: "RFS.Settings.Theme.Name",
    hint: "RFS.Settings.Theme.Hint",
    scope: "client",          // per-user
    config: true,
    type: String,
    default: "pneumatic",
    choices: Object.fromEntries(
      Object.entries(RFS.themes).map(([k, v]) => [k, v.label])
    ),
    onChange: applyTheme
  });
});

function applyTheme(themeId) {
  document.body.dataset.rfsTheme = themeId;
}

Hooks.once("ready", () => {
  applyTheme(game.settings.get("roll-for-shoes", "theme"));
});
```

The CSS file is scoped to `[data-rfs-theme="vellum"]`, so as long as
`document.body` (or whatever ancestor wraps your sheets/popups/chat cards)
has that data attribute set, every styled element underneath inherits the look.

---

## 3. `lang/en.json` — label

Add the localization key referenced above:

```json
{
  "RFS.Theme.Pneumatic": "Pneumatic",
  "RFS.Theme.Cathode": "Cathode",
  "RFS.Theme.Vellum": "Vellum",
  "RFS.Settings.Theme.Name": "Theme",
  "RFS.Settings.Theme.Hint": "Visual theme applied to character sheets, the roll dialog, and chat cards."
}
```

---

## 4. (Optional) Add a description / preview

If your settings dialog supports per-theme descriptions, hint copy for Vellum:

> *Illuminated codex — oxblood and gold leaf, italic display type, dark
> academia. Best in a dimly-lit window.*

---

## 5. Sanity-check checklist

After dropping in the file:

- [ ] `system.json` lists `vellum.css`
- [ ] Reload the world; in console: `getComputedStyle(document.body).getPropertyValue('--rfs-gold')` returns `#c8995a` after switching to Vellum
- [ ] Character sheet shows the framed portrait + bracket tree
- [ ] Roll popup shows the gold "vs" between total and DC
- [ ] All-sixes triggers the gold halo advancement panel
- [ ] Chat challenge card has the gold underline on its header

---

## Markup contract reminder

The CSS assumes these BEM stems. If your existing markup uses different ones,
search-replace within `vellum.css`:

| Surface | Stems used |
|---|---|
| App/window shell | `.rfs-app`, `.rfs-window` |
| Section header | `.rfs-section`, `.rfs-section__mark`, `.rfs-section__title`, `.rfs-section__rule`, `.rfs-section__action` |
| Sheet | `.rfs-sheet__top`, `.rfs-sheet__portrait`, `.rfs-sheet__name`, `.rfs-sheet__subname`, `.rfs-sheet__blurb`, `.rfs-sheet__meta`, `.rfs-sheet__xp`, `.rfs-sheet__background` |
| Skill tree | `.rfs-skill-tree`, `.rfs-skill-tree__canvas`, `.rfs-skill-node`, `.rfs-skill-node--branch`, `.rfs-skill-node__card`, `.rfs-skill-node__card--root`, `.rfs-skill-node__row`, `.rfs-skill-node__name`, `.rfs-skill-node__pips`, `.rfs-skill-pip`, `.rfs-skill-node__hint`, `.rfs-skill-node__children` |
| Expanded map | `.rfs-skill-map`, `.rfs-skill-map__title`, `.rfs-skill-map__close`, `.rfs-skill-map__inner` |
| Statuses | `.rfs-statuses`, `.rfs-statuses__grid`, `.rfs-statuses__col-label`, `.rfs-status`, `.rfs-status--pos/--neg`, `.rfs-status__mod`, `.rfs-status__name` |
| Popup | `.rfs-popup__title`, `.rfs-popup__title-text`, `.rfs-popup__close`, `.rfs-popup__plate`, `.rfs-popup__plate-prompt`, `.rfs-popup__plate-dc`, `.rfs-popup__plate-dc-num` |
| Skill picker | `.rfs-skill-list`, `.rfs-skill-list__label`, `.rfs-skill-list__row` (+ `.is-selected`), `.rfs-skill-list__row-name`, `.rfs-skill-list__row-pips`, `.rfs-skill-list__row-pip`, `.rfs-skill-list__row-dice` |
| Roll result | `.rfs-result`, `.rfs-result__dice`, `.rfs-die` (+ `--six`), `.rfs-result__compare`, `.rfs-result__total` (+ `--success`/`--failure`), `.rfs-result__vs`, `.rfs-result__dc`, `.rfs-result__verdict` (+ `--success`/`--failure`), `.rfs-result__xp-badge`, `.rfs-result__xp-badge-num`, `.rfs-result__xp-badge-label` |
| XP option / advancement | `.rfs-xp-option`, `.rfs-xp-option__hint`, `.rfs-advance`, `.rfs-advance__heading`, `.rfs-advance__sub`, `.rfs-advance__input` |
| Buttons | `.rfs-btn`, `.rfs-btn--primary`, `.rfs-btn--gold`, `.rfs-btn--ghost`, `.rfs-btn--block` |
| Challenge card | `.rfs-challenge`, `.rfs-challenge__head`, `.rfs-challenge__head-mark/-title/-dc`, `.rfs-challenge__prompt`, `.rfs-challenge__row` (+ `--success`/`--failure`/`--pending`/`--rolling`/`--advance`), `.rfs-challenge__portrait`, `.rfs-challenge__info`, `.rfs-challenge__name`, `.rfs-challenge__skill` (+ `--waiting`), `.rfs-challenge__rolling-dot`, `.rfs-challenge__xp-badge`, `.rfs-challenge__result`, `.rfs-challenge__total` (+ `--success`/`--failure`/`--waiting`), `.rfs-challenge__total-old`, `.rfs-challenge__dice`, `.rfs-challenge__advance-row`, `.rfs-challenge__foot`, `.rfs-challenge__foot-left`, `.rfs-challenge__dot`, `.rfs-challenge__foot-text`, `.rfs-challenge__foot-summary` |
