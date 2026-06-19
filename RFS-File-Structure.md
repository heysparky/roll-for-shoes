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
│   ├── ui/
│   │   ├── roll-splash.mjs        ← RollSplash singleton; full-screen cinematic overlay;
│   │   │                            show(kind) — "success" / "critical" / "fail"; auto-hides
│   │   │                            after dwell; broadcast to other clients via splashShow socket
│   │   └── roll-verdict-dialog.mjs← RfsVerdictDialog (ApplicationV2 shell) +
│   │                                 renderVerdict() closure engine; allsixes / fail / success
│   │                                 outcomes; in-place XP-spend → claim transition;
│   │                                 xpCost (nonSixCount) passed in from roll site
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
│       │                            submitOnChange; exports sortSkillsForDisplay(skills) and
│       │                            mergeSkillFormData(submitted, existing) — shared by NPC sheet
│       └── npc-sheet.mjs          ← imports sortSkillsForDisplay + mergeSkillFormData;
│                                    fixed (difficulty + description) or full (skill tree + XP +
│                                    statuses) mode; full mode uses skill-index.hbs with editMode=isEditable
├── styles/
│   ├── rfs-base.css               ← layout, structure, custom property definitions on :root;
│   │                                sheet, skill index, DC tracker, buttons, biography,
│   │                                statuses (.rfs-status), inventory (.rfs-inventory__*)
│   ├── rfs-chat.css               ← advancement announcement card (.rfs-advancement)
│   ├── rfs-splash.css             ← full-screen roll splash overlay (.rfs-splash)
│   ├── rfs-verdict.css            ← verdict dialog (.rfs-verdict); scoped under .rfs-verdict
│   │                                to beat Foundry's global element resets
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
        └── roll-verdict-dialog.hbs← shell template; mounts .rfs-verdict__body div that
                                     renderVerdict() takes over after _onRender
```

*(The skill map popup was removed — `skill-map-dialog.mjs`, `skill-node.hbs`, `skill-tree.hbs`, and `skill-map-dialog.hbs` no longer exist. Revert commit `41f27d8` to restore them.)*
*(The old fire-and-forget roll result popup was removed — `src/dialogs/roll-result-dialog.mjs` and `templates/dialog/roll-result-dialog.hbs` no longer exist. Replaced by `RfsVerdictDialog`.)*

---

## Chat Card Types

| type | visibility | description |
|------|------------|-------------|
| `advancement` | public | Announcement posted when any skill is gained (natural all-sixes or XP spend). Built by `buildAdvancementCardContent()`. Static — no buttons. |
| `opposed roll` | public | Posted by `RfsSkillRoll.opposed()`. Shows both actors' dice, totals, winner. Contains `rfsClaimAdvancement` buttons if either actor rolled all-sixes. |

All standalone roll results surface via `RfsVerdictDialog` (not chat). Chat only receives advancement announcements and opposed roll cards.

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
        → _resolveDifficulty()      reads options.difficulty ?? globalDc
        → DSN showForRoll or AudioHelper.play
        → actor.addXp(1) on failure
        → actor.addRollHistory()
        → RollSplash.show(kind) + socket splashShow broadcast
        → RfsVerdictDialog.open() if allSixes or canSpendXp; else done
             onClaim(name, xpWasSpent):
               actor.spendXp(nonSixCount) if xpWasSpent
               actor.addSkill(name, skill.id)
               ChatMessage.create(buildAdvancementCardContent(...))
  └── claimAdvancement()             opposed roll all-sixes path
        → DialogV2.input for skill name
        → actor.addSkill → posts advancement announcement
  └── opposed()
        → evaluates both rolls, posts chat card, awards XP to loser

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

## Verdict Dialog (.rfs-verdict)

Standalone rolls show `RfsVerdictDialog` (not a chat card). Opened fire-and-forget by `RfsSkillRoll.roll()`.

The ApplicationV2 shell renders `roll-verdict-dialog.hbs`, which contains an empty `.rfs-verdict__body` div. `renderVerdict()` takes that div as `mount` and owns it entirely via `innerHTML` replacement — Foundry's template system is not involved after the initial render.

```
mount (.rfs-verdict__body)
  ├── .rfs-verdict__evidence   — pip dice row
  ├── h2.rfs-verdict__word     — "All sixes." / "Failed." / "Success."
  ├── span.rfs-verdict__badge  — reward/outcome label
  └── .rfs-verdict__acts       — action stack
        [allsixes / post-spend]  input[data-ref="skillName"] + button[data-ref="claim"]
        [fail]                   button[data-ref="takeXp"] + button[data-ref="spend"]
        [success]                button[data-ref="close"]
```

Key: `data-ref` attributes are wired by `renderVerdict()` directly — not via `renderChatMessageHTML` or Foundry actions.

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
