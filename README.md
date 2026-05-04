# Roll for Shoes — Foundry VTT System

A Foundry VTT v14 game system implementation of [Roll for Shoes](https://rollforshoes.com/) by Ben Wray.

Written by Claude.ai
Designed by Karen McMullan (heysparky)

Assets
- Game System Image by Linnaea Mallette (https://www.publicdomainpictures.net/en/view-image.php?image=390097&picture=tennis-shoes)
- Call for Roll [svg](https://thenounproject.com/icon/running-shoe-7236490/) by [MihiMiki](https://thenounproject.com/creator/berlianahadi3/)

## Features

- Dynamic skill trees that grow organically in play
- All-sixes advancement detection with child skill prompts
- XP tracker (earned on failure, spent for advancement re-rolls)
- Named status modifiers (positive & negative)
- NPC mode: **Fixed** (static difficulty) or **Full** (complete PC rules)
- Opposed rolls and difficulty thresholds
- **Theme system**: swap visual themes with one setting, no code changes
  - 🏭 Dark Factory (steampunk, default)
  - ☀️ Clean Light

## Installation

**Manual install** — paste this URL into Foundry's system browser:
```
https://raw.githubusercontent.com/YOUR_USERNAME/roll-for-shoes/main/system.json
```

## Development

This system lives in `{userData}/Data/systems/roll-for-shoes/`.
Clone directly into that directory for live-reload development.

```bash
cd path/to/foundry/userData/Data/systems
git clone https://github.com/YOUR_USERNAME/roll-for-shoes.git
```

### Architecture

```
roll-for-shoes/
├── system.json              Foundry v14 manifest
├── template.json            Type names only (schema is in JS)
├── roll-for-shoes.mjs       Entry point — init hook
├── src/
│   ├── data/actor-data.mjs  TypeDataModel — CharacterData, NpcData
│   ├── documents/actor.mjs  RfsActor — roll methods, skill mutations
│   ├── sheets/              ActorSheetV2 character and NPC sheets
│   ├── rolls/skill-roll.mjs Roll logic (Milestone 5+)
│   └── helpers/             Config constants, settings, Handlebars helpers
├── templates/               Handlebars templates and partials
├── styles/
│   ├── rfs-base.css         All CSS custom properties — no hardcoded values
│   └── themes/              One file per theme, overrides variables only
└── lang/en.json             All UI strings
```

### Adding a Theme

1. Create `styles/themes/my-theme.css`
2. Add `[data-rfs-theme="my-theme"] { --rfs-color-bg: ...; }` with your overrides
3. Add `"my-theme": "RFS.Theme.MyTheme"` to `RFS.themes` in `src/helpers/config.mjs`
4. Add the CSS path to `system.json` `"styles"` array
5. Add `"RFS.Theme.MyTheme": "My Theme Name"` to `lang/en.json`

### Build Milestones

| # | Milestone | Status |
|---|---|---|
| 1 | Skeleton — loads in Foundry, no errors | ✅ |
| 2 | Data model verified in console | 🔲 |
| 3 | Sheet renders with Do Anything + XP | 🔲 |
| 4 | Sheet writes — inputs persist | 🔲 |
| 5 | Skill rolls to chat | 🔲 |
| 6 | All-sixes advancement flow | 🔲 |
| 7 | XP on failure + spend | 🔲 |
| 8 | Opposed rolls & difficulty thresholds | 🔲 |
| 9 | Status add/edit/remove | 🔲 |
| 10 | Visual skill tree with CSS tree lines + animations | 🔲 |

## License

The Unlicense
