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
10. **Challenge flow** — full redesign (see RFS-Architecture.md for full detail)
    - GM shoe button → Challenge Dialog (prompt, DC mode, DC visibility toggle, token list)
    - Shared Challenge Card posts to public chat; live-updating table, one row per token
    - GM posts → socket emits to called players → `RfsChallengePlayerDialog` popup auto-opens
    - Popup handles full player flow: skill pick → roll → XP spend | advancement → done
    - Player name cells on challenge card are buttons — re-open popup if closed early
    - Roll results recorded via socket (player → GM) so world settings write is always GM-side
    - All-sixes in popup → advancement step (inline name input, Enter or Claim)
    - Failure with non-sixes → XP spend step (shows cost, one Spend button → advancement)
    - Advancement claimed via socket → GM updates settings + rebuilds challenge card row
    - Challenge auto-completes when all tokens have rolled; times out after 3 minutes
    - No per-player whisper cards — popup is the only player-side surface

---

## Up Next

- **Visual polish** — CSS for chat cards, challenge card table, widget states
- **Visual skill tree** — CSS tree lines + animations
- **Advancement prompt copy** — natural all-sixes vs XP-purchased flavour text
  *(TODO comment in `RfsSkillRoll._postAdvancementWidget` marks the fork point)*

---

## Current State of Development

The core rules loop is complete and tested at the table. All mechanical systems are working.

### Working
- Character sheet: name, skills (editable, tree structure), XP, statuses
- Skill rolls from sheet: posts result card, XP on failure, all-sixes claim
- Challenge flow end-to-end: GM calls roll, players roll via popup dialog, results land on shared card, advancement and XP spend handled in popup
- Opposed rolls, difficulty thresholds, status math

### Known Gaps
- Visual design is plain — all chat cards and sheets are functional but unstyled. CSS pass is the next priority.
- Advancement prompt text is the same for natural all-sixes and XP-purchased advancement. Needs distinct copy.
- Skill tree is a flat list on the sheet. Visual tree with connecting lines is planned but not started.

### Architecture Decisions
- Challenge state lives in `game.settings` (world-scoped), never in card HTML — single source of truth
- Challenge card is rebuilt from scratch on every update via `rebuildChallengeCard()` — no HTML patching
- All player-side challenge interaction lives in `RfsChallengePlayerDialog` (ApplicationV2 popup), not chat cards
- World-setting writes are GM-only; player clients delegate via socket events (`recordChallengeRoll`, `claimAdvancement`)
- Popup is tracked in a static `Map<tokenId, dialog>` — duplicate opens bring the existing dialog to front
- All Unicode symbols in JS/HBS source use HTML entities (&#x2726; etc.) — prevents Edit tool match failures

---

## Rules Reference (DC variant — confirmed correct)

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
