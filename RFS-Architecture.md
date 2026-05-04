# Roll for Shoes — Architecture & Design Decisions

This document captures RFS-specific design decisions and working patterns.
It is not a Foundry API reference — that lives in dnd5e-reference.mjs.
Read both before touching the challenge flow.

---

## What Claude Should Know Before Starting

- This is a **game system**, not a module. It lives in `Data/systems/`, uses `system.json`.
- Source is in `src/` — not `module/`.
- All template paths use `systems/roll-for-shoes/...`
- Sheet registration uses `DocumentSheetConfig.registerSheet(Actor, ...)`.
- **Never use Python `open(file, 'w')` to write JS files.** Python truncates the
  file before writing — if the write fails (e.g. emoji encoding error), the file
  is gone. Use `str_replace` for targeted edits, `create_file` for whole-file
  writes. If `str_replace` fails on a unicode match string, use `create_file`.

---

## Challenge Flow

The challenge flow is the core GM-to-player interaction loop.

### GM Side
1. Select tokens on canvas, click the shoe button on the token HUD
2. Challenge Dialog opens — set prompt, DC (roll or static), DC visibility, review tokens
3. Confirm → two things post simultaneously:
   - A **shared Challenge Card** to public chat
   - A **whispered Roll Widget** to each called player

### Player Side
4. Roll Widget appears in chat — shows prompt, optionally DC, skill dropdown, Roll button
5. Button is disabled until a skill is selected
6. Player picks skill, hits Roll
7. Widget crystallises to "Roll sent" (see card lifecycle below)
8. Challenge Card row updates live with their result

### After Rolling
- **All sixes** → whispered **Advancement Widget** appears for that player
- **Failed with non-sixes** → whispered **XP Spend Widget** appears for that player
- **Neither** → nothing more, result is on the challenge card

### Advancement Widget
- Player types new skill name inline, clicks Claim (or hits Enter)
- Widget crystallises to "[skill name] claimed"
- Challenge Card row updates to show the new skill name

### XP Spend Widget
- Shows the dice rolled, shows the XP cost
- One Spend button — clicking it spends XP and posts an Advancement Widget
- Widget crystallises to "Spent N XP — advancement triggered"

### Completion
- When all called tokens have rolled, Challenge Card marks itself complete
- Active challenge clears from settings after a 2-second delay (so the final
  card update lands first)
- Challenge also times out after 3 minutes if not all tokens roll

---

## Card Lifecycle — Crystallise, Never Delete

**Never delete a chat message.** Deletion shifts everything below it in the
queue, which is disruptive during active play when multiple whisper cards
are in flight.

Instead, when a card's action completes, **update its content in place** to
a quiet static confirmation. The card stays, the queue stays stable.

```js
// Widget crystallises after the player rolls
await message.update({
  content: `<div class="rfs-widget rfs-widget--done">
    <span class="rfs-widget__done-note">Roll sent</span>
  </div>`,
  flags: { "roll-for-shoes": { ...flags, rolled: true } },
});
```

In `renderChatMessageHTML`, check the done flag to disable inputs on re-render:
```js
const flags = message.flags?.["roll-for-shoes"];
if (flags?.rolled) {
  select.disabled = true;
  btn.disabled = true;
  return;
}
```

---

## Chat Card Types

All RFS cards are identified by `message.flags["roll-for-shoes"].type`.

| type | visibility | interactive | crystallises to |
|------|------------|-------------|-----------------|
| `challenge` | public | no — read-only table | stays live until complete |
| `playerWidget` | whisper | skill dropdown + Roll button | "Roll sent" |
| `advancementWidget` | whisper | text input + Claim button | "[skill name] claimed" |
| `xpSpendWidget` | whisper | Spend button | "Spent N XP — advancement triggered" |
| `challengeRoll` | whisper | no — raw dice record for Dice So Nice | n/a |

Standalone (non-challenge) rolls post their own self-contained card with flags
stored under the `rollData` key. These use the dialog-based claim flow, not
the widget flow.

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

## Button Wiring

All chat button listeners live in the `renderChatMessageHTML` hook in
`roll-for-shoes.mjs`. This hook fires on every render including after
`message.update()` calls, so re-rendered cards get fresh listeners.

| data-action | card type | calls |
|-------------|-----------|-------|
| `rfsWidgetRoll` | playerWidget | `RfsSkillRoll.rollFromWidget(messageId, skillId)` |
| `rfsClaimFromWidget` | advancementWidget | `RfsSkillRoll.finaliseAdvancement(messageId, name)` |
| `rfsWidgetSpendXp` | xpSpendWidget | `RfsSkillRoll.spendXpFromWidget(messageId)` |
| `rfsClaimAdvancement` | standalone card | `RfsSkillRoll.claimAdvancement(actorId, skillId, messageId)` |
| `rfsSpendXp` | standalone card | `RfsSkillRoll.spendXpOnCard(messageId)` |

Always disable inputs immediately on click (before the async call) to prevent
double-fire during the round-trip.

---

## Token Ownership Matching

When posting a whispered widget for a token, the owning player is found by:
```js
game.users.find(u => u.character?.id === actor.id && !u.isGM)
```

Edge cases:
- GM-owned tokens or unlinked tokens: falls back to all non-GM players
- The `tokenId` is stored in widget flags and passed through `options.tokenId`
  to `roll()` so `recordChallengeRoll` does not need a canvas lookup (which
  fails if the token is not on the current scene)

---

## DC Resolution Order

`RfsSkillRoll._resolveDifficulty(actor, options)` resolves in this order:

1. `options.difficulty` set explicitly — use it
2. `options.challengeId` matches active challenge — use that challenge's DC
3. Actor has a token in active challenge `tokenIds` — use that DC
4. Default — 4 (Easy)

Sheet-initiated rolls (no widget) still pick up the active challenge DC if
the actor's token was called. Widget rolls pass `challengeId` directly so
they always resolve correctly regardless of canvas state.

---

## Advancement Prompt Copy — TODO

`RfsSkillRoll._postAdvancementWidget` accepts `xpPurchased: boolean`.
Both paths currently use the same prompt text (`RFS.Dialog.Advancement.Hint`).
There is a TODO comment in that method marking where to fork the copy:

- `xpPurchased === false` (natural all-sixes): celebratory tone
- `xpPurchased === true` (XP spend): acknowledge the cost

Come back to this when copy is written.
