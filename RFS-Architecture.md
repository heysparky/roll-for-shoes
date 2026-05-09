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
3. Post → if `dcDice > 1`, rolls Nd6 for the DC (DSN shows the dice); sound plays either way
4. The **shared Challenge Card** appears in public chat; all non-GM clients auto-switch to the chat sidebar

### Player Side
5. Player sees the challenge card in chat; rolls any skill from their character sheet as normal
6. `_resolveDifficulty` detects the player's token is in `challenge.tokenIds` → routes through `_postChallengeResult`
7. Roll result is recorded via socket (player → GM); GM writes to settings and rebuilds the challenge card
8. The portrait button on the challenge card opens the character sheet (`rfsOpenSheet`)

### Advancement After a Challenge Roll

All advancement dialogs use themed `.rfs-adv-dlg` HTML inside `DialogV2`.

**XP spend (non-all-sixes roll):**
1. Player sees `_confirmXpSpend` — "Spend N XP on a new skill?" (themed confirm dialog)
2. On yes: `actor.spendXp()` runs immediately
3. If `advancementNamer === "player"` or `game.user.isGM`: `_promptSkillName(skill, true)` opens on the rolling client
4. If `advancementNamer === "gm"` and player client: `recordChallengeRoll` records pending state, then `advancementNeeded` socket → GM gets `_promptGmSkillName`; names skill; `_gmMarkAdvancementClaimed` updates state + posts announcement

**All sixes (natural advancement):**
- `advancementNamer === "player"`: `_promptSkillName(skill, false)` — "You earned a skill!" — opens on the rolling client; named result goes via `claimAdvancement` socket to GM
- `advancementNamer === "gm"` and player client: `advancementNeeded` socket → GM gets `_promptGmSkillName` — "{Actor} earned a skill!"
- `advancementNamer === "gm"` and GM is the rolling client: `_promptGmSkillName` opens inline

Either path posts a `.rfs-advancement` announcement card to public chat.

### After All Players Have Rolled
- Challenge Card marks itself complete
- Active challenge clears from settings after a 2-second delay (so final card update lands first)
- Challenge also times out after 3 minutes if not all tokens roll

### Race Condition Guard
`recordChallengeRoll` in `settings.mjs` uses a module-level promise queue (`_rollQueue`) to serialise concurrent calls. Two players rolling simultaneously both get their results recorded in order without either clobbering the other.

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
| standalone | public | Non-challenge skill rolls. Speaker alias carries `"ActorName · SkillName (Nd6)"`. Self-contained card with XP spend and Claim Skill buttons. Flags under `rollData`. Crystallises in-place when actioned. |

---

## Challenge State — Settings Are the Source of Truth

The Challenge Card's content is rebuilt from scratch on every roll update.
The source of truth is `game.settings.get("roll-for-shoes", "activeChallenge")`.

**Never read state back from card HTML. Never use regex on message content.**

Key functions in `src/helpers/settings.mjs`:
- `buildChallengeCardContent(challenge)` — returns full card HTML from state
- `buildAdvancementCardContent(actorName, newSkillName, parentSkillName, newLevel, xpSpent, xpCost)` — returns advancement announcement HTML
- `rebuildChallengeCard(challenge)` — fetches the card message and updates it
- `recordChallengeRoll(tokenId, rollResult)` — records a result (serialised via promise queue), rebuilds card, clears challenge if all tokens have rolled

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

World-scoped settings can only be written by GMs. Players delegate via socket.
GMs bypass the socket and call handlers directly (`game.user.isGM` guard before each emit).

| type | direction | handler |
|------|-----------|---------|
| `recordChallengeRoll` | player → GM | GM writes result to settings (via queue), rebuilds card |
| `claimAdvancement` | player → GM | Player named the skill (player-namer path); GM updates result in settings, rebuilds card, posts announcement |
| `advancementNeeded` | player → GM | GM gets `_promptGmSkillName` dialog; names skill; adds to actor; if challenge roll → `_gmMarkAdvancementClaimed`; if standalone → updates original card + posts announcement |

`"socket": true` must be in `system.json`. Requires a full world reload (not just browser refresh) to take effect after changing.

---

## Standalone Roll Cards

Standalone rolls use `ChatMessage.create()` (never `roll.toMessage()`) to avoid Foundry rendering its own dice formula header over our card content.

- **Speaker alias** is set to `"ActorName · SkillName (Nd6)"` so the roll context appears in Foundry's native bold message header
- **DSN** is called explicitly with `game.dice3d.showForRoll(roll, game.user, true)` before creating the message; fallback: `foundry.audio.AudioHelper.play(...)` when DSN is absent
- Card content: dice faces, result strip (success/failure + DC), action area (Claim Skill button or Spend XP button or claimed note)
- Advancement from standalone cards also respects `advancementNamer`: if namer=gm and non-GM, clicking "Claim Skill" or "Spend XP" emits `advancementNeeded` to the GM; card shows a pending note until the GM names the skill

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

`_onSubmit` reads `this._dc` and `this._dcDice` directly (not formData). If `_dcDice > 1`, evaluates that Roll, shows DSN, and uses the total as the final DC. If `_dcDice === 1`, uses `this._dc` as-is and plays a dice sound.

`difficultyMode` world setting:
- `standard` — default DC 3, canonical buttons: 3, 6, 9, 12, 15, 18, 21, 24
- `moreXp` — default DC 4, canonical buttons: 4, 8, 12, 16, 20, 24

---

## Character Sheet

`HandlebarsApplicationMixin(ActorSheetV2)` with `submitOnChange: true` for auto-save.

- **Portrait** — `<button data-action="editPortrait">` opens a `FilePicker` with `render(true)`; vellum shows pencil overlay on hover
- **Name** — text input; auto-saves
- **XP** — number input (`system.xp`); auto-saves
- **Biography** — textarea (`system.biography`); auto-saves
- **Skills** — compact flat list (`skill-index.hbs`); clicking the skill name button rolls that skill; depth-indented via `--rfs-skill-depth` CSS custom property
- **Rename skill** — pencil icon button per skill (except root) opens `DialogV2.input`; root skill excluded
- **`originalIndex`** — added by `_sortSkillsForDisplay()` so sorted display order cannot cause form submissions to update the wrong skill in the stored array
- **`_processFormData`** — merges incoming skill name inputs with the rest of each skill's data (level, id, parentId) so partial form updates don't reset unsubmitted fields

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
