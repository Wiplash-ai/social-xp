<p align="center">
  <img src="assets/brand-mark.png" alt="Social-XP logo" width="132" />
</p>

<h1 align="center">Social-XP</h1>

<p align="center">
  Track your posting cadence across social platforms with goals, streaks, XP, and level progression.
</p>

Social-XP is a Manifest V3 browser extension for tracking how many social actions you publish across:

- X / Twitter
- LinkedIn
- Threads
- Discord
- Reddit
- Facebook
- Bluesky

It stores each tracked action as an event, rolls those events into daily, weekly, monthly, and yearly progress, and turns the totals into XP:

- New post: `20 XP`
- Reply or comment: `8 XP`
- Daily clear bonus: `+25 XP`
- Weekly clear bonus: `+150 XP`
- Monthly clear bonus: `+700 XP`
- Yearly clear bonus: `+3600 XP`
- Streak bonus: `+5 / +10 / +15 / +20 XP` at 3 / 7 / 14 / 30 day streaks
- Overgoal bonus: `+10 / +15 / +25 XP` at 125% / 150% / 200% of the daily XP target

Default targets are set to:

- Daily: `3 posts`, `6 replies`
- Weekly: `21 posts`, `42 replies`
- Monthly: `90 posts`, `180 replies`
- Yearly: `1095 posts`, `2190 replies`

## What it includes

- DOM-based tracking content script for supported sites
- Dashboard page with a black-and-gold XP bar
- Compact on-page widget overlay that you can toggle from the extension icon
- Options page for editing daily, weekly, monthly, and yearly goals
- Local storage for events and goals
- Per-site breakdown for today's activity

## Load it in Chrome / Edge

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select this folder: `/home/jculver/Documents/programming/personal/javascript/social-xp`

Once loaded:

- Click the Social-XP toolbar icon on a supported social tab to show or hide the compact widget overlay.
- Use the widget's Dashboard button and Goals view settings link to navigate the full pages.
- If you click the icon on an unsupported page, Social-XP falls back to the dashboard tab.

## Build and load it in Firefox

1. Run `npm run build:firefox`.
2. Open `about:debugging`.
3. Choose `This Firefox`.
4. Click `Load Temporary Add-on`.
5. Select `/home/jculver/Documents/programming/personal/javascript/social-xp/dist/firefox/manifest.json`.

The Firefox build keeps the same UI and tracking logic, but swaps the Chrome service worker manifest entry for Firefox background scripts and adds Gecko signing metadata.

## Notes

- Tracking is DOM-based and heuristic-driven. Social sites change UI labels and composer structures often, so some selectors may need updates over time.
- The extension uses `chrome.storage.local`; there is no backend.
- Discord tracking is focused on message sends and reply composer state.

## Contributors

Social-XP is open to community contributions.

If you want to help:

- Open an issue before larger feature work or broad refactors.
- Keep site-tracking changes scoped and test the specific network you touched.
- Run `npm test` for the XP/reward logic, test changes in Chrome, and, if relevant, run `npm run build:firefox`.
- Update the README when XP rules, supported sites, or setup steps change.

Areas that are especially useful:

- DOM selector maintenance when social platforms change their composer UI
- Cross-browser testing and Firefox validation
- Dashboard and widget polish
- Tracking accuracy for replies, comments, and edge-case posting flows

If you submit a PR, include a short note on what changed, which sites you tested, and any known gaps.

## License

MIT. See [LICENSE](LICENSE).
