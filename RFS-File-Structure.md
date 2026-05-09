# Roll for Shoes — File Structure

## Repository Layout

```
roll-for-shoes/                    ← repo root
├── CLAUDE.md                      ← Claude Code instructions (read first)
├── RFS-Architecture.md            ← design decisions, challenge flow, card lifecycle
├── RFS-File-Structure.md          ← this file
├── RFS-Milestones.md              ← progress tracking, current dev state, rules reference
├── README.md
├── system.json                    ← Foundry manifest; styles array, socket: true,
│                                    documentTypes (Actor: character + npc)
├── roll-for-shoes.mjs             ← entry point; init, ready, createChatMessage,
│                                    renderChatMessageHTML hooks; socket listener
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
│   │                                 CharacterData: skills[], xp, statuses[], biography
│   ├── dialogs/
│   │   ├── challenge-dialog.mjs   ← GM challenge dialog; DC stepper + dice picker;
│   │   │                            posts challenge card; DSN/sound on post
│   │   └── roll-result-dialog.mjs ← fire-and-forget popup for standalone roll results;
│   │                                 shows dice, outcome strip, Claim Skill / Spend XP;
│   │                                 actions in DEFAULT_OPTIONS (not renderChatMessageHTML)
│   ├── documents/
│   │   └── actor.mjs              ← RfsActor; skill/xp/status mutations, getSkillById,
│   │                                 addRollHistory (flag-based, max 50 entries)
│   ├── helpers/
│   │   ├── config.mjs             ← RFS constants, DC scale, theme registry
│   │   ├── settings.mjs           ← settings registration; activeChallenge state machine;
│   │   │                            buildChallengeCardContent; buildAdvancementCardContent;
│   │   │                            rebuildChallengeCard; recordChallengeRoll (promise-queued)
│   │   └── templates.mjs          ← template preloading, Handlebars helpers
│   ├── hud/
│   │   └── token-hud.mjs          ← shoe button → opens challenge dialog
│   ├── rolls/
│   │   └── skill-roll.mjs         ← all roll logic; challenge + standalone paths;
│   │                                 themed advancement dialogs (_confirmXpSpend,
│   │                                 _promptSkillName, _promptGmSkillName);
│   │                                 DSN showForRoll called explicitly for all paths;
│   │                                 standalone: RfsRollResultDialog popup + addRollHistory
│   └── sheets/
│       ├── character-sheet.mjs    ← ActorSheetV2; Skills tab + Roll History tab;
│       │                            editPortrait, rollSkill, renameSkill, addStatus,
│       │                            switchTab actions; _sortSkillsForDisplay with
│       │                            originalIndex; submitOnChange
│       └── npc-sheet.mjs
├── styles/
│   ├── rfs-base.css               ← layout, structure, custom property definitions on :root
│   │                                includes: sheet, skill index, challenge card, buttons,
│   │                                biography textarea, DC stepper
│   ├── rfs-chat.css               ← roll result popup (.rfs-rrd), advancement
│   │                                announcement card (.rfs-advancement), advancement
│   │                                dialog content (.rfs-adv-dlg), button variants,
│   │                                challenge card (.rfs-challenge), player dialog (.rfs-cpd)
│   └── themes/
│       ├── dark-factory.css       ← steampunk dark theme
│       ├── clean-light.css        ← minimal light theme
│       ├── vellum.css             ← dark academia / oxblood & gold (default)
│       │                            scoped to [data-rfs-theme="vellum"]
│       └── REGISTRATION.md        ← how to wire a new theme
└── templates/
    ├── actor/
    │   ├── character-sheet.hbs    ← portrait, name, XP, biography; Skills tab
    │   │                            (skill-index + statuses) and Roll History tab
    │   ├── npc-sheet.hbs
    │   └── partials/
    │       ├── skill-index.hbs    ← compact flat skill list; click name to roll;
    │       │                        depth via --rfs-skill-depth; rename + delete buttons
    │       ├── status-list.hbs
    │       └── xp-tracker.hbs
    └── dialog/
        ├── challenge-dialog.hbs      ← DC stepper, canonical buttons, dice picker,
        │                               token list, Post/Cancel footer
        └── roll-result-dialog.hbs    ← dice row, outcome strip, Claim Skill / Spend XP
```

*(The skill map popup was removed — `skill-map-dialog.mjs`, `skill-node.hbs`, `skill-tree.hbs`, and `skill-map-dialog.hbs` no longer exist. Revert commit `41f27d8` to restore them.)*

---

## Chat Card Types

| type | visibility | description |
|------|------------|-------------|
| `challenge` | public | Shared challenge card. One portrait row per called token. Live-updating via `rebuildChallengeCard()`. All portrait rows are `<button data-action="rfsOpenSheet">` — clicking opens the character sheet. |
| `advancement` | public | Blingy announcement card posted when any skill is gained. Built by `buildAdvancementCardContent()`. Static, no buttons. |

There are no standalone roll cards and no whisper cards. Standalone rolls show a `RfsRollResultDialog` popup and record to the actor's roll history flag. All player-side challenge interaction happens via rolls from the character sheet.

---

## World Settings

| key | type | description |
|-----|------|-------------|
| `theme` | String | Active visual theme (`dark-factory`, `clean-light`, `vellum`) |
| `npcDefaultMode` | String | `fixed` or `full` — initial mode for new NPCs |
| `advancementNamer` | String | `player` or `gm` — who names new skills (challenge + standalone, all-sixes + XP spend) |
| `difficultyMode` | String | `standard` (default DC 3, 3/6/9…) or `moreXp` (default DC 4, 4/8/12…) |
| `activeChallenge` | Object | Live challenge state; null when idle. Written by GM only. |

---

## Key Relationships

```
roll-for-shoes.mjs
  ├── init hook            — registers sheets, settings, document classes, keybindings
  ├── ready hook           — socket listener:
  │     recordChallengeRoll  → GM writes result to settings (promise-queued), rebuilds card
  │     claimAdvancement     → player named skill; GM updates settings, posts announcement
  │     advancementNeeded    → GM gets _promptGmSkillName dialog; adds skill to actor;
  │                            challenge roll → _gmMarkAdvancementClaimed (state + card);
  │                            standalone roll → updates original message + posts announcement
  ├── createChatMessage hook — non-GMs auto-switch to chat sidebar when challenge card posts
  └── renderChatMessageHTML hook — wires ALL chat card buttons:
        rfsOpenSheet         → actor.sheet.render(true)
        rfsClaimAdvancement  → RfsSkillRoll.claimAdvancement()
        rfsSpendXp           → RfsSkillRoll.spendXpOnCard()

src/dialogs/challenge-dialog.mjs
  └── _onSubmit() → if dcDice > 1: evaluates Roll, shows DSN, uses total as DC
                    else: plays dice sound, uses this._dc
  └── _postChallenge() → posts challenge card (public) + sets activeChallenge in settings

src/rolls/skill-roll.mjs
  └── roll()
        → _resolveDifficulty() auto-detects called token → challenge path
        → DSN showForRoll or AudioHelper.play (all paths)
        → challenge path: _postChallengeResult()
            → _confirmXpSpend + _promptSkillName/_promptGmSkillName (advancementNamer-aware)
            → emits recordChallengeRoll socket (or writes directly if GM)
            → emits advancementNeeded socket if GM naming required
        → standalone path: actor.addRollHistory() → RfsRollResultDialog.open()
  └── claimAdvancement()  [called from popup or socket]
        → advancementNamer=gm + non-GM: emits advancementNeeded
        → else: _promptSkillName → actor.addSkill → posts advancement announcement
  └── _promptGmSkillName() — themed GM-facing naming dialog (also called from socket handler)
  └── _gmMarkAdvancementClaimed() — updates challenge state, rebuilds card, posts announcement

src/helpers/settings.mjs
  └── activeChallenge setting         — single source of truth
  └── _rollQueue                      — promise chain serialising concurrent recordChallengeRoll calls
  └── buildChallengeCardContent()     — renders challenge card HTML from state
  └── buildAdvancementCardContent()   — renders advancement announcement HTML
  └── rebuildChallengeCard()          — updates the live challenge card message
  └── recordChallengeRoll()           — queues result write, rebuilds card, posts advancement
                                        announcement if skillClaimed, clears when all rolled
```

---

## Challenge Card HTML Structure

```html
<div class="rfs-challenge" data-challenge-id="…">
  <div class="rfs-challenge__header">
    <span class="rfs-challenge__gear">⚙</span>
    <span class="rfs-challenge__title">Challenge</span>
    <span class="rfs-challenge__dc">DC N</span>
  </div>
  <div class="rfs-challenge__prompt">…</div>           <!-- only if prompt set -->
  <div class="rfs-challenge__players">

    <!-- pending player (not yet rolled) -->
    <div class="rfs-challenge__player rfs-challenge__player--pending">
      <button class="rfs-challenge__player-btn"
              data-action="rfsOpenSheet" data-actor-id="…">
        <div class="rfs-challenge__portrait"><img …></div>
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
      <button class="rfs-challenge__player-btn"
              data-action="rfsOpenSheet" data-actor-id="…">
        <div class="rfs-challenge__portrait"><img …></div>
      </button>
      <div class="rfs-challenge__player-info">
        <span class="rfs-challenge__player-name">…</span>
        <span class="rfs-challenge__player-skill">Skill N [→ ✦ New Skill]</span>
      </div>
      <div class="rfs-challenge__player-result">
        <span class="rfs-challenge__player-total rfs-challenge__player-total--success|failure|tie">N</span>
        <span class="rfs-challenge__player-dice">[d, d, …]</span>
      </div>
    </div>

  </div>
  <div class="rfs-challenge__footer">
    <div class="rfs-challenge__footer-left">
      <span class="rfs-challenge__status-dot rfs-challenge__status-dot--pulsing|complete"></span>
      <span class="rfs-challenge__status-text">X / Y rolled | ✔ All players have rolled.</span>
    </div>
  </div>
</div>
```

## Advancement Announcement Card HTML Structure

```html
<div class="rfs-advancement">
  <div class="rfs-advancement__header">
    <span class="rfs-advancement__mark">✦</span>
    <span class="rfs-advancement__title">New Skill!</span>
    <span class="rfs-advancement__mark">✦</span>
  </div>
  <div class="rfs-advancement__body">
    <div class="rfs-advancement__actor">Actor Name</div>
    <div class="rfs-advancement__skill">New Skill Name</div>
    <div class="rfs-advancement__meta">From Parent Skill</div>
  </div>
</div>
```

## Roll Result Popup (.rfs-rrd)

Standalone rolls show a fire-and-forget `RfsRollResultDialog` popup (not a chat card).

```html
<div class="rfs-rrd">
  <div class="rfs-rrd__dice-row">
    <span class="rfs-die [rfs-die--six]">N</span> …
  </div>
  <div class="rfs-rrd__outcome rfs-rrd__outcome--success|failure|allsixes">
    ✔ Success — total vs DC  |  ✘ Fail — total vs DC — +1 XP  |  ✦ All Sixes! — total vs DC
  </div>
  <!-- optional action buttons -->
  <button data-action="claimSkill">✦ Claim Skill</button>
  <button data-action="spendXp">Spend N XP & Advance</button>
</div>
```
