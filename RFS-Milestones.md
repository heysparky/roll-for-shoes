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
    - Persistent DC tracker bar (`RfsDcTracker`) renders for all users at ready; GM adjusts global DC via named tier chips or +/− buttons; players see DC read-only with connected character portraits on each side
    - All rolls fire against `globalDc` — no per-challenge DC, no GM-gated initiation required
    - `RfsRollResultDialog` popup (fire-and-forget) shows after every roll; displays dice, outcome vs DC, and optional Claim Skill / Spend XP buttons inline
    - Challenge dialog, token HUD shoe button, shared challenge card, and `activeChallenge` state machine removed
    - Socket reduced to one type: `advancementNeeded` (player → GM when `advancementNamer === "gm"`)
11. **Advancement announcement card** — `.rfs-advancement` card posts to public chat on any skill gain; shows actor name, new skill name, and "From {parent}" (level/XP-cost detail removed)
12. **DC Tracker — tier chips and step buttons**
    - `difficultyMode` world setting: Standard (default DC 3) or More XP (default DC 4)
    - Tier chip buttons highlight the active DC value; +/− step buttons nudge by 1
    - GM changes take effect immediately for all connected clients via the `onChange` callback
13. **Character sheet UX**
    - Four tabs: Skills / Inventory / Statuses / History
    - Click skill name to roll (pips-only display, no level number)
    - Portrait: click-to-edit via FilePicker (`editPortrait` action); vellum shows pencil overlay on hover
    - XP: editable number input (auto-saves on blur)
    - Biography textarea (auto-saves on blur)
    - Rename skill: pencil button opens a DialogV2 rename prompt (root skill excluded)
    - `originalIndex` tracking so display sort order cannot corrupt the stored skill array
    - Roll History tab: last 50 rolls from actor flag, plain list with time / skill / dice / total / outcome
14. **Theme system** — `dark-factory`, `clean-light`, `vellum` (default)
    - `vellum.css`: dark academia, oxblood + gold, Cormorant Garamond / IBM Plex Mono
15. **Skill list** — compact flat skill list (`skill-index.hbs`): pips + clickable name, depth-indented by CSS `--rfs-skill-depth` custom property
    - *(The ⤢ horizontal bracket tree popup, `RfsSkillMapDialog`, was removed — revert commit `41f27d8` to restore it)*
16. **Dice So Nice + dice sounds** — DSN (`game.dice3d.showForRoll`) is called explicitly for ALL roll paths; fallback to `foundry.audio.AudioHelper.play` when DSN is absent
17. **Themed advancement dialogs**
    - Three distinct themed popups using `.rfs-adv-dlg`
    - `advancementNamer` setting respected on all paths (player-namer, GM-namer, socket routing)
18. **Standalone roll popup** — `RfsRollResultDialog` fire-and-forget popup; DSN called explicitly before popup opens; result recorded to actor roll-history flag
19. **Inventory tab** — character sheet now has four tabs: Skills / Inventory / Statuses / History
20. **Vellum theme — character sheet visual design**
    - Connected parchment tab nav (mono uppercase, active tab gold hairline, panel seam dissolves)
    - Quill history cards (2-row grid, italic serif skill heading, circular outcome medallion, allsixes inner glow)
    - Illuminated hedera empty state (❦ pseudo-element above, thin gold rule below)
    - D6 die-face pip glyphs (canonical 1–6 pip positions via nth-child; rank 7+ shows numeral via attr(data-rank))
    - Codex folio header (display:contents flattens DOM into 2×2 portrait/name/XP/bio grid; portrait 168×216)
21. **DC tracker — Foundry chrome reset** — strips ApplicationV2 background/border/padding via `!important` in `rfs-base.css`
22. **Token name sync** — changing actor name updates prototypeToken.name and all linked scene tokens; gated by world setting `syncTokenName` (default on)
23. **Character sheet header polish** — biography textarea fills remaining header space (`height: 264px` definite grid container; `align-self: stretch` on bio)
24. **Skill list button polish** — rename/delete buttons shrunk to 1rem, borderless, hidden until row hover; rename glows gold, delete glows red
25. **Tab focus ring removed** — browser `:focus-visible` outline suppressed on tab buttons; gold hairline indicator remains
26. **DC tier rebalance — Elite added**
    - New tier between Hard and Legendary: Easy / Medium / Hard / **Elite** / Legendary / Mythic
    - Standard DCs: 3 / 6 / 9 / 12 / 15 / 18
    - More XP DCs: 4 / 8 / 12 / 16 / 20 / 24
27. **XP display polish**
    - Number input spinners hidden (were squeezing the text area inside the fixed-width box)
    - Width switched to `3ch` (exact monospace character units) so the box fits double-digit XP
    - Vertically centred with the character name in the header row
    - Bottom padding added in base CSS to prevent descender clipping
    - Vellum theme: `line-height: 1.3` on the 32px Cormorant Garamond input so old-style numeral tails (3, 4, 5, 7, 9) are not cut off

---

## Up Next

- **Advancement prompt copy** — distinct flavour text for natural all-sixes vs XP-purchased advancement
- **CSS polish** — roll result popup, advancement announcement card

---

## Current State of Development

Core mechanics, roll UX, advancement flow, and the vellum character sheet visual design are complete and table-tested. Character sheet and XP display polish is done; remaining work is advancement flavour text and chat card styling.

### Working
- Character sheet: name, portrait (click to edit), skills, XP, statuses, biography, rename skill, roll history — all four tabs styled in vellum theme
- Header: 2×2 codex folio grid; biography fills remaining space below name/XP row; XP number vertically centred with name, descenders visible
- Skill list: pips + clickable name; rename/delete buttons appear on row hover only
- Tab nav: active tab gold hairline indicator; no browser focus ring
- Skill rolls: fire-and-forget `RfsRollResultDialog` popup with dice + outcome vs DC; DSN + dice sound; result recorded to actor flag
- DC tracker bar: visible to all users; GM adjusts globalDc via six tier chips (Easy/Medium/Hard/Elite/Legendary/Mythic) or +/− buttons; free-floating on canvas (chrome stripped)
- Advancement UX: themed dialogs, two-step XP spend (confirm → name), advancementNamer respected on all paths
- Opposed rolls, difficulty thresholds, status math
- Three themes registered; vellum is default
- Token name syncs to prototype token and placed scene tokens on rename

### Known Gaps / Next Work
- **Advancement prompt copy**: same announcement card text for natural all-sixes vs XP-purchased advancement. Needs distinct flavour copy.
- **CSS polish**: roll result popup and advancement announcement card styling.

### Architecture Decisions
- Global DC lives in `game.settings.get("roll-for-shoes", "globalDc")` — world-scoped, GM-only writes
- All rolls read globalDc via `_resolveDifficulty()` — no per-challenge state, no passive token detection
- Roll results show in a fire-and-forget popup; chat only receives advancement announcement cards
- World-setting writes are GM-only; players delegate via socket (only `advancementNeeded`)
- CSS selectors in theme files match actual markup class names; scoped to `[data-rfs-theme="vellum"]`

---

## Rules Reference

### Standard difficulty mode (default)

| Difficulty | DC |
|------------|----|
| Easy       | 3  |
| Medium     | 6  |
| Hard       | 9  |
| Elite      | 12 |
| Legendary  | 15 |
| Mythic     | 18 |

### More XP difficulty mode

| Difficulty | DC |
|------------|----|
| Easy       | 4  |
| Medium     | 8  |
| Hard       | 12 |
| Elite      | 16 |
| Legendary  | 20 |
| Mythic     | 24 |

More XP mode steps on 4s — players fail more often and earn more XP.

### Core rules

- **Do Anything 1** is the starting skill for all characters
- Roll dice equal to skill level, sum and meet-or-beat the DC — ties go to the roller
- **All sixes** → new skill one level higher, specific to the action *(social enforcement only — not enforced in code)*
- **Fail** → gain 1 XP
- **Spend XP** → 1 XP per non-six die to turn ALL dice to 6 — advancement only, never boosts the sum

---

Repo: [github.com/heysparky/roll-for-shoes](https://github.com/heysparky/roll-for-shoes)
