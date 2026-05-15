# Roll for Shoes — Milestones

## Completed

1. **Skeleton** — System loads in Foundry, no console errors, actor type selectable
2. **Data model** — Actor has skills[], xp, statuses[], biography — visible in actor.system in console
3. **Sheet renders** — Character sheet opens, shows name + "Do Anything 1" + XP
4. **Sheet writes** — XP field edits persist, skill names editable inline
5. **Skill rolls** — standalone rolls show a themed `RfsRollResultDialog` popup (not chat); results recorded to actor roll-history flag (max 50)
6. **All-sixes advancement flow**
7. **XP on failure + spend**
8. **Opposed rolls & difficulty thresholds**
9. **Statuses** — add/edit/remove with math
10. **DC Tracker + Player-Initiated Roll UX**
    - Persistent DC tracker bar (`RfsDcTracker`) renders for all users at ready; GM adjusts global DC via named tier chips (Easy/Medium/Hard/Legendary/Mythic) or +/− buttons; players see DC read-only with connected character portraits on each side
    - All rolls fire against `globalDc` — no per-challenge DC, no GM-gated initiation required
    - `RfsRollResultDialog` popup (fire-and-forget) shows after every roll; displays dice, outcome vs DC, and optional Claim Skill / Spend XP buttons inline
    - Challenge dialog, token HUD shoe button, shared challenge card, and `activeChallenge` state machine removed
    - Socket reduced to one type: `advancementNeeded` (player → GM when `advancementNamer === "gm"`)
11. **Advancement announcement card** — `.rfs-advancement` card posts to public chat on any skill gain; shows actor name, new skill name, and "From {parent}" (level/XP-cost detail removed)
12. **DC Tracker — tier chips and step buttons**
    - `difficultyMode` world setting: Standard (default 3, canonicals 3/6/9…24) or More XP (default 4, canonicals 4/8/12…24)
    - Tier chip buttons highlight the active DC value; +/− step buttons nudge by 1
    - GM changes take effect immediately for all connected clients via the `onChange` callback
13. **Character sheet UX**
    - Two tabs: Skills (default) and Roll History; tab strip visually styled as raised tabs
    - Click skill name to roll (pips-only display, no level number)
    - Portrait: click-to-edit via FilePicker (`editPortrait` action); vellum shows pencil overlay on hover
    - XP: editable number input (auto-saves on blur)
    - Biography textarea (auto-saves on blur)
    - Rename skill: pencil button opens a DialogV2 rename prompt (root skill excluded)
    - `originalIndex` tracking so display sort order cannot corrupt the stored skill array
    - Roll History tab: last 50 rolls from actor flag, plain list with time / skill / dice / total / outcome
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
18. **Standalone roll popup** — `RfsRollResultDialog` fire-and-forget popup replaces chat cards; DSN called explicitly before popup opens; popup shows dice, outcome strip, optional Claim Skill / Spend XP buttons; result recorded to actor roll-history flag

---

## Up Next

- **CSS polish** — DC tracker bar layout, roll result popup, advancement announcement card
- **Advancement prompt copy** — distinct flavour text for natural all-sixes vs XP-purchased advancement on the announcement card

---

## Current State of Development

Core mechanics, roll UX, and advancement flow are complete and table-tested. Players roll directly from their character sheet against the global DC set by the GM via the DC tracker bar — no challenge dialog or card required. CSS polish is the remaining priority.

### Working
- Character sheet: name, portrait (click to edit), skills (list), XP, statuses, biography, rename skill dialog, roll history tab
- Skill rolls: fire-and-forget `RfsRollResultDialog` popup with dice + outcome vs DC; DSN + dice sound; result recorded to actor flag
- DC tracker bar: visible to all users; GM adjusts globalDc via tier chips or +/− buttons
- Advancement UX: themed dialogs, two-step XP spend (confirm → name), advancementNamer respected on all paths
- Opposed rolls, difficulty thresholds, status math
- Three themes registered; vellum is default

### Known Gaps / Next Work
- **Advancement prompt copy**: same announcement card text for natural all-sixes vs XP-purchased advancement. Needs distinct flavour copy.
- **CSS polish**: DC tracker bar, roll result popup, and announcement card styling.

### Architecture Decisions
- Global DC lives in `game.settings.get("roll-for-shoes", "globalDc")` — world-scoped, GM-only writes
- All rolls read globalDc via `_resolveDifficulty()` — no per-challenge state, no passive token detection
- Roll results show in a fire-and-forget popup; chat only receives advancement announcement cards
- World-setting writes are GM-only; players delegate via socket (only `advancementNeeded`)
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
