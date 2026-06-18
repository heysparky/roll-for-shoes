# Roll for Shoes — File Structure

## Repository Layout

```
roll-for-shoes/                    ← repo root
├── CLAUDE.md                      ← Claude Code instructions (read first)
├── RFS-Architecture.md            ← design decisions, roll flow, button wiring
├── RFS-File-Structure.md          ← this file
├── RFS-Milestones.md              ← progress tracking, current dev state, rules reference
├── README.md
├── system.json                    ← Foundry manifest; styles array, socket: true,
│                                    documentTypes (Actor: character + npc)
├── roll-for-shoes.mjs             ← entry point; init, ready, preCreateActor,
│                                    renderChatMessageHTML hooks; socket listener
├── assets/
│   ├── icons/
│   ├── tokens/
│   └── ui/
│       └── rfs-system-logo.webp
├── lang/
│   └── en.json
├── src/
│   ├── apps/
│   │   ├── dc-tracker.mjs         ← RfsDcTracker; persistent difficulty card for all users;
│   │   │                            GM adjusts globalDc via tier chips or +/− buttons;
│   │   │                            players see DC value read-only
│   │   └── pc-display.mjs         ← RfsPcDisplay; portrait pegs driven by pcFolder actor
│   │                                 folder; positioned right of DC tracker; click to pan+
│   │                                 select token, double-click to open sheet; deletes
│   │                                 orphaned tokens when a PC actor is deleted
│   ├── data/
│   │   └── actor-data.mjs         ← TypeDataModel schemas (CharacterData, NpcData)
│   │                                 CharacterData: skills[], xp, statuses[], biography
│   ├── dialogs/
│   │   └── roll-result-dialog.mjs ← fire-and-forget popup for roll results;
│   │                                 shows dice, outcome strip, Claim Skill / Spend XP;
│   │                                 actions in DEFAULT_OPTIONS (not renderChatMessageHTML)
│   ├── documents/
│   │   └── actor.mjs              ← RfsActor; skill/xp/status mutations, getSkillById,
│   │                                 addRollHistory (flag-based, max 50 entries)
│   ├── helpers/
│   │   ├── config.mjs             ← RFS constants, DC tiers (dcTiers), theme registry
│   │   ├── settings.mjs           ← settings registration (globalDc, difficultyMode,
│   │   │                            advancementNamer, theme, npcDefaultMode);
│   │   │                            buildAdvancementCardContent()
│   │   └── templates.mjs          ← template preloading, Handlebars helpers
│   ├── rolls/
│   │   └── skill-roll.mjs         ← all roll logic; reads globalDc via _resolveDifficulty;
│   │                                 themed advancement dialogs (_confirmXpSpend,
│   │                                 _promptSkillName, _promptGmSkillName);
│   │                                 DSN showForRoll called explicitly for all paths;
│   │                                 RfsRollResultDialog popup + addRollHistory
│   └── sheets/
│       ├── character-sheet.mjs    ← ActorSheetV2; play/edit mode toggle (_editMode,
│       │                            _getHeaderControls); _preClose flushes form on close;
│       │                            rollSkill, renameSkill, addStatus, switchTab actions;
│       │                            _sortSkillsForDisplay with originalIndex; submitOnChange
│       └── npc-sheet.mjs
├── styles/
│   ├── rfs-base.css               ← layout, structure, custom property definitions on :root
│   │                                includes: sheet, skill index, DC tracker bar (.rfs-dct),
│   │                                buttons, biography textarea
│   ├── rfs-chat.css               ← roll result popup (.rfs-rrd), advancement
│   │                                announcement card (.rfs-advancement), advancement
│   │                                dialog content (.rfs-adv-dlg), button variants
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
    ├── apps/
    │   ├── dc-tracker.hbs         ← DC value, tier chips (GM only), +/− step buttons (GM only)
    │   └── pc-display.hbs         ← portrait peg loop; one .rfs-portrait-peg per PC actor
    └── dialog/
        └── roll-result-dialog.hbs ← dice row, outcome strip, Claim Skill / Spend XP
```

*(The skill map popup was removed — `skill-map-dialog.mjs`, `skill-node.hbs`, `skill-tree.hbs`, and `skill-map-dialog.hbs` no longer exist. Revert commit `41f27d8` to restore them.)*

---

## Chat Card Types

| type | visibility | description |
|------|------------|-------------|
| `advancement` | public | Announcement posted when any skill is gained (natural all-sixes or XP spend). Built by `buildAdvancementCardContent()`. Static — no buttons. |

There are no challenge cards. All roll results surface via the `RfsRollResultDialog` fire-and-forget popup and record to the actor's roll history flag.

---

## World Settings

| key | type | description |
|-----|------|-------------|
| `theme` | String | Active visual theme (`dark-factory`, `clean-light`, `vellum`) |
| `npcDefaultMode` | String | `fixed` or `full` — initial mode for new NPCs |
| `difficultyMode` | String | `standard` (default DC 3) or `moreXp` (default DC 4) — shapes DC tier chips |
| `targetNamePicker` | String | `chips` / `menu` / `rail` / `none` — GM's DC picker UI mode |
| `pcFolder` | String | Name of the actor folder whose members appear as portrait pegs (default `"PCs"`; auto-created on first GM load) |
| `globalDc` | Number | Current global difficulty class; set by GM via DC tracker; read by all rolls |
| `syncTokenName` | Boolean | When true, renaming an actor also updates its prototype token and placed scene tokens |
| `sheetTextSize` | String | Per-client body text size for character sheets (`12px`–`18px`) |

---

## Key Relationships

```
roll-for-shoes.mjs
  ├── init hook            — registers sheets, settings, document classes
  ├── ready hook           — auto-creates PC folder; renders RfsDcTracker then RfsPcDisplay;
  │                          registers createActor/updateActor/deleteActor hooks (GM-only);
  │                          socket listener: splashShow → RollSplash.show()
  └── renderChatMessageHTML hook — wires all chat card buttons:
        rfsOpenSheet         → actor.sheet.render(true)
        rfsClaimAdvancement  → RfsSkillRoll.claimAdvancement()

src/apps/dc-tracker.mjs
  └── _prepareContext() → reads globalDc + difficultyMode → builds tier array
  └── _onStepDc()       → GM ±1 on globalDc
  └── _onSetDc()        → GM jumps to named tier value

src/apps/pc-display.mjs
  └── _prepareContext() → reads pcFolder setting → game.folders lookup → deduped portraits array
  └── _onRender()       → measures #rfs-dc-tracker.right + 16px → sets element.style.left;
                          wires click (pan+select) and dblclick (open sheet) per portrait peg
  └── _onPortraitClick()    → canvas.animatePan + token.control({ releaseOthers: true })
  └── _onPortraitDblClick() → actor.sheet.render(true) if actor.isOwner

src/rolls/skill-roll.mjs
  └── roll()
        → _resolveDifficulty()  reads options.difficulty ?? globalDc
        → DSN showForRoll or AudioHelper.play
        → actor.addXp(1) on failure
        → actor.addRollHistory()
        → _showRollResultPopup() → RfsRollResultDialog.open()
  └── _doStandaloneXpSpend()
        → _confirmXpSpend → actor.spendXp → _promptSkillName | advancementNeeded socket
  └── claimAdvancement()
        → advancementNamer=gm + non-GM: emits advancementNeeded
        → else: _promptSkillName → actor.addSkill → posts advancement announcement
  └── _promptGmSkillName() — themed GM-facing naming dialog (called from socket handler too)

src/helpers/settings.mjs
  └── buildAdvancementCardContent() — renders advancement announcement HTML
```

---

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

## DC Tracker (.rfs-target-display)

```html
<!-- dc-tracker.hbs — rendered by RfsDcTracker (id="rfs-dc-tracker") -->
<div class="rfs-target-display [rfs-target-display--locked]">
  <div class="rfs-target-display__card">
    <!-- rivets, label, +/− buttons, DC value, optional popover/rail -->
    <div class="rfs-target-display__value">N</div>
  </div>
  <!-- GM only: -->
  <div class="rfs-target-display__chips"> … </div>
</div>
```

## PC Display (.rfs-dct-pegs)

```html
<!-- pc-display.hbs — rendered by RfsPcDisplay (id="rfs-pc-display") -->
<div class="rfs-dct-pegs">
  <div class="rfs-portrait-peg" data-actor-id="…">
    <div class="rfs-portrait-peg__card">
      <div class="rfs-portrait-peg__portrait">
        <img src="…" alt="…">  <!-- or .rfs-portrait-peg__monogram fallback -->
      </div>
      <!-- 4 x .rfs-portrait-peg__rivet -->
    </div>
    <div class="rfs-portrait-peg__name">…</div>
  </div>
  …
</div>
```
