<p align="center">
  <img src="assets/brand-mark.png" alt="Social-XP logo" width="132" />
</p>

<h1 align="center">Social-XP</h1>

<p align="center">
  Gamified browser extension for tracking social posts and replies with goals, streaks, XP, and a live on-page widget.
</p>

<p align="center">
  Manifest V3 • Chrome / Edge • Firefox build included
</p>

Social-XP tracks your publishing activity across major social platforms and turns it into a progression system. It watches for new posts and replies in supported social UIs, keeps a compact widget on the page you are currently using, and gives you a dashboard for trends, goals, and level progression.

## Supported Platforms

- X / Twitter
- LinkedIn
- Threads
- Discord
- Reddit
- Facebook
- Bluesky

## Highlights

- Compact on-page widget you can toggle from the extension icon
- Full dashboard for XP flow, activity mix, streaks, and level progress
- Goals page for daily, weekly, monthly, and yearly targets
- Gamified XP system with goal bonuses, streak bonuses, and overgoal rewards
- DOM-based tracking for posts and replies/comments
- Local-only storage with no backend dependency
- Firefox build output in `dist/firefox`

## XP System

| Action | Reward |
| --- | ---: |
| New post | `20 XP` |
| Reply or comment | `8 XP` |
| Daily goal clear | `+25 XP` |
| Weekly goal clear | `+150 XP` |
| Monthly goal clear | `+700 XP` |
| Yearly goal clear | `+3600 XP` |

Bonus systems:

- Streak bonus: `+5 / +10 / +15 / +20 XP` at 3 / 7 / 14 / 30 active days
- Overgoal bonus: `+10 / +15 / +25 XP` at 125% / 150% / 200% of the daily XP target
- Harder goals can slightly increase future goal-clear bonuses

## Default Targets

| Cadence | Posts | Replies |
| --- | ---: | ---: |
| Daily | `3` | `6` |
| Weekly | `21` | `42` |
| Monthly | `90` | `180` |
| Yearly | `1095` | `2190` |

## Quick Start

### Chrome / Edge

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select the repository folder.

Once loaded:

- Click the Social-XP toolbar icon on a supported social tab to show or hide the compact widget overlay.
- Use the widget's dashboard button and goals view settings button to open the full pages.
- If you click the icon on an unsupported page, Social-XP falls back to the dashboard tab.

### Firefox

1. Build the Firefox package:

```bash
npm run build:firefox
```

2. Open `about:debugging`.
3. Choose `This Firefox`.
4. Click `Load Temporary Add-on`.
5. Select `dist/firefox/manifest.json`.

## Development

Install and validate locally with:

```bash
npm test
npm run build:firefox
```

Project layout:

- `content/`: in-page widget and DOM tracking
- `dashboard/`: analytics and XP dashboard
- `options/`: goal management and XP guide
- `background.js`: storage, XP economy, rewards, and level progression
- `tests/`: Node unit tests for reward and leveling logic

## Notes

- Tracking is heuristic-driven and based on DOM structure, so social site UI changes may require selector updates.
- The extension uses `chrome.storage.local`; there is no backend.
- Discord tracking focuses on message sends and reply composer state.
- Firefox uses a generated build in `dist/firefox` that swaps the background manifest format.

## Contributing

Social-XP is open to community contributions.

If you want to help:

- Open an issue before larger feature work or broad refactors.
- Keep site-tracking changes scoped and test the specific network you touched.
- Run `npm test`, test changes in Chrome, and, if relevant, run `npm run build:firefox`.
- Update the README when XP rules, supported sites, or setup steps change.

High-value contribution areas:

- DOM selector maintenance when social platforms change their composer UI
- Cross-browser testing and Firefox validation
- Dashboard and widget polish
- Tracking accuracy for replies, comments, and edge-case publishing flows

If you submit a PR, include:

- what changed
- which sites you tested
- any known gaps or follow-up work

## License

MIT. See [LICENSE](LICENSE).
