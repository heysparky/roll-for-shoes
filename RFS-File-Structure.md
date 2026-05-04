# Roll for Shoes — File Structure

## Repository Layout

```
roll-for-shoes/                    ← repo root
├── .gitattributes
├── .gitignore
├── README.md
├── RFS-Architecture.md            ← design decisions, challenge flow, card lifecycle
├── RFS-File-Structure.md          ← this file
├── RFS-Milestones.md              ← progress tracking, current state, rules reference
├── system.json
├── template.json
├── roll-for-shoes.mjs             ← entry point; init, hooks, all chat button wiring
├── assets/
│   ├── icons/
│   │   └── rfs-call-for-roll.svg
│   ├── tokens/
│   │   └── rfs-default-token.svg
│   └── ui/
│       └── rfs-system-logo.webp
├── lang/
│   └── en.json
├── src/
│   ├── data/
│   │   └── actor-data.mjs         ← TypeDataModel schemas for character + npc
│   ├── dialogs/
│   │   └── challenge-dialog.mjs   ← GM challenge dialog; posts challenge card + player widgets
│   ├── documents/
│   │   └── actor.mjs              ← RfsActor; skill/xp/status mutations, getRollData
│   ├── helpers/
│   │   ├── config.mjs
│   │   ├── settings.mjs           ← settings registration; activeChallenge state;
│   │   │                            buildChallengeCardContent; rebuildChallengeCard
│   │   └── templates.mjs
│   ├── hud/
│   │   └── token-hud.mjs          ← shoe button → opens challenge dialog
│   ├── rolls/
│   │   └── skill-roll.mjs         ← all roll logic; challenge + standalone paths;
│   │                                whisper card lifecycle (crystallise, never delete)
│   └── sheets/
│       ├── character-sheet.mjs
│       └── npc-sheet.mjs
├── styles/
│   ├── rfs-base.css
│   └── themes/
│       ├── dark-factory.css
│       └── clean-light.css
└── templates/
    ├── actor/
    │   ├── character-sheet.hbs
    │   ├── npc-sheet.hbs
    │   └── partials/
    │       ├── skill-node.hbs
    │       ├── skill-tree.hbs
    │       ├── status-list.hbs
    │       └── xp-tracker.hbs
    └── dialog/
        └── challenge-dialog.hbs   ← prompt field, DC mode toggle, DC visibility toggle
```

---

## Chat Card Types

All RFS chat cards are identified by `message.flags["roll-for-shoes"].type`.

| type | visibility | description |
|------|------------|-------------|
| `challenge` | public | Shared GM challenge card. Live-updating table with one row per called token. Rebuilt on every roll via `rebuildChallengeCard()` in settings.mjs. Never has interactive buttons — read-only for all players. |
| `playerWidget` | whisper | Roll widget sent to each called player. Skill dropdown + Roll button. Crystallises to "Roll sent" after the player rolls. |
| `advancementWidget` | whisper | Appears after a player rolls all sixes. Player types new skill name inline and clicks Claim. Crystallises to "✦ [skill name] claimed" when done. Updates the challenge card row with the new skill name. |
| `xpSpendWidget` | whisper | Appears after a failed roll with non-six dice. Shows the dice and XP cost. One Spend button. Crystallises to "Spent N XP — advancement triggered" when done, then posts an `advancementWidget`. |
| `challengeRoll` | whisper | Raw dice roll message posted for Dice So Nice and roll history. Not interactive. |
| standalone | public | Non-challenge skill rolls. Self-contained card with XP spend and Claim Skill buttons inline. Flags stored under the `rollData` key. |

---

## Key Relationships

```
roll-for-shoes.mjs
  └── renderChatMessageHTML hook — wires ALL chat card buttons

src/dialogs/challenge-dialog.mjs
  └── posts → challenge card (public) + playerWidget (whispered × N tokens)

src/rolls/skill-roll.mjs
  └── rollFromWidget()       → crystallises playerWidget
                             → calls recordChallengeRoll()
                             → posts advancementWidget or xpSpendWidget
  └── finaliseAdvancement()  → crystallises advancementWidget
                             → updates challenge card row via rebuildChallengeCard()
  └── spendXpFromWidget()    → crystallises xpSpendWidget
                             → posts advancementWidget

src/helpers/settings.mjs
  └── activeChallenge setting — single source of truth for challenge state
  └── buildChallengeCardContent() — renders challenge card HTML from state
  └── rebuildChallengeCard()      — updates the live challenge card message
  └── recordChallengeRoll()       — records result, rebuilds card, clears if complete
```
