# Roll for Shoes — Milestones

## Completed

1. **Skeleton** — System loads in Foundry, no console errors, actor type selectable
2. **Data model** — Actor has skills[], xp, statuses[] — visible in actor.system in console
3. **Sheet renders** — Character sheet opens, shows name + "Do Anything 1" + XP
4. **Sheet writes** — XP field edits persist, skill names editable
5. **Skill rolls to chat**
6. **All-sixes advancement flow**
7. **XP on failure + spend**
8. **Opposed rolls & difficulty thresholds**
9. **Statuses** — add/edit/remove with math
10. **Challenge flow** — full popup-based redesign
    - GM shoe button → Challenge Dialog (prompt, DC mode, DC visibility toggle, token list)
    - Shared Challenge Card posts to public chat; portrait rows, one per token
    - GM posts → socket emits to called players → `RfsChallengePlayerDialog` popup auto-opens
    - Popup handles full player flow: skill pick → roll → XP spend | advancement → done (auto-close)
    - Pending player portraits on challenge card are buttons — reopen popup if closed early
    - Done player portraits are plain `<img>` — no button, no stale dialog
    - Roll results recorded via socket (player → GM) so world settings write is always GM-side
    - All-sixes in popup → advancement step (inline name input, Enter or Claim)
    - Failure with non-sixes → XP spend step (shows cost, one Spend button → advancement)
    - Advancement claimed via socket → GM updates settings + rebuilds challenge card row
    - Challenge auto-completes when all tokens have rolled; times out after 3 minutes
    - No per-player whisper cards — popup is the only player-side surface
    - New challenge auto-closes any stale popup from a different challenge
11. **Character sheet UX cleanup**
    - Click skill name to roll (no separate die button)
    - Pips only — no level number badge
    - Portrait uses `data-edit="img"` (Foundry native edit, not a custom button)
    - Large portrait; no add/remove skill buttons (progression via rolls)
12. **Theme system** — `dark-factory`, `clean-light`, `vellum` (default)
    - `vellum.css` wired: dark academia, oxblood + gold, EB Garamond / Cormorant display type
    - Class name contract reconciled between vellum.css selectors and actual markup

---

## Up Next

- **Visual QA** — reload with vellum active, check all surfaces against REGISTRATION.md checklist
- **CSS polish** — skill tree connecting lines, challenge card spacing and portrait sizing, popup layout
- **Advancement prompt copy** — distinct flavour text for natural all-sixes vs XP-purchased advancement

---

## Current State of Development

Core mechanics complete and table-tested. Challenge UX redesigned (popup-based). Theme system wired. CSS polish is the current priority.

### Working
- Character sheet: name, skills (click-to-roll, pip display), XP, statuses, large portrait with native edit
- Skill rolls from sheet: posts result card, XP on failure, all-sixes claim
- Challenge flow end-to-end: GM calls roll → popup auto-opens → player rolls → card updates → advancement/XP in popup
- Opposed rolls, difficulty thresholds, status math
- Three themes registered; vellum is default

### Known Gaps / Next Work
- **Vellum visual QA**: theme wired but not yet verified in-game across all surfaces
- **Skill tree layout**: currently a flat indented list. Vellum CSS assumes a horizontal bracket card tree (`rfs-skill-node__card`, `rfs-skill-node__children`). Our markup uses a simpler structure — vellum's tree-specific styles are currently orphans. Tree layout pass is needed.
- **Advancement prompt copy**: same text for natural all-sixes vs XP-purchased advancement. Needs distinct copy.
- **GM skill override**: no UI button for adding/removing skills; GM needs a workaround (console or future override tool).

### Architecture Decisions
- Challenge state lives in `game.settings` (world-scoped), never in card HTML — single source of truth
- Challenge card rebuilt from scratch on every update via `rebuildChallengeCard()` — no HTML patching
- All player-side challenge interaction lives in `RfsChallengePlayerDialog` (ApplicationV2 popup), not chat
- World-setting writes are GM-only; players delegate via socket (`recordChallengeRoll`, `claimAdvancement`)
- Popup tracked in `static Map<tokenId, dialog>` — duplicate opens bring existing dialog to front
- CSS selectors in theme files match our actual markup class names (search-replaced inside vellum.css, not in markup)

---

## Rules Reference (DC scale — confirmed correct)

| DC | Difficulty |
|----|------------|
| 4  | Easy — anyone could do this… probably |
| 8  | Medium — requires real effort or skill |
| 12 | Hard — a genuine bear |
| 18 | Legendary — who are these people? |
| 24 | Mythic — are they even human? |

- **Do Anything 1** is the starting skill for all characters
- Roll dice equal to skill level, sum and meet-or-beat the DC — ties go to the roller
- **All sixes** → new skill one level higher, specific to the action *(social enforcement only — not enforced in code)*
- **Fail** → gain 1 XP
- **Spend XP** → 1 XP per non-six die to turn ALL dice to 6 — advancement only, never boosts the sum

---

Repo: [github.com/heysparky/roll-for-shoes](https://github.com/heysparky/roll-for-shoes)
