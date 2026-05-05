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

The challenge flow is the core GM-to-player interaction loop.

### GM Side
1. Select tokens on canvas, click the shoe button on the token HUD
2. Challenge Dialog opens — set prompt, DC (roll or static), DC visibility, review tokens
3. Confirm → two things happen simultaneously:
   - A **shared Challenge Card** posts to public chat
   - A socket event (`openChallengeDialog`) fires to all clients

### Player Side
4. Each called player's `RfsChallengePlayerDialog` popup auto-opens via socket
5. Popup shows prompt, optionally DC, and a skill dropdown
6. Player picks skill, hits Roll — popup advances through states
7. Challenge Card row updates live with their result
8. If a player closes the popup early, they can reopen it by clicking their portrait on the challenge card

### Popup States
```
pick-skill → rolling → xp-spend | advancement → done (auto-closes 1.2s)
```
- **pick-skill**: skill `<select>` + Roll button (disabled until selection made)
- **rolling**: spinner / "Rolling…"
- **xp-spend**: shown when roll failed with non-six dice; Spend XP button
- **advancement**: shown on all-sixes (or after XP spend); name input + Claim button
- **done**: confirmation note, auto-closes after 1.2 seconds

### After All Players Have Rolled
- Challenge Card marks itself complete
- Active challenge clears from settings after a 2-second delay (so final card update lands first)
- Challenge also times out after 3 minutes if not all tokens roll

---

## Card Lifecycle — Crystallise, Never Delete

**Never delete a chat message.** Deletion shifts everything below it in the
queue, which is disruptive during active play.

Instead, when a card's action completes, **update its content in place** to
a quiet static confirmation. The card stays, the queue stays stable.

The challenge card is the only player-facing card for a challenge. There are no
per-player whisper cards. All player interaction happens in the popup dialog.

Standalone (non-challenge) skill rolls post their own self-contained card with
inline XP spend and Claim Skill buttons. These crystallise in-place when acted on.

---

## Chat Card Types

| type | visibility | description |
|------|------------|-------------|
| `challenge` | public | Shared GM challenge card. Live-updating, one portrait row per called token. Rebuilt on every roll via `rebuildChallengeCard()`. Read-only — no interactive buttons (portrait buttons open the player popup, wired via `renderChatMessageHTML`). |
| standalone | public | Non-challenge skill rolls. Self-contained card with XP spend and Claim Skill buttons inline. Flags stored under `rollData`. Crystallises in-place when actioned. |

---

## Challenge State — Settings Are the Source of Truth

The Challenge Card's content is rebuilt from scratch on every roll update.
The source of truth is `game.settings.get("roll-for-shoes", "activeChallenge")`.

**Never read state back from card HTML. Never use regex on message content.**

Key functions in `src/helpers/settings.mjs`:
- `buildChallengeCardContent(challenge)` — returns full card HTML from state
- `rebuildChallengeCard(challenge)` — fetches the card message and updates it
- `recordChallengeRoll(tokenId, rollResult)` — records a result, rebuilds card,
  clears challenge if all tokens have rolled

Active challenge shape:
```js
{
  challengeId:     string,    // stable ID linking all related cards
  dc:              number,    // the difficulty
  dcVisible:       boolean,   // whether players see DC before rolling
  prompt:          string,    // GM's situation description
  tokenIds:        string[],  // tokens called to roll
  rolledIds:       string[],  // tokens that have rolled
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
| `openChallengeDialog` | GM → all clients | Each player checks ownership, opens popup |
| `recordChallengeRoll` | player → GM | GM writes result to settings, rebuilds card |
| `claimAdvancement` | player → GM | GM updates result in settings, rebuilds card |

`"socket": true` must be in `system.json`. Requires a full world reload (not just
browser refresh) to take effect after changing.

---

## Button Wiring

All chat button listeners live in the `renderChatMessageHTML` hook in
`roll-for-shoes.mjs`. This hook fires on every render including after
`message.update()` calls, so re-rendered cards always get fresh listeners.

| data-action | surface | calls |
|-------------|---------|-------|
| `rfsOpenChallengeDialog` | challenge card portrait (pending only) | `RfsChallengePlayerDialog.open(tokenId, actorId, challengeId)` |
| `rfsClaimAdvancement` | standalone card | `RfsSkillRoll.claimAdvancement(actorId, skillId, messageId)` |
| `rfsSpendXp` | standalone card | `RfsSkillRoll.spendXpOnCard(messageId)` |

Popup actions (`rfsDialogRoll`, `rfsDialogSpendXp`, `rfsDialogClaim`, `rfsDialogDismiss`)
are wired in `RfsChallengePlayerDialog.DEFAULT_OPTIONS.actions` — not in `renderChatMessageHTML`.

---

## Challenge Player Dialog

`src/dialogs/challenge-player-dialog.mjs` — `HandlebarsApplicationMixin(ApplicationV2)`.

- One instance per token, tracked in `static _openDialogs: Map<tokenId, dialog>`
- `static open(tokenId, actorId, challengeId)` — deduplicates; brings existing to front
- Opening a new challenge auto-closes any dialog from a different `challengeId`
- On construction, reconstructs `_step` from existing challenge state (handles re-opens)
- `canInteract = actor.testUserPermission(game.user, "OWNER") && !game.user.isGM`
  - GM can open any player's dialog in read-only mode (sees state, no controls)
- Auto-closes 1.2 seconds after reaching the `done` step

---

## Character Sheet

`HandlebarsApplicationMixin(ActorSheetV2)` with `submitOnChange: true` for auto-save.

- Click a skill name → rolls that skill (`rollSkill` action)
- Portrait uses `data-edit="img"` (Foundry native) — not a custom action
- No add/remove skill buttons in the UI — progression happens via rolls
- Pips (× level) only — no level number badge
- **Skill display**: compact flat list (`skill-index.hbs`) — pips + name, depth-indented by `--rfs-skill-depth` CSS var
- **`⤢` button**: opens `RfsSkillMapDialog` — full horizontal bracket tree in a resizable popup
- Skills panel is `flex: 1` in the sheet body, so it fills the height as skills grow

## Skill Map Dialog

`RfsSkillMapDialog` — `HandlebarsApplicationMixin(ApplicationV2)`.

- Singleton per actor: tracked in `static #open: Map<actorId, dialog>`
- `static open(actor)` — deduplicates; brings existing to front
- Renders `skill-map-dialog.hbs` which wraps the existing `skill-tree.hbs` partial
- Bracket tree connector lines are vellum-themed; see vellum.css SKILL TREE section

---

## DC Resolution Order

`RfsSkillRoll._resolveDifficulty(actor, options)` resolves in this order:

1. `options.difficulty` set explicitly — use it
2. `options.challengeId` matches active challenge — use that challenge's DC
3. Actor has a token in active challenge `tokenIds` — use that DC
4. Default — 4 (Easy)

Sheet-initiated rolls still pick up the active challenge DC if the actor's token
was called. Dialog rolls pass `challengeId` directly.

---

## CSS / Theme System

Base styles: `styles/rfs-base.css` + `styles/rfs-chat.css`

Themes live in `styles/themes/<name>.css` and are scoped to `[data-rfs-theme="<id>"]`.
The theme is applied by setting `document.body.dataset.rfsTheme` on world load and
whenever the player changes their theme setting.

Current themes: `dark-factory`, `clean-light`, `vellum` (default).

All CSS values use custom properties defined in `rfs-base.css` — no hardcoded colours.
Theme files override those custom properties within their scoped selector, then add any
structural rules unique to that theme.

Class naming convention: `rfs-` prefix throughout, BEM structure.
