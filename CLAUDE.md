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
- `ready`: socket listener (`system.roll-for-shoes`) — handles `openChallengeDialog`, `recordChallengeRoll`, `claimAdvancement`
- `preCreateActor`: sets prototype token linking
- `renderChatMessageHTML`: **all** interactive chat card button wiring

### Source Layout

```
src/
├── data/actor-data.mjs               TypeDataModel schemas (CharacterData, NpcData)
├── documents/actor.mjs               RfsActor — skill helpers, addXp, getRollData
├── dialogs/
│   ├── challenge-dialog.mjs          GM challenge UI → posts challenge card, emits socket
│   └── challenge-player-dialog.mjs   Player popup — skill pick → roll → XP spend | advancement → done
├── sheets/character-sheet.mjs        ActorSheetV2 with skill tree, XP, statuses
├── sheets/npc-sheet.mjs              NPC sheet (fixed or full mode)
├── hud/token-hud.mjs                 Shoe button → opens challenge dialog
├── rolls/skill-roll.mjs              Core roll logic — all roll types; returns result object
└── helpers/
    ├── config.mjs              RFS constants, DC scale, themes, NPC modes
    ├── settings.mjs            Foundry settings + activeChallenge state machine
    └── templates.mjs           Template preloading, Handlebars helpers
```

### Critical Patterns

**Card Lifecycle — never delete, always crystallise**: Chat cards are never deleted. To "complete" a card, update its content to a quiet confirmation, disable inputs, and set a flag (e.g., `rolled: true`). On re-render, the flag check keeps it disabled. This keeps the chat queue stable.

**Challenge State Machine**: The single source of truth for an active challenge is `game.settings.get("roll-for-shoes", "activeChallenge")`. The challenge card is always rebuilt from scratch via `rebuildChallengeCard(challenge)` — never read state from HTML or use regex on message content.

**Button Wiring via `renderChatMessageHTML`**: Every interactive button uses a `[data-action]` attribute and is wired in the `renderChatMessageHTML` hook. Active actions: `rfsOpenChallengeDialog` (opens player popup), `rfsClaimAdvancement` (standalone roll), `rfsSpendXp` (standalone roll). Challenge player actions (`rfsDialogRoll`, `rfsDialogSpendXp`, `rfsDialogClaim`, `rfsDialogDismiss`) live in `RfsChallengePlayerDialog.DEFAULT_OPTIONS.actions`.

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

- **`RFS-Architecture.md`** — Design decisions, challenge flow, card lifecycle rules, button wiring rationale
- **`RFS-File-Structure.md`** — Full directory map, chat card types, key relationships  
- **`RFS-Milestones.md`** — Progress tracking, current dev state, rules reference

## Current Development State

Core mechanics and challenge UX are complete and table-tested. Remaining work:
1. CSS/visual polish — chat cards, challenge card table, player popup, sheets
2. Visual skill tree — CSS tree lines and animations on the character sheet
3. Advancement prompt text branching — natural all-sixes vs. XP-purchased flavour text

**Socket pattern** (important): world-scoped settings can only be written by GMs. Player clients must emit socket events and let the GM-side listener call `game.settings.set()`. The three socket message types are `openChallengeDialog` (GM → players), `recordChallengeRoll` (player → GM), `claimAdvancement` (player → GM). `"socket": true` must be in `system.json` and requires a full world reload (not just browser refresh) to take effect.
