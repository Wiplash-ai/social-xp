# Social-XP Public Release Plan

Updated: 2026-07-31

## Product Position

- Social-XP is a private, local-only social posting habit tracker.
- It detects posts and replies on supported social sites, awards XP, tracks streaks, and compares progress with goals set by the user.
- V1 has no account, backend, remote analytics, advertising, or activity synchronization.
- Product page: `https://labs.wiplash.ai/social-xp/`
- Publisher: Wiplash Labs / Wiplash.ai

## Supported Sites

- X / Twitter
- LinkedIn
- Threads
- Discord
- Reddit
- Facebook
- Bluesky

## Public-Build Privacy Boundary

- Store only activity counters and settings in `chrome.storage.local`.
- Do not transmit post text, URLs, browsing history, credentials, or activity events.
- Do not request localhost or Wiphand access.
- Do not include API endpoints or API-key settings.
- Keep host access limited to the supported sites where DOM-based tracking runs.

## Browser Packages

- Chrome Web Store: Manifest V3 Chromium package.
- Microsoft Edge Add-ons: reuse the reviewed Chromium package.
- Opera Add-ons: reuse the Chromium package after Opera-specific validation.
- Firefox Add-ons: generated Manifest V3 package with a stable Gecko ID and `data_collection_permissions.required: ["none"]`.
- Safari is deferred because it adds a native Xcode wrapper, Apple developer signing, and separate review overhead without improving V1.

## Store Assets

- 1280 x 800 screenshots showing the live widget in independent mock environments for X, LinkedIn, Threads, Discord, Reddit, Facebook, and Bluesky.
- Dashboard and goals screenshots showing XP, streaks, trends, and local controls.
- Chrome small promo tile: 440 x 280.
- Chrome marquee tile: 1400 x 560.
- 128 x 128 store icon with transparent padding already included in the extension package.
- Product explainer video will be added after the footer and product page are approved.

## Recording Fixtures

- The independent mini-page sources live in `store-assets/fixtures/`.
- Each fixture uses local network marks and the Jojo/Kyrt profile art, so recordings are deterministic and do not expose a real social account.
- Run `npm run demo:stores -- x` to open the X fixture with the real unpacked extension and populated widget.
- Replace `x` with `linkedin`, `threads`, `discord`, `reddit`, `facebook`, or `bluesky` to record another supported destination.
- Close the launched Chromium window to stop the demo session.

## Store Review Narrative

- Single purpose: help users build a consistent social posting and engagement habit.
- `storage`: saves goals, theme, counters, XP, and streak history locally.
- Site access: detects user-initiated posts and replies and renders the optional Social-XP widget on supported social sites.
- No remote code, no remote data transmission, no sale or sharing of data.
- Tracking is heuristic and may need selector updates when supported sites change their UI.

## Release Checklist

- [x] Remove Wiphand UI, API credentials, sync code, and localhost permissions.
- [x] Add Wiplash.ai attribution to the dashboard, goals page, and live widget.
- [x] Set public 1.0.0 manifest metadata and Labs homepage.
- [x] Validate Chrome, Edge, Opera, and Firefox packages.
- [x] Capture X, LinkedIn, Threads, Discord, Reddit, Facebook, Bluesky, dashboard, and goals screenshots.
- [x] Review `labs.wiplash.ai/social-xp/` in dev.
- [ ] Add final explainer video.
- [ ] Submit Chrome, Edge, Firefox, and Opera listings.

## Submission Order

1. Chrome Web Store: establishes the primary Chromium listing and support links.
2. Microsoft Edge Add-ons: reuse package and listing assets.
3. Firefox Add-ons: upload generated package and reviewer instructions.
4. Opera Add-ons: submit the Chromium package after the Chrome review is stable.

Brave and Vivaldi users can install the Chrome Web Store build, so they do not require separate packages or store submissions.

## Official Store References

- Chrome listing fields and assets: <https://developer.chrome.com/docs/webstore/cws-dashboard-listing>
- Chrome image sizes: <https://developer.chrome.com/docs/webstore/images/>
- Edge publishing workflow: <https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension>
- Firefox add-on policies: <https://extensionworkshop.com/documentation/publish/add-on-policies/>
- Firefox submission workflow: <https://extensionworkshop.com/documentation/publish/submitting-an-add-on/>

## Post-Launch Checks

- Test tracking against supported sites after major UI changes.
- Review store crash/rejection reports and permission warnings.
- Refresh screenshots when the dashboard or widget changes materially.
- Add the explainer video to all stores that accept a video URL.
