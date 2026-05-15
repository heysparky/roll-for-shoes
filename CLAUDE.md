# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Non-Negotiables

- If a Foundry API pattern isn't in the reference files, search before writing — not after
- If a call can't be verified, flag it explicitly rather than guessing
- Always write a descriptive commit message

## Project Overview

Roll for Shoes is a **Foundry VTT v14 game system** — a pure JavaScript/Handlebars/CSS project with no build step, no package.json, and no external dependencies. Files are loaded directly by Foundry. There are no compile, test, or lint commands.

To develop, copy/symlink the repo into your Foundry `Data/systems/roll-for-shoes/` folder and reload Foundry in the browser.

## Architecture

### Entry Point

`roll-for-shoes.mjs` wires together all Foundry hooks:
- `init`: registers sheets, settings, document classes
- `ready`: renders the DC tracker bar; socket listener (`system.roll-for-shoes`) — handles `advancementNeeded` only
- `preCreateActor`: sets prototype token linking
- `renderChatMessageHTML`: **all** interactive chat card button wiring

### Source Layout

```
src/
├── apps/dc-tracker.mjs               RfsDcTracker — persistent DC bar rendered for all users;
│                                       GM adjusts globalDc via tier chips or +/− buttons;
│                                       players see DC read-only with connected portraits
├── data/actor-data.mjs               TypeDataModel schemas (CharacterData, NpcData)
├── documents/actor.mjs               RfsActor — skill helpers, addXp, addRollHistory
├── dialogs/
│   └── roll-result-dialog.mjs        Fire-and-forget popup for roll results;
│                                       Claim Skill / Spend XP buttons inline
├── sheets/character-sheet.mjs        ActorSheetV2 with skill list, XP, statuses, roll history
├── sheets/npc-sheet.mjs              NPC sheet (fixed or full mode)
├── rolls/skill-roll.mjs              Core roll logic — reads globalDc; all roll types;
│                                       themed advancement dialogs
└── helpers/
    ├── config.mjs              RFS constants, DC tiers, themes, NPC modes
    ├── settings.mjs            Foundry settings registration + buildAdvancementCardContent
    └── templates.mjs           Template preloading, Handlebars helpers
```

### Critical Patterns

**DC Tracker**: The persistent bar (`RfsDcTracker`) is rendered for all users on `ready`. The GM adjusts the global DC via named tier chips or +/− step buttons. Players see it read-only with connected character portraits on each side. DC is stored in `game.settings.get("roll-for-shoes", "globalDc")` (world-scoped, GM-only writes). `_resolveDifficulty()` reads this value unless `options.difficulty` is passed explicitly.

**Roll Result Popup**: All rolls show a `RfsRollResultDialog` fire-and-forget popup. No chat card is posted until an advancement or XP-spend action completes. The popup handles Claim Skill and Spend XP inline. Results are always recorded to the actor's roll history flag (max 50).

**Advancement announcement card**: Posted to public chat whenever a skill is gained. Built by `buildAdvancementCardContent()` in `settings.mjs`. Static — no interactive elements.

**Button Wiring via `renderChatMessageHTML`**: Every interactive chat card button uses a `[data-action]` attribute and is wired in the `renderChatMessageHTML` hook. Active actions: `rfsOpenSheet`, `rfsClaimAdvancement`, `rfsSpendXp`. Roll result popup actions (`claimSkill`, `spendXp`) live in `RfsRollResultDialog.DEFAULT_OPTIONS.actions` — not here.

**Foundry v14 Sheet Pattern**: Sheets use `HandlebarsApplicationMixin(ActorSheetV2)` with `DEFAULT_OPTIONS`, `PARTS`, `_prepareContext()`, and `submitOnChange: true` for auto-save.

### Core Rules (see `src/helpers/config.mjs`)

- Root skill: "Do Anything 1" (immutable)
- Roll: dice count = skill level; meet-or-beat DC (ties go to roller)
- All sixes → player names a new child skill at level +1
- Failure → earn 1 XP; spend XP (1 per non-six die) to force advancement without a full-six roll
- DC scale: Easy 4 / Medium 8 / Hard 12 / Legendary 18 / Mythic 24

### Theme System

Add a theme by: creating `styles/themes/<name>.css` → adding a CSS custom property overrides file → registering in `config.mjs` → adding lang key in `lang/en.json` → listing in `system.json`.

All CSS values use custom properties from `styles/rfs-base.css` — no hardcoded colours or sizes.

## Key Files for Context

- **`RFS-Architecture.md`** — Design decisions, roll flow, advancement dialogs, button wiring rationale
- **`RFS-File-Structure.md`** — Full directory map, chat card types, key relationships
- **`RFS-Milestones.md`** — Progress tracking, current dev state, rules reference

## Current Development State

Core mechanics, roll UX, and advancement flow are complete and table-tested. Remaining work:
1. CSS/visual polish — DC tracker bar, roll result popup, advancement announcement card
2. Advancement prompt text branching — natural all-sixes vs. XP-purchased flavour text

**Socket pattern** (important): world-scoped settings can only be written by GMs. The only socket message type is `advancementNeeded` (player → GM when `advancementNamer === "gm"`). `"socket": true` must be in `system.json` and requires a full world reload (not just browser refresh) to take effect.
