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
    - Promise queue serialises concurrent `recordChallengeRoll` calls to prevent race conditions
    - GM rolling on behalf of a player bypasses socket and writes directly
    - All-sixes → blingy advancement announcement card posted to public chat
    - Failure with non-sixes + enough XP → themed XP spend confirm + naming dialog
    - Advancement naming respects `advancementNamer` on all paths (challenge + standalone)
    - Challenge auto-completes when all tokens have rolled; times out after 3 minutes
    - Portrait buttons on the challenge card open the character sheet (`rfsOpenSheet`)
11. **Advancement announcement card** — `.rfs-advancement` card posts to public chat on any skill gain (natural or XP-purchased), with actor name, new skill name, level, parent, and XP cost if applicable
12. **GM Challenge Dialog — DC stepper**
    - Spinner (2–24) with − / + buttons; canonical quick-jump buttons highlight the active value
    - `difficultyMode` world setting: Standard (default 3, canonicals 3/6/9…24) or More XP (default 4, canonicals 4/8/12…24)
    - Dice picker: 1d6 = static DC (default), 2–4d6 = roll on Post; DSN shows the dice roll + sound plays
    - Static DC: dice sound plays when the card posts
13. **Character sheet UX**
    - Click skill name to roll (pips-only display, no level number)
    - Portrait: click-to-edit via FilePicker (`editPortrait` action); vellum shows pencil overlay on hover
    - XP: editable number input (auto-saves on blur)
    - Biography textarea (auto-saves on blur)
    - Rename skill: pencil button opens a DialogV2 rename prompt (root skill excluded)
    - `originalIndex` tracking so display sort order cannot corrupt the stored skill array
14. **Theme system** — `dark-factory`, `clean-light`, `vellum` (default)
    - `vellum.css`: dark academia, oxblood + gold, EB Garamond / Cormorant display type
15. **Skill list** — compact flat skill list (`skill-index.hbs`): pips + clickable name, depth-indented by CSS `--rfs-skill-depth` custom property
    - *(The ⤢ horizontal bracket tree popup, `RfsSkillMapDialog`, was removed — revert commit `41f27d8` to restore it)*
16. **Dice So Nice + dice sounds** — DSN (`game.dice3d.showForRoll`) is called explicitly for ALL roll paths (challenge + standalone); fallback to `foundry.audio.AudioHelper.play` when DSN is absent, so dice sound always plays
17. **Themed advancement dialogs**
    - Three distinct themed popups using `.rfs-adv-dlg`:
      - Yellow/XP: "Spend N XP on a new skill?" (confirm) → "Name your new skill" (name input)
      - Gold/earn: "You earned a skill!" (natural all-sixes, player-namer path)
      - Accent/GM: "{Actor} earned a skill!" or "{Actor} is buying a new skill" (GM-namer path)
    - `advancementNamer` setting now respected on ALL paths:
      - Challenge XP spend (namer=gm, non-GM): card records pending, then GM gets naming dialog via socket
      - Standalone XP spend (namer=gm, non-GM): card shows "waiting for GM…", GM names, card crystallises
      - Standalone all-sixes (namer=gm, non-GM): routes to GM via socket; GM names; original card updates
    - `advancementNeeded` socket handler covers both challenge and standalone roll paths
18. **Standalone roll cards** — `ChatMessage.create()` (not `roll.toMessage()`) with speaker alias `"ActorName · SkillName (Nd6)"` in the Foundry message header; card content shows dice, result strip, and action button — no custom header div inside the card

---

## Up Next

- **CSS polish** — standalone card result strip, advancement announcement card, any remaining visual gaps
- **Advancement prompt copy** — distinct flavour text for natural all-sixes vs XP-purchased advancement on the announcement card

---

## Current State of Development

Core mechanics complete and table-tested. Challenge flow uses sheet-based rolls — no player popup. Advancement UX is fully routed through `advancementNamer`. Theme system wired. Character sheet fully editable. CSS polish is the remaining priority.

### Working
- Character sheet: name (editable), portrait (click to edit), skills (list), XP (editable), statuses, biography, rename skill dialog
- Skill rolls from sheet: speaker alias shows actor + skill, XP on failure, all-sixes claim, DSN + dice sound
- Challenge flow end-to-end: GM calls roll → challenge card posts → non-GMs auto-switch to chat → players roll from sheet → card updates → advancement announced in chat
- Advancement UX: themed dialogs, two-step XP spend (confirm → name), advancementNamer respected on all paths
- Opposed rolls, difficulty thresholds, status math
- Three themes registered; vellum is default

### Known Gaps / Next Work
- **Advancement prompt copy**: same announcement card text for natural all-sixes vs XP-purchased advancement. Needs distinct flavour copy.
- **CSS polish**: some chat card and announcement card styling could be tightened.

### Architecture Decisions
- Challenge state lives in `game.settings` (world-scoped), never in card HTML — single source of truth
- Challenge card rebuilt from scratch on every update via `rebuildChallengeCard()` — no HTML patching
- Players roll from their character sheet; `_resolveDifficulty` auto-routes to the active challenge
- World-setting writes are GM-only; players delegate via socket (`recordChallengeRoll`, `claimAdvancement`, `advancementNeeded`)
- Standalone roll cards use `ChatMessage.create()` with no `rolls` array; DSN called explicitly; speaker alias carries the skill context
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
