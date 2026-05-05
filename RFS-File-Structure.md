# Roll for Shoes — File Structure

## Repository Layout

```
roll-for-shoes/                    ← repo root
├── CLAUDE.md                      ← Claude Code instructions (read first)
├── RFS-Architecture.md            ← design decisions, challenge flow, card lifecycle
├── RFS-File-Structure.md          ← this file
├── RFS-Milestones.md              ← progress tracking, current dev state, rules reference
├── README.md
├── system.json                    ← Foundry manifest; styles array, socket: true
├── template.json
├── roll-for-shoes.mjs             ← entry point; init, ready hooks, renderChatMessageHTML
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
│   │   └── actor-data.mjs         ← TypeDataModel schemas (CharacterData, NpcData)
│   ├── dialogs/
│   │   ├── challenge-dialog.mjs        ← GM challenge dialog; posts card, emits socket
│   │   ├── challenge-player-dialog.mjs ← Player popup; pick-skill→roll→xp-spend|advancement→done
│   │   └── skill-map-dialog.mjs        ← Full bracket tree popup; singleton per actor via static Map
│   ├── documents/
│   │   └── actor.mjs              ← RfsActor; skill/xp/status mutations, getSkillById
│   ├── helpers/
│   │   ├── config.mjs             ← RFS constants, DC scale, theme registry
│   │   ├── settings.mjs           ← settings registration; activeChallenge state machine;
│   │   │                            buildChallengeCardContent; rebuildChallengeCard
│   │   └── templates.mjs          ← template preloading, Handlebars helpers
│   ├── hud/
│   │   └── token-hud.mjs          ← shoe button → opens challenge dialog
│   ├── rolls/
│   │   └── skill-roll.mjs         ← all roll logic; challenge + standalone paths; returns result object
│   └── sheets/
│       ├── character-sheet.mjs    ← ActorSheetV2; rollSkill action; submitOnChange
│       └── npc-sheet.mjs
├── styles/
│   ├── rfs-base.css               ← layout, structure, custom property definitions
│   ├── rfs-chat.css               ← chat cards, challenge card, player popup dialog
│   └── themes/
│       ├── dark-factory.css       ← steampunk dark theme
│       ├── clean-light.css        ← minimal light theme
│       ├── vellum.css             ← dark academia / oxblood & gold (default)
│       └── REGISTRATION.md        ← how to wire a new theme
└── templates/
    ├── actor/
    │   ├── character-sheet.hbs
    │   ├── npc-sheet.hbs
    │   └── partials/
    │       ├── skill-index.hbs    ← compact flat skill list for character sheet panel
    │       ├── skill-node.hbs     ← bracket tree node (used by skill-tree.hbs → skill-map-dialog)
    │       ├── skill-tree.hbs     ← full bracket tree (rendered in ⤢ popup only)
    │       ├── status-list.hbs
    │       └── xp-tracker.hbs
    └── dialog/
        ├── challenge-dialog.hbs         ← GM challenge setup form
        ├── challenge-player-dialog.hbs  ← Player popup (all steps, boolean flags, no eq helper)
        └── skill-map-dialog.hbs         ← Full bracket tree popup wrapper
```

---

## Chat Card Types

| type | visibility | description |
|------|------------|-------------|
| `challenge` | public | Shared challenge card. One portrait row per called token. Live-updating via `rebuildChallengeCard()`. Portrait is a button (pending players only) that opens the player popup. Done-player portraits are plain `<img>`. |
| standalone | public | Non-challenge skill rolls. Self-contained card with inline XP spend and Claim Skill buttons. Flags under `rollData`. Crystallises in-place when actioned. |

There are no whisper cards. All player-side challenge interaction happens in `RfsChallengePlayerDialog`.

---

## Key Relationships

```
roll-for-shoes.mjs
  ├── init hook       — registers sheets, settings, document classes, keybindings
  ├── ready hook      — socket listener (openChallengeDialog, recordChallengeRoll, claimAdvancement)
  └── renderChatMessageHTML hook — wires ALL chat card buttons
        rfsOpenChallengeDialog → RfsChallengePlayerDialog.open()
        rfsClaimAdvancement    → RfsSkillRoll.claimAdvancement()
        rfsSpendXp             → RfsSkillRoll.spendXpOnCard()

src/dialogs/challenge-dialog.mjs
  └── _postChallenge() → posts challenge card (public)
                       → game.socket.emit("openChallengeDialog") → players auto-open popup

src/dialogs/challenge-player-dialog.mjs
  └── _onRoll()    → RfsSkillRoll.roll() → recordChallengeRoll socket → challenge card updates
  └── _onSpendXp() → actor.spendXp() → step advances to advancement
  └── _onClaim()   → actor.addSkill() → claimAdvancement socket → challenge card updates

src/rolls/skill-roll.mjs
  └── roll()                  → challenge path: emits recordChallengeRoll socket only
                              → standalone path: posts self-contained card
  └── spendXpOnCard()         → crystallises standalone card with XP spend
  └── claimAdvancement()      → crystallises standalone card with claimed skill

src/helpers/settings.mjs
  └── activeChallenge setting     — single source of truth
  └── buildChallengeCardContent() — renders challenge card HTML from state
  └── rebuildChallengeCard()      — updates the live challenge card message
  └── recordChallengeRoll()       — records result, rebuilds card, clears if all rolled
```

---

## Challenge Card HTML Structure

```html
<div class="rfs-challenge">
  <div class="rfs-challenge__header">
    <span class="rfs-challenge__gear">⚙</span>
    <span class="rfs-challenge__title">Challenge</span>
    <span class="rfs-challenge__dc">DC N</span>  <!-- or --hidden variant -->
  </div>
  <div class="rfs-challenge__prompt">…</div>
  <div class="rfs-challenge__players">
    <!-- pending player -->
    <div class="rfs-challenge__player rfs-challenge__player--pending">
      <button class="rfs-challenge__player-btn" data-action="rfsOpenChallengeDialog" …>
        <img class="rfs-challenge__portrait" …>
      </button>
      <div class="rfs-challenge__player-info">
        <span class="rfs-challenge__player-name">…</span>
        <span class="rfs-challenge__player-skill rfs-challenge__player-skill--waiting">…</span>
      </div>
      <div class="rfs-challenge__player-result">
        <span class="rfs-challenge__player-total rfs-challenge__player-total--waiting">--</span>
      </div>
    </div>
    <!-- done player -->
    <div class="rfs-challenge__player rfs-challenge__player--success|failure|tie">
      <img class="rfs-challenge__portrait" …>  <!-- plain img, not a button -->
      <div class="rfs-challenge__player-info">…</div>
      <div class="rfs-challenge__player-result">
        <span class="rfs-challenge__player-total rfs-challenge__player-total--success|failure|tie">N</span>
        <span class="rfs-challenge__player-dice">[d, d, …]</span>
      </div>
    </div>
  </div>
  <div class="rfs-challenge__footer">
    <span class="rfs-challenge__status-dot rfs-challenge__status-dot--pulsing|complete"></span>
    <span class="rfs-challenge__status-text">…</span>
  </div>
</div>
```
