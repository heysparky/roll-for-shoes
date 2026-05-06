# Roll for Shoes — Architecture & Design Decisions

This document captures RFS-specific design decisions and working patterns.
Read before touching the challenge flow, card lifecycle, or button wiring.

---

## What Claude Should Know Before Starting

- This is a **game system**, not a module. It lives in `Data/systems/`, uses `system.json`.
- Source is in `src/` — not `module/`.
- All template paths use `systems/roll-for-shoes/...`
- Sheet registration uses `DocumentSheetConfig.registerSheet(Actor, ...)`.
- **No build step.** Files load directly from disk. Reload Foundry to pick up changes.

---

## Challenge Flow

The challenge flow is the core GM-to-player interaction loop. **Players roll from their character sheet** — there is no player-facing popup dialog.

### GM Side
1. Select tokens on canvas, click the shoe button on the token HUD (or press Q)
2. Challenge Dialog opens — set DC via stepper/canonicals/dice picker, review token list
3. Post → the **shared Challenge Card** appears in public chat; all non-GM clients auto-switch to the chat sidebar

### Player Side
4. Player sees the challenge card in chat; rolls any skill from their character sheet as normal
5. `_resolveDifficulty` detects the player's token is in `challenge.tokenIds` → routes through `_postChallengeResult`
6. Roll result is emitted via socket to the GM; GM writes it to settings and rebuilds the challenge card
7. The portrait button on the challenge card opens the character sheet (`rfsOpenSheet`)

### Advancement After a Roll
- **All sixes (natural)**: advancement dialog opens on the player's client; naming is controlled by `advancementNamer` setting:
  - `player` — player names the skill via `DialogV2.input`, then emits `claimAdvancement` socket
  - `gm` — player emits `advancementNeeded` socket; GM gets a `DialogV2.input` and names it
- **XP spend**: `DialogV2.confirm` + `DialogV2.input` shown to the player; on confirm, `actor.spendXp()` + `actor.addSkill()` then `recordChallengeRoll` emitted
- Either path posts a blingy `.rfs-advancement` announcement card to public chat

### After All Players Have Rolled
- Challenge Card marks itself complete
- Active challenge clears from settings after a 2-second delay (so final card update lands first)
- Challenge also times out after 3 minutes if not all tokens roll

---

## Card Lifecycle — Crystallise, Never Delete

**Never delete a chat message.** Deletion shifts everything below it in the queue, which is disruptive during active play.

Instead, when a card's action completes, **update its content in place** to a quiet static confirmation. The card stays, the queue stays stable.

The challenge card is the only challenge-related card in chat (besides the advancement announcement). There are no per-player whisper cards.

Standalone (non-challenge) skill rolls post their own self-contained card with inline XP spend and Claim Skill buttons. These crystallise in-place when acted on.

---

## Chat Card Types

| type | visibility | description |
|------|------------|-------------|
| `challenge` | public | Shared GM challenge card. Live-updating; one portrait row per called token. Rebuilt on every roll via `rebuildChallengeCard()`. Portrait buttons open the character sheet. |
| `advancement` | public | Blingy announcement posted when any skill is gained (natural all-sixes or XP spend). Built by `buildAdvancementCardContent()`. Static — no interactive elements. |
| standalone | public | Non-challenge skill rolls. Self-contained card with XP spend and Claim Skill buttons. Flags under `rollData`. Crystallises in-place when actioned. |

---

## Challenge State — Settings Are the Source of Truth

The Challenge Card's content is rebuilt from scratch on every roll update.
The source of truth is `game.settings.get("roll-for-shoes", "activeChallenge")`.

**Never read state back from card HTML. Never use regex on message content.**

Key functions in `src/helpers/settings.mjs`:
- `buildChallengeCardContent(challenge)` — returns full card HTML from state
- `buildAdvancementCardContent(actorName, newSkillName, parentSkillName, newLevel, xpSpent, xpCost)` — returns advancement announcement HTML
- `rebuildChallengeCard(challenge)` — fetches the card message and updates it
- `recordChallengeRoll(tokenId, rollResult)` — records a result, rebuilds card, clears challenge if all tokens have rolled

Active challenge shape:
```js
{
  challengeId:     string,    // stable ID linking the card and all related rolls
  dc:              number,    // the difficulty
  dcVisible:       boolean,   // whether players can see DC (always true currently)
  prompt:          string,    // GM's situation description
  tokenIds:        string[],  // tokens called to roll
  rolledIds:       string[],  // tokens that have already rolled
  results:         object,    // { [tokenId]: rollResult }
  challengeCardId: string,    // messageId of the shared challenge card
  timestamp:       number,    // Date.now() — used for 3-minute timeout
  complete:        boolean,
}
```

---

## Socket Pattern

World-scoped settings can only be written by GMs. Players delegate via socket:

| type | direction | handler |
|------|-----------|---------|
| `recordChallengeRoll` | player → GM | GM writes result to settings, rebuilds card; posts advancement card if `skillClaimed` |
| `claimAdvancement` | player → GM | Player named the skill themselves; GM updates result in settings, rebuilds card, posts announcement |
| `advancementNeeded` | player → GM | GM gets a `DialogV2` to name the new skill; GM adds it to actor, updates settings, posts announcement |

`"socket": true` must be in `system.json`. Requires a full world reload (not just browser refresh) to take effect after changing.

---

## Button Wiring

All chat button listeners live in the `renderChatMessageHTML` hook in `roll-for-shoes.mjs`. This hook fires on every render including after `message.update()` calls, so re-rendered cards always get fresh listeners.

| data-action | surface | calls |
|-------------|---------|-------|
| `rfsOpenSheet` | challenge card portrait (all rows) | `actor.sheet.render(true)` |
| `rfsClaimAdvancement` | standalone card | `RfsSkillRoll.claimAdvancement(actorId, skillId, messageId)` |
| `rfsSpendXp` | standalone card | `RfsSkillRoll.spendXpOnCard(messageId)` |

---

## DC Resolution Order

`RfsSkillRoll._resolveDifficulty(actor, options)` resolves in this order:

1. `options.difficulty` set explicitly — use it
2. `options.challengeId` matches active challenge — use that challenge's DC
3. Actor has a token in active challenge `tokenIds` — use that DC (sheet-based roll auto-routing)
4. Default — 4 (Easy)

Sheet-initiated rolls pick up the active challenge DC automatically if the actor's token was called. No extra config needed from the player.

---

## GM Challenge Dialog

`src/dialogs/challenge-dialog.mjs` — `HandlebarsApplicationMixin(ApplicationV2)`.

Instance state (not form data — survives template re-renders):
- `this._dc` — current DC value (2–24)
- `this._dcDice` — selected dice (1 = static, 2–4 = roll Nd6 on Post)

Actions:
- `stepDc` — ±1 via `data-dir`
- `setDc` — jump to canonical value via `data-value`
- `selectDice` — pick dice count via `data-dice`
- `removeToken` — remove a called token

`_onSubmit` reads `this._dc` and `this._dcDice` directly (not formData). If `_dcDice > 1`, rolls that many d6 for the final DC; otherwise uses `this._dc` as-is.

`difficultyMode` world setting:
- `standard` — default DC 3, canonical buttons: 3, 6, 9, 12, 15, 18, 21, 24
- `moreXp` — default DC 4, canonical buttons: 4, 8, 12, 16, 20, 24

---

## Character Sheet

`HandlebarsApplicationMixin(ActorSheetV2)` with `submitOnChange: true` for auto-save.

- **Portrait** — `<button data-action="editPortrait">` opens a `FilePicker`; vellum shows pencil overlay on hover
- **Name** — text input; auto-saves
- **XP** — number input (`system.xp`); auto-saves
- **Biography** — textarea (`system.biography`); auto-saves
- **Skills (view mode)** — clicking the skill name button rolls that skill
- **Skills (edit mode)** — skill name is an inline `<input>` with `name="system.skills.{originalIndex}.name"`; a small ▶ button rolls; root skill is read-only
- **`originalIndex`** — added by `_sortSkillsForDisplay()` so sorted display order cannot cause form submissions to update the wrong skill in the stored array
- **`_processFormData`** — merges incoming skill name inputs with the rest of each skill's data (level, id, parentId) so partial form updates don't reset unsubmitted fields
- **`⤢` button** — opens `RfsSkillMapDialog` — full horizontal bracket tree in a resizable popup

## Skill Map Dialog

`RfsSkillMapDialog` — `HandlebarsApplicationMixin(ApplicationV2)`.

- Singleton per actor: tracked in `static #open: Map<actorId, dialog>`
- `static open(actor)` — deduplicates; brings existing to front
- Renders `skill-map-dialog.hbs` which wraps the existing `skill-tree.hbs` partial

---

## CSS / Theme System

Base styles: `styles/rfs-base.css` + `styles/rfs-chat.css`

Themes live in `styles/themes/<name>.css` and are scoped to `[data-rfs-theme="<id>"]`.
The theme is applied by setting `document.body.dataset.rfsTheme` on world load and
whenever the setting changes (no reload required).

Current themes: `dark-factory`, `clean-light`, `vellum` (default).

All CSS values use custom properties defined in `rfs-base.css` — no hardcoded colours.
Theme files override those custom properties within their scoped selector, then add any
structural rules unique to that theme.

Class naming convention: `rfs-` prefix throughout, BEM structure.

### Key custom property groups
- `--rfs-color-*` — semantic colours (overridden by themes)
- `--rfs-font-*` — typefaces and sizes
- `--rfs-space-*` — spacing scale
- `--rfs-challenge-*` — challenge card palette (dark-on-dark by default)
- `--rfs-radius-*`, `--rfs-shadow-*`, `--rfs-anim-*`
