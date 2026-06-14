# Foundry VTT v14 — API Reference

Verified patterns from reading `foundry.mjs` (v14, build dated 2026-05-09).
Each entry is sourced from the Foundry client bundle — not assumed from docs or training data.
Deprecated-until versions are as stated in the source.

---

## ApplicationV2 — Window Header Controls

Override `_getHeaderControls()` to add buttons to the top-right window controls area (alongside the built-in detach and close buttons).

```javascript
_getHeaderControls() {
  const controls = super._getHeaderControls();
  controls.unshift({
    icon:    "fa-solid fa-pencil",     // FontAwesome class string
    label:   "MY.I18nKey",            // i18n key — auto-localized by Foundry
    action:  "myAction",              // must be registered in DEFAULT_OPTIONS.actions
    visible: this.isEditable,         // boolean OR function returning boolean
  });
  return controls;
}
```

**Type:** `ApplicationHeaderControlsEntry` extends `ContextMenuEntry` with an additional `action` string and optional `ownership` level.

**Rendered output:**
```html
<li class="header-control" data-action="myAction">
  <button type="button" class="control">
    <i class="control-icon fa-fw fa-solid fa-pencil"></i>
    <span class="control-label">Localized Label</span>
  </button>
</li>
```

Clicks route through the `data-action` attribute into `DEFAULT_OPTIONS.actions` — the same mechanism as any other button in the application.

**Notes:**
- `unshift()` places your button before Foundry's built-ins; `push()` places it after
- `visible` is re-evaluated on every render, so you can use instance state (e.g. `this._editMode`) if you call `this.render()` when that state changes
- `label` is always auto-localized — pass an i18n key string, not pre-translated text

---

## ApplicationV2 — `_onRender(context, options)`

Post-render lifecycle hook. Called after every render once the HTML is in the DOM.

```javascript
async _onRender(context, options) {
  await super._onRender(context, options); // always call super
  // this.element is available here
}
```

The base class implementation is a no-op, but the call chain matters — always call `super`. Fires on every `render()` including re-renders, not just the first.

---

## ApplicationV2 — Action Handler Signature

All `DEFAULT_OPTIONS.actions` handlers — whether triggered by template buttons or header controls — share the same signature:

```javascript
static async _onMyAction(event, target) {
  // `this`   = the application instance
  // `target` = the DOM element carrying data-action
  //            (for header controls this is the <li class="header-control">)
}
```

---

## ContextMenuEntry — Deprecated Fields (v14)

Three fields on `ContextMenuEntry` were renamed in v14. Backwards-compatible shims exist until v16.

| Old (deprecated v14) | New | Notes |
|----------------------|-----|-------|
| `condition` | `visible` | Boolean or `(target) => boolean`. For header controls, called with `this` = app instance |
| `callback` | `onClick` | `(event, target) => void` |
| `name` | `label` | String — auto-localized where Foundry calls `_loc()` |

Use the new names for all new code. The old names trigger `logCompatibilityWarning` on every render.

---

## DocumentSheetV2 — Built-in `editImage` Action

`DocumentSheetV2` (parent of `ActorSheetV2`) provides a built-in `editImage` action. Use it by putting `data-action` and `data-edit` directly on the `<img>` element — **not** on a wrapper button:

```html
<img src="{{actor.img}}"
     data-action="editImage"
     data-edit="img"
     title="Click to change portrait">
```

- `data-edit` is the dot-path into `document._source` (e.g. `"img"`, `"prototypeToken.texture.src"`)
- The handler opens a `FilePicker`, updates `target.src` immediately, then dispatches a `submit` event to trigger `submitOnChange`
- Do **not** wrap in a `<button>` — the action checks `target.nodeName !== "IMG"` and throws if the target isn't the image itself

Since `DEFAULT_OPTIONS.actions` deep-merges up the inheritance chain, `editImage` is available in any `ActorSheetV2` subclass without re-registering it.

---

## FilePicker — v14 Instantiation

```javascript
// ❌ v13 / broken in v14
new FilePicker({ type: "image", callback: path => { ... } }).render(true);

// ✅ v14 correct
const fp = new FilePicker.implementation({ type: "image", callback: path => { ... } });
await fp.browse();
```

Use `FilePicker.implementation` (not `FilePicker` directly) and call `.browse()` (not `.render(true)`).

---

## ApplicationV2 — `_preClose(options)` — Save Before Close

`_preClose` is awaited by the close process — the right place to flush unsaved form state:

```javascript
async _preClose(options) {
  await super._preClose(options);
  if (this.form) {
    this.form.dispatchEvent(new Event("submit", { cancelable: true }));
  }
}
```

This covers the case where a user closes the sheet while an input is focused but hasn't blurred (so `submitOnChange` hasn't fired yet). Dispatching `submit` on `this.form` triggers the same save path as a normal `change` event.

---

## ActorSheetV2 — `_getHeaderControls()` with Ownership

`DocumentSheetV2` (parent of `ActorSheetV2`) supports an `ownership` field on header controls to auto-gate visibility by document ownership level:

```javascript
{
  icon:      "fa-solid fa-eye",
  label:     "DOCUMENT.ViewMode",
  action:    "myAction",
  ownership: "OBSERVER",   // CONST.DOCUMENT_OWNERSHIP_LEVELS key or value
}
```

`visible` and `ownership` can be combined; both must pass for the control to show.

---

## CSS — Foundry Overrides Form Element Fonts

Foundry's global stylesheet sets `font-family` on `input`, `textarea`, and `select` at a specificity that beats a single-class rule. Any custom font set on a parent element won't automatically reach form fields — this is especially noticeable when switching between display elements (spans/divs) and form inputs at runtime.

Fix: scope a `font-family: inherit` rule inside your sheet's root class:

```css
.my-sheet {
  font-family: var(--my-font-body);

  & input,
  & textarea,
  & select {
    font-family: inherit;  /* beats Foundry's global rule via nesting specificity */
  }
}
```

More-specific per-element rules (e.g. monospace on a number field) still apply normally on top of this.
