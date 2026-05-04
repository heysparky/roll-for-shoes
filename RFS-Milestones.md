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
    - Whispered Roll Widget posts to each called player (skill dropdown, Roll button)
    - Player rolls → widget crystallises to "Roll sent" → challenge card row updates
    - All-sixes → whispered Advancement Widget (type skill name inline, Enter or Claim)
    - Failed with non-sixes → whispered XP Spend Widget (shows cost, one Spend button)
    - XP spend → widget crystallises → Advancement Widget posts
    - Advancement claimed → widget crystallises → challenge card row shows new skill name
    - All whisper cards crystallise in place when done — never deleted (queue stability)
    - Challenge auto-completes when all tokens have rolled; times out after 3 minutes

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
- Challenge flow end-to-end: GM calls roll, players roll via widget, results land on shared card, advancement and XP spend flow through whisper cards
- Opposed rolls, difficulty thresholds, status math

### Known Gaps
- Visual design is plain — all chat cards and sheets are functional but unstyled. CSS pass is the next priority.
- Advancement prompt text is the same for natural all-sixes and XP-purchased advancement. Needs distinct copy (TODO in code).
- Skill tree is a flat list on the sheet. Visual tree with connecting lines is planned but not started.

### Architecture Decisions Made This Session
- Whisper cards crystallise in place rather than being deleted (queue stability)
- Challenge state lives in settings, not in card HTML (single source of truth)
- Advancement happens via inline whisper widget, not a dialog or button on the shared challenge card
- Player roll widget is a whispered chat message, not a floating dialog — easy to pivot if this proves problematic at the table

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
