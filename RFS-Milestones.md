# Roll for Shoes — Milestones

## Completed

1. **Skeleton** — System loads in Foundry, no console errors, actor type selectable
2. **Data model** — Actor has skills[], xp, statuses[], biography — visible in actor.system in console
3. **Sheet renders** — Character sheet opens, shows name + "Do Anything 1" + XP
4. **Sheet writes** — XP field edits persist, skill names editable inline
5. **Skill rolls to chat**
6. **All-sixes advancement flow**
7. **XP on failure + spend**
8. **Opposed rolls & difficulty thresholds**
9. **Statuses** — add/edit/remove with math
10. **Challenge flow — sheet-based roll architecture**
    - GM shoe button (or Q keybinding) → Challenge Dialog (DC stepper, dice picker, token list)
    - Shared Challenge Card posts to public chat; portrait rows live-update as players roll
    - Non-GM clients auto-switch to the chat sidebar when the challenge card is posted
    - Players roll from their character sheet — `_resolveDifficulty` auto-detects called tokens
    - Roll results recorded via socket (player → GM) so world settings writes are always GM-side
    - All-sixes → blingy advancement announcement card posted to public chat
    - Failure with non-sixes + enough XP → XP spend dialog (DialogV2); advancement on confirm
    - Advancement naming setting: player or GM (default GM); each path posts announcement card
    - Challenge auto-completes when all tokens have rolled; times out after 3 minutes
    - Portrait buttons on the challenge card open the character sheet (`rfsOpenSheet`)
11. **Advancement announcement card** — `.rfs-advancement` card posts to public chat on any skill gain (natural or XP-purchased), with actor name, new skill name, level, parent, and XP cost if applicable
12. **GM Challenge Dialog — DC stepper**
    - Spinner (2–24) with − / + buttons; canonical quick-jump buttons highlight the active value
    - `difficultyMode` world setting: Standard (default 3, canonicals 3/6/9…24) or More XP (default 4, canonicals 4/8/12…24)
    - Dice picker: 1d6 = static DC (default), 2–4d6 = roll on Post
    - Advancement namer: world setting for whether the player or GM names new skills
13. **Character sheet UX**
    - Click skill name to roll (or use the ▶ roll button in edit mode)
    - Pips only — no level number badge
    - Portrait: click-to-edit via FilePicker (`editPortrait` action); vellum shows pencil overlay on hover
    - XP: editable number input (auto-saves on blur)
    - Biography textarea (auto-saves on blur)
    - Skill name inputs in edit mode (auto-save on blur); root skill is read-only
    - `originalIndex` tracking so display sort order cannot corrupt the stored skill array
14. **Theme system** — `dark-factory`, `clean-light`, `vellum` (default)
    - `vellum.css`: dark academia, oxblood + gold, EB Garamond / Cormorant display type
15. **Skill list on sheet + ⤢ popup tree**
    - Compact flat skill list (`skill-index.hbs`): pips + clickable name, depth-indented
    - `⤢` button opens `RfsSkillMapDialog` — full horizontal bracket tree, resizable popup
16. **Dice So Nice** — challenge rolls call `game.dice3d.showForRoll()` explicitly (standalone rolls fire DSN via `roll.toMessage()`)

---

## Up Next

- **CSS polish** — advancement announcement card, any remaining chat card gaps
- **Advancement prompt copy** — distinct flavour text for natural all-sixes vs XP-purchased advancement
- **Skill map nits** — minor visual polish on the ⤢ popup bracket tree (deferred)

---

## Current State of Development

Core mechanics complete and table-tested. Challenge flow uses sheet-based rolls — no player popup. Theme system wired. Character sheet fully editable. CSS polish is the remaining priority.

### Working
- Character sheet: name (editable), portrait (click to edit), skills (list + tree), XP (editable), statuses, biography
- ⤢ popup: full bracket skill tree in `RfsSkillMapDialog` (singleton per actor, resizable)
- Skill rolls from sheet: posts result card, XP on failure, all-sixes claim, DSN 3D dice
- Challenge flow end-to-end: GM calls roll → challenge card posts → non-GMs auto-switch to chat → players roll from sheet → card updates → advancement announced in chat
- Opposed rolls, difficulty thresholds, status math
- Three themes registered; vellum is default

### Known Gaps / Next Work
- **Advancement prompt copy**: same text for natural all-sixes vs XP-purchased advancement. Needs distinct copy.
- **Skill map nits**: minor bracket tree visual issues noted, deferred.
- **No-DSN dice sounds on challenge rolls**: challenge rolls play Dice So Nice if installed. Without DSN, there is no dice sound (standalone rolls handle this via `roll.toMessage()`). Low priority since most tables use DSN.

### Architecture Decisions
- Challenge state lives in `game.settings` (world-scoped), never in card HTML — single source of truth
- Challenge card rebuilt from scratch on every update via `rebuildChallengeCard()` — no HTML patching
- Players roll from their character sheet; `_resolveDifficulty` auto-routes to the active challenge
- World-setting writes are GM-only; players delegate via socket (`recordChallengeRoll`, `claimAdvancement`, `advancementNeeded`)
- CSS selectors in theme files match actual markup class names; scoped to `[data-rfs-theme="vellum"]`

---

## Rules Reference (DC scale — confirmed correct)

| DC | Difficulty |
|----|------------|
| 3  | Easy (standard) / 4 (More XP mode) |
| 8  | Medium |
| 12 | Hard |
| 18 | Legendary |
| 24 | Mythic |

- **Do Anything 1** is the starting skill for all characters
- Roll dice equal to skill level, sum and meet-or-beat the DC — ties go to the roller
- **All sixes** → new skill one level higher, specific to the action *(social enforcement only — not enforced in code)*
- **Fail** → gain 1 XP
- **Spend XP** → 1 XP per non-six die to turn ALL dice to 6 — advancement only, never boosts the sum

---

Repo: [github.com/heysparky/roll-for-shoes](https://github.com/heysparky/roll-for-shoes)
