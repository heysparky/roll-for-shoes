# Roll for Shoes — Architecture & Design Decisions

This document captures RFS-specific design decisions and working patterns.
Read before touching the roll flow, advancement dialogs, or button wiring.

---

## What Claude Should Know Before Starting

- This is a **game system**, not a module. It lives in `Data/systems/`, uses `system.json`.
- Source is in `src/` — not `module/`.
- All template paths use `systems/roll-for-shoes/...`
- Sheet registration uses `DocumentSheetConfig.registerSheet(Actor, ...)`.
- **No build step.** Files load directly from disk. Reload Foundry to pick up changes.

---

## Roll Flow

Players roll directly from their character sheet — no GM initiation required.

### DC Tracker

`RfsDcTracker` is rendered for all users at the `ready` hook. It sits at the top of the viewport (frameless `ApplicationV2`, `window.frame: false`), horizontally centered.

- GM sees named tier chips (Easy / Medium / Hard / Elite / Legendary / Mythic) + +/− step buttons
- Players see the DC value read-only
- DC is stored in `game.settings.get("roll-for-shoes", "globalDc")` (world-scoped, GM-only writes)
- `difficultyMode` setting determines the tier labels and defaults (`standard` vs `moreXp`)
- Re-renders on `globalDc` and `targetNamePicker` setting changes only

### PC Display

`RfsPcDisplay` (`src/apps/pc-display.mjs`) is rendered immediately after the DC tracker, so it can measure the tracker element's position and place itself 16 px to the right.

- Portrait source: all actors in the folder named by `pcFolder` world setting (default `"PCs"`); deduplicated by actorId
- If the folder doesn't exist on first GM load, it is created automatically
- Single click: `canvas.animatePan` to the actor's token → `token.control({ releaseOthers: true })`
- Double click (owner or GM): `actor.sheet.render(true)` — no pan
- Re-renders via `createActor` (GM-only, PC-folder-only), `updateActor` (folder changed), `deleteActor`
- Deleting a PC actor also deletes all its tokens from every scene (GM-only, guarded by folder membership check using `actor._source.folder`)

### Rolling

1. Player clicks a skill name on the character sheet
2. `_onRollSkill()` (`character-sheet.mjs`) calls `RfsSkillRoll.roll(actor, skill)`
3. `_resolveDifficulty()` reads `globalDc` (or uses `options.difficulty` if passed explicitly)
4. Dice evaluated; XP awarded on failure; `actor.addRollHistory()` records the result
5. `RfsRollResultDialog.open()` — fire-and-forget popup

### Advancement After a Roll

All advancement dialogs use themed `.rfs-adv-dlg` HTML inside `DialogV2`.

**XP spend (non-all-sixes roll):**
1. Player clicks "Spend N XP" in the popup → `_doStandaloneXpSpend(actor, skill, nonSixCount)`
2. `_confirmXpSpend()` dialog — "Spend N XP on a new skill?"
3. On yes: `actor.spendXp()` runs immediately
4. If `advancementNamer === "player"` or `game.user.isGM`: `_promptSkillName(skill, true)` opens locally → `actor.addSkill()` → posts advancement announcement
5. If `advancementNamer === "gm"` and player client: `advancementNeeded` socket → GM gets `_promptGmSkillName`; names skill; `actor.addSkill()`; posts announcement

**All sixes (natural advancement):**
- `advancementNamer === "player"`: `_promptSkillName(skill, false)` — "You earned a skill!" — opens locally
- `advancementNamer === "gm"` and player client: `advancementNeeded` socket → GM gets `_promptGmSkillName` — "{Actor} earned a skill!"
- `advancementNamer === "gm"` and GM is the rolling client: `_promptGmSkillName` opens inline

Either path calls `actor.addSkill()` then posts a `.rfs-advancement` announcement card to public chat.

---

## Roll Result Popup

`RfsRollResultDialog` (`src/dialogs/roll-result-dialog.mjs`) — fire-and-forget.

- `roll()` calls `_showRollResultPopup()` without awaiting it; roll returns before the popup closes
- Popup content: dice faces, outcome strip (success/failure/all-sixes + DC), optional Claim Skill or Spend XP buttons
- Popup actions (`claimSkill`, `spendXp`) live in `RfsRollResultDialog.DEFAULT_OPTIONS.actions` — not in `renderChatMessageHTML`
- DSN is called explicitly before opening the popup; `AudioHelper.play()` fallback when DSN is absent
- After each roll, `actor.addRollHistory(entry)` records to `"roll-for-shoes.rollHistory"` flag (max 50, newest first)

---

## Chat Card Types

| type | visibility | description |
|------|------------|-------------|
| `advancement` | public | Announcement posted when any skill is gained. Built by `buildAdvancementCardContent()`. Static — no interactive elements. |

There are no challenge cards and no standalone roll cards. All roll results surface via the `RfsRollResultDialog` popup. Chat only receives advancement announcement cards.

---

## Socket Pattern

World-scoped settings can only be written by GMs. Players delegate via socket.
GMs bypass the socket and call handlers directly (`game.user.isGM` guard before each emit).

| type | direction | handler |
|------|-----------|---------|
| `advancementNeeded` | player → GM | GM gets `_promptGmSkillName` dialog; names skill; `actor.addSkill()`; posts advancement announcement. If `messageId` is present, also updates the originating chat card. |

`"socket": true` must be in `system.json`. Requires a full world reload (not just browser refresh) to take effect after changing.

---

## Button Wiring

All chat button listeners live in the `renderChatMessageHTML` hook in `roll-for-shoes.mjs`. This hook fires on every render including after `message.update()` calls.

| data-action | surface | calls |
|-------------|---------|-------|
| `rfsOpenSheet` | portrait buttons (advancement card or any future card) | `actor.sheet.render(true)` |
| `rfsClaimAdvancement` | advancement card (all-sixes) | `RfsSkillRoll.claimAdvancement()` |
| `rfsSpendXp` | standalone result card (failure, has XP) | `RfsSkillRoll.spendXpOnCard()` |

Roll result popup actions (`claimSkill`, `spendXp`) are in `RfsRollResultDialog.DEFAULT_OPTIONS.actions`.

---

## DC Resolution

`RfsSkillRoll._resolveDifficulty(options)` resolves in this order:

1. `options.difficulty` set explicitly — use it
2. `game.settings.get("roll-for-shoes", "globalDc")` — use the global DC

There is no passive challenge detection. All rolls go through the same path.

---

## Character Sheet

`HandlebarsApplicationMixin(ActorSheetV2)` with `submitOnChange: true` for auto-save.

### Tabs

Custom tab switching via `switchTab` action (not Foundry's tab framework). Active tab tracked in `this._activeTab` (default `"skills"`) and restored in `_onRender` after every re-render.

- **Skills** (default) — compact flat skill list
- **Statuses**, **Inventory**, **Roll History**

### Edit Mode

Toggled by a pencil/check button in the window header controls (see `_getHeaderControls()` override and `Foundry-v14-API.md`). Stored as `this._editMode` (instance state). Passed to templates as `editMode` context variable (`isEditable && _editMode`).

A **Done Editing** footer bar appears at the bottom of the sheet in edit mode (`.rfs-sheet__edit-footer`), giving a visible exit point without digging into the window controls menu.

`_preClose` flushes any focused-but-unblurred input by dispatching a `submit` event on the form, so edits are never lost when the sheet is closed mid-type.

| | Play mode (default) | Edit mode |
|-|---------------------|-----------|
| Portrait | static `<img>` | `<img data-action="editImage" data-edit="img">` → built-in FilePicker (dims on hover) |
| Name | `<span>` | `<input name="name">` auto-saves |
| XP | `<span>` | `<input name="system.xp">` auto-saves |
| Biography | read-only `<div>` | `<textarea name="system.biography">` auto-saves |
| Skill names | roll buttons | inline `<input>` auto-saves; root is `readonly` |
| Delete skill | hidden | ✕ button per skill (except root) |

### Other Per-Field Notes

- **Portrait** uses the built-in `editImage` action from `DocumentSheetV2` — `data-action` must be on the `<img>` itself, not a wrapper element (see `Foundry-v14-API.md`)
- **`originalIndex`** — added by `_sortSkillsForDisplay()` so display-sorted order cannot cause form submissions to update the wrong skill in the stored array
- **`_processFormData`** — merges incoming skill name inputs with the rest of each skill's data (level, id, parentId) so partial form updates don't reset unsubmitted fields
- **Rename skill dialog** (`renameSkill` action) — still registered but has no UI entry point; edit mode inline inputs replaced it
- **Font inheritance** — `.rfs-sheet` scopes `input, textarea { font-family: inherit }` to prevent Foundry's global stylesheet from overriding the sheet font on form elements

*(The ⤢ skill map popup, `RfsSkillMapDialog`, was removed. Revert commit `41f27d8` to restore it.)*

---

## CSS / Theme System

Base styles: `styles/rfs-base.css` + `styles/rfs-chat.css`

Themes live in `styles/themes/<name>.css` and are scoped to `[data-rfs-theme="<id>"]`.
The theme is applied by setting `document.body.dataset.rfsTheme` on world load and
whenever the setting changes (no reload required).

Current themes: `dark-factory`, `clean-light`, `vellum` (default).

All CSS custom properties are defined on `:root` in `rfs-base.css` so they are available in chat cards and all other Foundry UI contexts, not just inside RFS application windows.

Theme files override those custom properties within their `[data-rfs-theme="..."]` scoped selector, then add any structural rules unique to that theme. Because themes are scoped, they only affect RFS sheets and dialogs — not Foundry's native chat message header, which uses its own styling.

**Chat cards**: rely on `:root`-defined custom properties. Theme-scoped overrides do NOT apply inside Foundry's chat sidebar. To control chat card appearance, edit `rfs-base.css` or `rfs-chat.css` directly.

Class naming convention: `rfs-` prefix throughout, BEM structure.

### Key custom property groups
- `--rfs-color-*` — semantic colours (overridden by themes)
- `--rfs-font-*` — typefaces and sizes
- `--rfs-space-*` — spacing scale
- `--rfs-radius-*`, `--rfs-shadow-*`, `--rfs-anim-*`
