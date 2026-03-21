"use strict";

(() => {
  if (window.top !== window) {
    return;
  }

  const CLICKABLE_SELECTOR = 'button, [role="button"], div[role="button"], span[role="button"]';
  const COMPOSER_SELECTOR = [
    "textarea",
    'input[type="text"]',
    'input:not([type])',
    '[contenteditable="true"]',
    '[contenteditable="plaintext-only"]',
    'div[role="textbox"]'
  ].join(", ");
  const STORAGE_KEYS = Object.freeze({
    events: "socialXpEvents",
    goals: "socialXpGoals",
    widgetPositions: "socialXpWidgetPositions"
  });

  const SITE_CONFIGS = [
    {
      id: "x",
      label: "X",
      hosts: ["x.com", "twitter.com"],
      postKeywords: ["post", "tweet"],
      replyKeywords: ["reply"],
      replyContextPatterns: ["reply", "replying", "post your reply"]
    },
    {
      id: "linkedin",
      label: "LinkedIn",
      hosts: ["linkedin.com"],
      postKeywords: ["post"],
      replyKeywords: ["comment", "reply"],
      replyContextPatterns: ["comment", "reply"]
    },
    {
      id: "threads",
      label: "Threads",
      hosts: ["threads.net"],
      postKeywords: ["post"],
      replyKeywords: ["reply"],
      replyContextPatterns: ["reply"]
    },
    {
      id: "discord",
      label: "Discord",
      hosts: ["discord.com", "discordapp.com"],
      postKeywords: ["send"],
      replyKeywords: ["reply"],
      replyContextPatterns: ["replying to", "reply"],
      enableEnterTracking: true
    },
    {
      id: "reddit",
      label: "Reddit",
      hosts: ["reddit.com"],
      postKeywords: ["post"],
      replyKeywords: ["comment", "reply"],
      replyContextPatterns: ["comment", "reply"]
    },
    {
      id: "facebook",
      label: "Facebook",
      hosts: ["facebook.com"],
      postKeywords: ["post"],
      replyKeywords: ["comment", "reply"],
      replyContextPatterns: ["comment", "reply"]
    },
    {
      id: "bluesky",
      label: "Bluesky",
      hosts: ["bsky.app"],
      postKeywords: ["post"],
      replyKeywords: ["reply"],
      replyContextPatterns: ["reply"]
    }
  ];
  const DISCORD_FAILURE_PATTERNS = [
    "slowmode is enabled",
    "you are sending messages too quickly",
    "wait to send another message",
    "wait a few seconds before trying again",
    "must wait",
    "message failed to send",
    "could not be delivered",
    "this message failed to send",
    "one message per"
  ];

  const activeSite = getActiveSite();
  const queuedFingerprints = new Map();
  let toastRoot = null;
  let focusPanelHost = null;
  let focusPanelRoot = null;
  let widgetVisible = false;
  let widgetMode = "summary";
  let widgetTransition = "";
  let widgetRefreshHoldUntil = 0;
  let widgetLevelHighlight = false;
  let widgetLevelHighlightTimer = 0;
  let widgetPosition = null;
  let widgetPositionLoaded = false;
  let widgetDragState = null;

  if (!activeSite) {
    return;
  }

  init();

  function init() {
    document.addEventListener("click", handleClick, true);
    document.addEventListener("submit", handleSubmit, true);
    window.addEventListener("resize", handleWindowResize);

    if (activeSite.enableEnterTracking) {
      document.addEventListener("keydown", handleKeydown, true);
    }

    chrome.runtime.onMessage.addListener(handleRuntimeMessage);
    chrome.storage.onChanged.addListener(handleStorageChange);
  }

  function handleClick(event) {
    const actionElement = event.target instanceof Element ? event.target.closest(CLICKABLE_SELECTOR) : null;

    if (!actionElement) {
      return;
    }

    const intent = createIntentFromAction(actionElement, "click");

    if (!intent) {
      return;
    }

    confirmAndTrack(intent);
  }

  function handleSubmit(event) {
    const form = event.target instanceof Element ? event.target : null;

    if (!form) {
      return;
    }

    const submitter = event.submitter instanceof Element ? event.submitter : null;
    const intent = createIntentFromForm(form, submitter, "submit");

    if (!intent) {
      return;
    }

    confirmAndTrack(intent);
  }

  function handleKeydown(event) {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    ) {
      return;
    }

    const composer = event.target instanceof Element ? event.target.closest(COMPOSER_SELECTOR) : null;

    if (!composer || !isVisible(composer) || isSearchLike(composer)) {
      return;
    }

    const scopes = collectScopes(composer);
    const content = extractComposerContent(composer);

    if (!hasMeaningfulContent(content)) {
      return;
    }

    const activityType = hasReplyContext(scopes) ? "reply" : "post";

    confirmAndTrack({
      actionElement: composer,
      composer,
      scopes,
      content,
      activityType,
      trigger: "enter"
    });
  }

  function handleStorageChange(changes, areaName) {
    if (areaName !== "local") {
      return;
    }

    if (widgetVisible && (changes[STORAGE_KEYS.events] || changes[STORAGE_KEYS.goals])) {
      if (Date.now() < widgetRefreshHoldUntil) {
        return;
      }

      refreshFocusPanel();
    }
  }

  function handleWindowResize() {
    if (!widgetVisible || !widgetPosition || !focusPanelHost) {
      return;
    }

    widgetPosition = clampWidgetPosition(widgetPosition);
    applyWidgetPosition();
  }

  function handleRuntimeMessage(message, sender, sendResponse) {
    if (!message || typeof message !== "object") {
      return false;
    }

    if (message.type === "TOGGLE_WIDGET") {
      toggleWidget()
        .then(sendResponse)
        .catch((error) => {
          sendResponse({
            ok: false,
            error: error && error.message ? error.message : "Unable to toggle widget"
          });
        });

      return true;
    }

    return false;
  }

  function createIntentFromAction(actionElement, trigger) {
    const scopes = collectScopes(actionElement);
    const label = getActionLabel(actionElement);
    const activityType = detectActivityType(label, scopes);

    if (!activityType) {
      return null;
    }

    const composer = findBestComposer(scopes);
    const content = extractComposerContent(composer);

    if (!hasMeaningfulContent(content)) {
      return null;
    }

    return {
      actionElement,
      composer,
      scopes,
      content,
      activityType,
      trigger
    };
  }

  function createIntentFromForm(form, submitter, trigger) {
    const scopes = collectScopes(form);
    const composer = findBestComposer(scopes);
    const content = extractComposerContent(composer);

    if (!hasMeaningfulContent(content)) {
      return null;
    }

    const label = getActionLabel(submitter || form);
    const activityType = detectActivityType(label, scopes) || (hasReplyContext(scopes) ? "reply" : null);

    if (!activityType) {
      return null;
    }

    return {
      actionElement: submitter || form,
      composer,
      scopes,
      content,
      activityType,
      trigger
    };
  }

  async function confirmAndTrack(intent) {
    const fingerprint = buildFingerprint(intent);

    if (!fingerprint || isWithinCooldown(fingerprint)) {
      return;
    }

    queuedFingerprints.set(fingerprint, Date.now());
    pruneQueuedFingerprints();

    const confirmed = await waitForSubmissionSignal(intent);

    if (!confirmed) {
      queuedFingerprints.delete(fingerprint);
      return;
    }

    sendMessage({
      type: "LOG_ACTIVITY",
      payload: {
        site: activeSite.id,
        siteLabel: activeSite.label,
        activityType: intent.activityType,
        fingerprint,
        source: intent.trigger
      }
    })
      .then((response) => {
        if (!response || !response.ok || response.duplicate) {
          return;
        }

        if (widgetVisible && response.dashboard) {
          widgetRefreshHoldUntil = Date.now() + (response.levelUp ? 2800 : 900);
        }

        if (response.levelUp) {
          if (widgetVisible) {
            highlightWidgetLevel();

            if (response.dashboard) {
              renderFocusPanel(response.dashboard);
            }

            launchWidgetLevelUp(response.levelUp);
          } else {
            showLevelUpToast(response.levelUp);
          }
        } else if (widgetVisible && response.dashboard) {
          renderFocusPanel(response.dashboard);
        }

        if (response.settings && response.settings.toastEnabled === false) {
          return;
        }

        showToast(response.event, response.dashboard);
      })
      .catch(() => {
        return undefined;
      });
  }

  function waitForSubmissionSignal(intent) {
    const strictConfirmation = activeSite.id === "discord";
    const maxWaitMs = strictConfirmation ? 5000 : intent.trigger === "enter" ? 1800 : 2200;
    const firstDelayMs = intent.trigger === "enter" ? 220 : 480;
    const startedAt = Date.now();
    const initialDiscordMessageCount = strictConfirmation ? countDiscordMessageNodes() : 0;

    return new Promise((resolve) => {
      window.setTimeout(check, firstDelayMs);

      function check() {
        if (strictConfirmation) {
          const failure = getDiscordSubmissionFailureText(intent);

          if (failure) {
            resolve(false);
            return;
          }
        }

        const scopeDetached = intent.scopes.some((scope) => scope !== document.body && !document.contains(scope));
        const composerDetached = intent.composer && !document.contains(intent.composer);
        const nextContent = intent.composer && document.contains(intent.composer)
          ? extractComposerContent(intent.composer)
          : "";
        const contentCleared = nextContent.length === 0;
        const contentShrank =
          intent.content.length > 0 && nextContent.length <= Math.floor(intent.content.length * 0.2);
        const discordMessagePublished = strictConfirmation && hasDiscordPublishedMessage(intent, initialDiscordMessageCount);

        if (scopeDetached || composerDetached || contentCleared || contentShrank || discordMessagePublished) {
          resolve(true);
          return;
        }

        if (Date.now() - startedAt >= maxWaitMs) {
          resolve(!strictConfirmation && (intent.trigger === "submit" || intent.trigger === "enter"));
          return;
        }

        window.setTimeout(check, strictConfirmation ? 180 : 250);
      }
    });
  }

  function countDiscordMessageNodes() {
    return document.querySelectorAll("[data-list-item-id^='chat-messages'], [id^='chat-messages-']").length;
  }

  function hasDiscordPublishedMessage(intent, initialCount) {
    const selectors = "[data-list-item-id^='chat-messages'], [id^='chat-messages-']";
    const nodes = [...document.querySelectorAll(selectors)];

    if (nodes.length <= initialCount) {
      return false;
    }

    const needle = normalizeText(intent.content).slice(0, 160);

    if (!needle) {
      return nodes.length > initialCount;
    }

    return nodes.slice(Math.max(nodes.length - 6, 0)).some((node) => {
      return normalizeText(node.textContent).includes(needle);
    });
  }

  function getDiscordSubmissionFailureText(intent) {
    const candidates = [
      ...intent.scopes.slice(0, 4),
      ...document.querySelectorAll("[role='alert'], [aria-live='assertive'], [aria-live='polite']")
    ];

    for (const candidate of candidates) {
      if (!(candidate instanceof Element)) {
        continue;
      }

      const text = normalizeText(candidate.textContent || "");

      if (text && containsAny(text, DISCORD_FAILURE_PATTERNS)) {
        return text;
      }
    }

    return "";
  }

  function detectActivityType(label, scopes) {
    const normalizedLabel = normalizeText(label);

    if (!normalizedLabel) {
      return null;
    }

    if (containsAny(normalizedLabel, activeSite.replyKeywords)) {
      return "reply";
    }

    if (containsAny(normalizedLabel, activeSite.postKeywords)) {
      return hasReplyContext(scopes) ? "reply" : "post";
    }

    return null;
  }

  function hasReplyContext(scopes) {
    return scopes
      .filter((scope) => scope !== document.body)
      .slice(0, 4)
      .some((scope) => {
        const contextText = normalizeText([
          scope.getAttribute && scope.getAttribute("aria-label"),
          scope.getAttribute && scope.getAttribute("data-testid"),
          scope.querySelector && scope.querySelector("h1, h2, h3, [role='heading']")
            ? scope.querySelector("h1, h2, h3, [role='heading']").textContent
            : "",
          scope.textContent ? scope.textContent.slice(0, 220) : ""
        ].join(" "));

        return containsAny(contextText, activeSite.replyContextPatterns);
      });
  }

  function findBestComposer(scopes) {
    for (const scope of scopes) {
      const composers = [...scope.querySelectorAll(COMPOSER_SELECTOR)]
        .filter((element) => isVisible(element))
        .filter((element) => !isSearchLike(element))
        .sort((left, right) => extractComposerContent(right).length - extractComposerContent(left).length);

      if (composers.length > 0) {
        return composers[0];
      }
    }

    return null;
  }

  function collectScopes(anchor) {
    const scopes = [
      anchor.closest("form"),
      anchor.closest("[role='dialog']"),
      anchor.closest("[aria-modal='true']"),
      anchor.closest("[data-testid*='dialog']"),
      anchor.closest("section"),
      anchor.closest("article"),
      document.body
    ];

    return [...new Set(scopes.filter(Boolean))];
  }

  function getActionLabel(element) {
    if (!element) {
      return "";
    }

    const parts = [
      element.getAttribute && element.getAttribute("aria-label"),
      element.getAttribute && element.getAttribute("title"),
      element.getAttribute && element.getAttribute("data-testid"),
      element.textContent
    ];

    return parts
      .filter(Boolean)
      .join(" ")
      .trim();
  }

  function extractComposerContent(element) {
    if (!element) {
      return "";
    }

    if (typeof element.value === "string") {
      return normalizeWhitespace(element.value);
    }

    return normalizeWhitespace(element.innerText || element.textContent || "");
  }

  function buildFingerprint(intent) {
    const content = normalizeText(intent.content).slice(0, 120);
    return `${activeSite.id}:${intent.activityType}:${content}`;
  }

  function isWithinCooldown(fingerprint) {
    const timestamp = queuedFingerprints.get(fingerprint);

    if (!timestamp) {
      return false;
    }

    return Date.now() - timestamp < 8000;
  }

  function pruneQueuedFingerprints() {
    const now = Date.now();

    queuedFingerprints.forEach((timestamp, key) => {
      if (now - timestamp > 12000) {
        queuedFingerprints.delete(key);
      }
    });
  }

  function ensureFocusPanel() {
    if (focusPanelRoot) {
      return;
    }

    const host = document.createElement("div");
    host.id = "socialxp-focus-root";
    host.style.position = "fixed";
    host.style.top = "18px";
    host.style.right = "18px";
    host.style.zIndex = "2147483646";
    host.style.pointerEvents = "auto";
    document.documentElement.appendChild(host);

    focusPanelHost = host;
    focusPanelRoot = host.attachShadow({ mode: "open" });
  }

  async function refreshFocusPanel() {
    if (!widgetVisible) {
      return { ok: true, visible: false };
    }

    ensureFocusPanel();

    try {
      const response = await sendMessage({ type: "GET_DASHBOARD_DATA" });

      if (!response || !response.ok) {
        throw new Error(response && response.error ? response.error : "Unable to load Social-XP");
      }

      renderFocusPanel(response.dashboard);
      return { ok: true, visible: true };
    } catch (error) {
      renderFocusPanelError(error);
      return {
        ok: false,
        visible: true,
        error: error && error.message ? error.message : "Unable to load Social-XP"
      };
    }
  }

  function renderFocusPanel(dashboard) {
    ensureFocusPanel();

    const daily = dashboard.periods.daily;
    const currentSite = dashboard.siteBreakdown.find((site) => site.site === activeSite.id) || {
      siteLabel: activeSite.label,
      posts: 0,
      replies: 0,
      xp: 0
    };
    const xpGoalLabel = daily.goal.xp > 0 ? `${daily.xp} / ${daily.goal.xp} XP` : `${daily.xp} XP today`;
    const remainingLabel = daily.remaining.post === 0 && daily.remaining.reply === 0
      ? "Daily goal clear"
      : `${daily.remaining.post} posts • ${daily.remaining.reply} replies left`;
    const modeStageClass = widgetTransition ? `mode-stage is-transition ${widgetTransition}` : "mode-stage";
    const levelChipClass = widgetLevelHighlight ? "chip is-level-glow" : "chip";
    const periodRows = ["daily", "weekly", "monthly", "yearly"]
      .map((period) => {
        const summary = dashboard.periods[period];
        const periodLabel = capitalize(period);
        return `
          <div class="goal-row">
            <div class="goal-top">
              <span>${getInlineIcon("target")} ${periodLabel}</span>
              <strong>${summary.xp} / ${summary.goal.xp} XP</strong>
            </div>
            <div class="goal-rail">
              <div class="goal-fill" style="width: ${summary.progress.xp > 0 ? Math.round(summary.progress.xp * 100) : 0}%"></div>
            </div>
            <small>${summary.posts}/${summary.goal.post} posts • ${summary.replies}/${summary.goal.reply} replies</small>
          </div>
        `;
      })
      .join("");

    focusPanelRoot.innerHTML = `
      <style>
        :host {
          all: initial;
        }

        * {
          box-sizing: border-box;
        }

        .shell {
          position: relative;
          width: 286px;
          color: #fff1cf;
          font: 13px/1.45 "Trebuchet MS", "Gill Sans", sans-serif;
        }

        .panel {
          position: relative;
          overflow: hidden;
          border-radius: 24px;
          border: 1px solid rgba(255, 214, 107, 0.22);
          background:
            radial-gradient(circle at top right, rgba(255, 219, 121, 0.14), transparent 34%),
            linear-gradient(180deg, rgba(20, 20, 20, 0.98), rgba(8, 8, 8, 0.98));
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.42);
          backdrop-filter: blur(14px);
        }

        .panel {
          padding: 14px;
        }

        .header,
        .hero,
        .footer,
        .goal-top,
        .icon-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }

        .header {
          cursor: grab;
          touch-action: none;
        }

        .header.is-dragging {
          cursor: grabbing;
        }

        .eyebrow {
          margin: 0 0 2px;
          color: #d5aa44;
          font-size: 10px;
          letter-spacing: 0.18em;
          text-transform: uppercase;
        }

        .site-title,
        .hero-title,
        .hero-sub,
        .chip-label,
        .chip strong,
        .summary-card strong,
        .summary-card p,
        .goal-top span,
        .goal-top strong {
          margin: 0;
        }

        .site-title {
          font-size: 18px;
          font-weight: 700;
        }

        .subtitle {
          margin: 4px 0 0;
          color: rgba(255, 241, 207, 0.74);
        }

        .brand-line,
        .summary-label,
        .goal-top span {
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }

        .header-actions {
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }

        .inline-icon,
        .icon-button svg,
        .action-button svg,
        .footer-button svg,
        .link-button svg {
          flex: none;
        }

        .inline-icon {
          width: 14px;
          height: 14px;
          color: #d5aa44;
        }

        .brand-badge {
          width: 24px;
          height: 24px;
          object-fit: contain;
          flex: none;
          display: block;
          border-radius: 7px;
          filter: drop-shadow(0 4px 10px rgba(255, 208, 95, 0.18));
        }

        .icon-button,
        .action-button,
        .footer-button,
        .link-button {
          appearance: none;
          border-radius: 999px;
          font: inherit;
          cursor: pointer;
        }

        .icon-button,
        .action-button,
        .link-button {
          border: 1px solid rgba(255, 224, 141, 0.18);
          background: rgba(255, 255, 255, 0.05);
          color: #fff1cf;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
        }

        .icon-button {
          width: 38px;
          height: 38px;
          padding: 0;
        }

        .action-button,
        .link-button {
          padding: 8px 12px;
        }

        .action-button {
          font-size: 12px;
          font-weight: 700;
        }

        .hero {
          margin-top: 14px;
          align-items: flex-end;
        }

        .hero-title {
          font-size: 34px;
          font-weight: 700;
          line-height: 1;
        }

        .hero-sub {
          margin-top: 6px;
          color: rgba(255, 241, 207, 0.76);
        }

        .chip {
          min-width: 86px;
          padding: 10px 12px;
          border-radius: 18px;
          text-align: center;
          background: linear-gradient(160deg, rgba(255, 228, 144, 0.12), rgba(255, 188, 58, 0.04));
          border: 1px solid rgba(255, 228, 144, 0.18);
        }

        .chip.is-level-glow {
          border-color: rgba(255, 235, 163, 0.56);
          box-shadow:
            0 0 0 1px rgba(255, 224, 141, 0.14),
            0 0 22px rgba(255, 216, 112, 0.18),
            inset 0 0 24px rgba(255, 228, 144, 0.08);
          animation: level-chip-pulse 1600ms ease-in-out 2;
        }

        .chip-label {
          color: rgba(255, 233, 184, 0.72);
          font-size: 10px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
        }

        .chip strong {
          display: block;
          margin-top: 4px;
          font-size: 24px;
        }

        .chip-meta {
          display: block;
          margin-top: 4px;
          color: rgba(255, 233, 184, 0.68);
          font-size: 10px;
          line-height: 1.3;
        }

        .bar-label {
          margin-top: 14px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          color: rgba(255, 233, 184, 0.72);
          font-size: 11px;
        }

        .xp-bar,
        .progress-rail {
          overflow: hidden;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.08);
        }

        .xp-bar {
          height: 12px;
          margin-top: 8px;
        }

        .progress-rail {
          margin-top: 8px;
          height: 8px;
        }

        .xp-fill,
        .progress-fill {
          height: 100%;
          border-radius: inherit;
          background:
            linear-gradient(90deg, #8d6118, #d5aa44, #ffe291, #d5aa44);
          background-size: 220% 100%;
          animation: shimmer 2.6s linear infinite;
        }

        .summary-stack,
        .goal-stack {
          margin-top: 14px;
          display: grid;
          gap: 10px;
        }

        .metric-strip {
          margin-top: 10px;
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
        }

        .metric-pill {
          min-width: 0;
          padding: 8px 10px;
          border-radius: 14px;
          border: 1px solid rgba(255, 222, 132, 0.12);
          background: rgba(255, 255, 255, 0.03);
          color: rgba(255, 233, 184, 0.8);
          font-size: 11px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          text-align: center;
        }

        .mode-stage {
          transform-origin: top center;
        }

        .mode-stage.is-transition.to-goals {
          animation: mode-drop-down 260ms cubic-bezier(0.2, 0.9, 0.24, 1) both;
        }

        .mode-stage.is-transition.to-summary {
          animation: mode-drop-up 260ms cubic-bezier(0.2, 0.9, 0.24, 1) both;
        }

        .mode-stage.is-transition .summary-card,
        .mode-stage.is-transition .goal-row,
        .mode-stage.is-transition .link-row {
          animation: stage-item-settle 320ms cubic-bezier(0.18, 0.88, 0.24, 1) both;
        }

        .mode-stage.is-transition .summary-card:nth-child(2),
        .mode-stage.is-transition .goal-row:nth-child(2) {
          animation-delay: 24ms;
        }

        .mode-stage.is-transition .goal-row:nth-child(3) {
          animation-delay: 48ms;
        }

        .mode-stage.is-transition .goal-row:nth-child(4),
        .mode-stage.is-transition .link-row {
          animation-delay: 72ms;
        }

        .summary-card,
        .goal-row {
          padding: 12px;
          border-radius: 18px;
          border: 1px solid rgba(255, 222, 132, 0.12);
          background: rgba(255, 255, 255, 0.03);
        }

        .summary-label,
        .goal-row small {
          color: rgba(255, 233, 184, 0.72);
        }

        .summary-label {
          font-size: 11px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .summary-card strong {
          display: block;
          margin-top: 4px;
          font-size: 15px;
        }

        .summary-card p,
        .goal-row small {
          margin-top: 4px;
          color: rgba(255, 233, 184, 0.72);
        }

        .summary-card strong.icon-row {
          justify-content: flex-start;
          gap: 10px;
        }

        .goal-row {
          padding: 10px 12px;
        }

        .goal-top strong {
          font-size: 12px;
        }

        .goal-rail {
          margin-top: 8px;
          height: 8px;
          overflow: hidden;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.08);
        }

        .goal-fill {
          height: 100%;
          border-radius: inherit;
          background:
            linear-gradient(90deg, #8d6118, #d5aa44, #ffe291, #d5aa44);
          background-size: 220% 100%;
          animation: shimmer 2.6s linear infinite;
        }

        .footer {
          margin-top: 14px;
        }

        .footer-button {
          flex: 1;
          padding: 8px 12px;
          border: 1px solid rgba(255, 224, 141, 0.18);
          background: rgba(255, 255, 255, 0.04);
          color: #fff1cf;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
        }

        .footer-button.primary {
          border: 0;
          color: #221400;
          font-weight: 700;
          background: linear-gradient(90deg, #d5aa44, #ffe291);
        }

        .footnote {
          margin: 10px 2px 0;
          color: rgba(255, 233, 184, 0.68);
          font-size: 11px;
          line-height: 1.4;
        }

        .link-row {
          margin-top: 10px;
        }

        .link-button {
          width: 100%;
        }

        @keyframes shimmer {
          from { background-position: 0% 50%; }
          to { background-position: 220% 50%; }
        }

        @keyframes mode-drop-down {
          from {
            opacity: 0;
            transform: translateY(-16px);
          }

          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes mode-drop-up {
          from {
            opacity: 0;
            transform: translateY(16px);
          }

          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes stage-item-settle {
          from {
            opacity: 0;
            transform: translateY(-10px);
          }

          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes level-chip-pulse {
          0%,
          100% {
            transform: scale(1);
          }

          35% {
            transform: scale(1.05);
          }

          60% {
            transform: scale(1.02);
          }
        }

        @media (max-width: 900px) {
          .shell {
            width: min(92vw, 286px);
          }
        }
      </style>
      <div class="shell">
        <div class="panel">
          <div class="header">
            <div>
              <p class="eyebrow brand-line">${getBrandBadge()} Social-XP</p>
              <p class="site-title">${activeSite.label}</p>
            </div>
            <div class="header-actions">
              <button id="openDashboard" class="icon-button" type="button" aria-label="Open dashboard" title="Open the full dashboard">${getInlineIcon("dashboard")}</button>
              <button id="closeWidget" class="icon-button" type="button" aria-label="Close widget" title="Close this widget">${getInlineIcon("close")}</button>
            </div>
          </div>

          <div class="hero">
            <div>
              <p class="eyebrow">Today</p>
              <p class="hero-title">${daily.xp} XP</p>
              <p class="hero-sub">${xpGoalLabel}</p>
            </div>
            <div class="${levelChipClass}">
              <p class="chip-label">${getInlineIcon("level")} Level</p>
              <strong>${dashboard.level.level}</strong>
              <small class="chip-meta">${dashboard.level.remainingXp} XP to level ${dashboard.level.nextLevel}</small>
            </div>
          </div>

          <div class="bar-label">
            <span>${getInlineIcon("spark")} Daily target</span>
            <span>${xpGoalLabel}</span>
          </div>
          <div class="xp-bar">
            <div class="xp-fill" style="width: ${daily.progress.xp > 0 ? Math.round(daily.progress.xp * 100) : 0}%"></div>
          </div>

          <div class="metric-strip">
            <div class="metric-pill">${getInlineIcon("streak")} ${dashboard.streakDays}d streak</div>
            <div class="metric-pill">${getInlineIcon("level")} L${dashboard.level.level} • ${dashboard.level.remainingXp} XP left</div>
          </div>

          <div class="${modeStageClass}">
          ${widgetMode === "summary" ? `
            <div class="summary-stack">
              <div class="summary-card">
                <span class="summary-label">${getSiteIcon(activeSite.id)} ${escapeHtml(currentSite.siteLabel)} today</span>
                <strong class="icon-row">${getInlineIcon("spark")} ${currentSite.xp} XP</strong>
                <p>${currentSite.posts} posts • ${currentSite.replies} replies tracked on this site</p>
              </div>
              <div class="summary-card">
                <span class="summary-label">${getInlineIcon("target")} Remaining today</span>
                <strong class="icon-row">${getInlineIcon("flag")} ${remainingLabel}</strong>
                <p>${daily.remaining.xp} XP left to hit the daily target</p>
              </div>
            </div>
          ` : `
            <div class="goal-stack">
              ${periodRows}
            </div>
            <div class="link-row">
              <button id="openGoalsSettings" class="link-button" type="button" aria-label="Open goal settings" title="Open the full goals settings page">${getInlineIcon("gear")} Settings</button>
            </div>
          `}
          </div>

          <div class="footer">
            <button id="toggleView" class="footer-button primary" type="button" aria-label="${widgetMode === "summary" ? "View goal progress" : "Return to today view"}" title="${widgetMode === "summary" ? "View daily, weekly, monthly, and yearly goals" : "Return to today's progress"}">${widgetMode === "summary" ? `${getInlineIcon("target")} Goals` : `${getInlineIcon("spark")} Today`}</button>
          </div>
        </div>
      </div>
    `;

    focusPanelRoot.getElementById("openDashboard").addEventListener("click", () => {
      openExtensionPage("OPEN_DASHBOARD_PAGE");
    });
    if (widgetMode !== "summary") {
      focusPanelRoot.getElementById("openGoalsSettings").addEventListener("click", () => {
        openExtensionPage("OPEN_GOALS_PAGE");
      });
    }
    focusPanelRoot.getElementById("closeWidget").addEventListener("click", closeWidget);
    focusPanelRoot.getElementById("toggleView").addEventListener("click", toggleWidgetView);
    bindWidgetDragging();
    applyWidgetPosition();
    widgetTransition = "";
  }

  function renderFocusPanelError(error) {
    ensureFocusPanel();

    focusPanelRoot.innerHTML = `
      <style>
        .panel {
          width: 260px;
          padding: 14px;
          color: #fff1cf;
          font: 13px/1.45 "Trebuchet MS", "Gill Sans", sans-serif;
          border-radius: 20px;
          border: 1px solid rgba(255, 214, 107, 0.18);
          background: linear-gradient(180deg, rgba(20, 20, 20, 0.98), rgba(8, 8, 8, 0.98));
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.42);
        }

        .button {
          margin-top: 10px;
          appearance: none;
          border-radius: 999px;
          padding: 8px 12px;
          font: inherit;
          cursor: pointer;
          border: 1px solid rgba(255, 224, 141, 0.18);
          color: #fff1cf;
          background: rgba(255, 255, 255, 0.04);
        }
      </style>
      <div class="panel">
        <strong>Social-XP</strong>
        <p>${escapeHtml(error && error.message ? error.message : "Unable to load focus board.")}</p>
        <button id="retryPanel" class="button" type="button">Retry</button>
      </div>
    `;

    focusPanelRoot.getElementById("retryPanel").addEventListener("click", refreshFocusPanel);
    applyWidgetPosition();
  }

  function toggleWidgetView() {
    widgetTransition = widgetMode === "summary" ? "to-goals" : "to-summary";
    widgetMode = widgetMode === "summary" ? "goals" : "summary";
    refreshFocusPanel();
  }

  function closeWidget() {
    widgetVisible = false;
    widgetRefreshHoldUntil = 0;
    widgetLevelHighlight = false;

    if (widgetLevelHighlightTimer) {
      window.clearTimeout(widgetLevelHighlightTimer);
      widgetLevelHighlightTimer = 0;
    }

    destroyFocusPanel();
  }

  async function toggleWidget() {
    widgetVisible = !widgetVisible;

    if (!widgetVisible) {
      destroyFocusPanel();
      return { ok: true, visible: false };
    }

    widgetMode = "summary";
    widgetTransition = "";
    widgetRefreshHoldUntil = 0;
    await loadWidgetPosition();
    return refreshFocusPanel();
  }

  function openExtensionPage(messageType) {
    sendMessage({ type: messageType }).catch(() => {
      return undefined;
    });
  }

  function destroyFocusPanel() {
    if (focusPanelHost) {
      focusPanelHost.remove();
    }

    stopWidgetDrag();
    focusPanelHost = null;
    focusPanelRoot = null;
  }

  function bindWidgetDragging() {
    if (!focusPanelRoot) {
      return;
    }

    const header = focusPanelRoot.querySelector(".header");

    if (!header) {
      return;
    }

    header.addEventListener("pointerdown", startWidgetDrag);
  }

  function startWidgetDrag(event) {
    if (event.button !== 0 || !focusPanelHost || !focusPanelRoot) {
      return;
    }

    const interactiveTarget = event.target instanceof Element
      ? event.target.closest("button, a, input, textarea, select, label")
      : null;

    if (interactiveTarget) {
      return;
    }

    const header = focusPanelRoot.querySelector(".header");
    const rect = focusPanelHost.getBoundingClientRect();

    widgetDragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originLeft: rect.left,
      originTop: rect.top
    };

    focusPanelHost.style.left = `${rect.left}px`;
    focusPanelHost.style.top = `${rect.top}px`;
    focusPanelHost.style.right = "auto";
    focusPanelHost.style.bottom = "auto";

    if (header) {
      header.classList.add("is-dragging");

      if (typeof header.setPointerCapture === "function") {
        header.setPointerCapture(event.pointerId);
      }
    }

    document.addEventListener("pointermove", moveWidgetDrag, true);
    document.addEventListener("pointerup", stopWidgetDrag, true);
    document.addEventListener("pointercancel", stopWidgetDrag, true);
    event.preventDefault();
  }

  function moveWidgetDrag(event) {
    if (!widgetDragState || event.pointerId !== widgetDragState.pointerId) {
      return;
    }

    const nextPosition = clampWidgetPosition({
      left: widgetDragState.originLeft + (event.clientX - widgetDragState.startX),
      top: widgetDragState.originTop + (event.clientY - widgetDragState.startY)
    });

    widgetPosition = nextPosition;
    applyWidgetPosition();
    event.preventDefault();
  }

  function stopWidgetDrag(event) {
    if (widgetDragState && event && event.pointerId !== widgetDragState.pointerId) {
      return;
    }

    if (focusPanelRoot) {
      const header = focusPanelRoot.querySelector(".header");

      if (header) {
        header.classList.remove("is-dragging");

        if (event && typeof header.releasePointerCapture === "function") {
          try {
            header.releasePointerCapture(event.pointerId);
          } catch (error) {
            void error;
          }
        }
      }
    }

    document.removeEventListener("pointermove", moveWidgetDrag, true);
    document.removeEventListener("pointerup", stopWidgetDrag, true);
    document.removeEventListener("pointercancel", stopWidgetDrag, true);

    if (widgetDragState && widgetPosition) {
      saveWidgetPosition(widgetPosition).catch(() => {
        return undefined;
      });
    }

    widgetDragState = null;
  }

  async function loadWidgetPosition() {
    if (widgetPositionLoaded) {
      return widgetPosition;
    }

    widgetPositionLoaded = true;

    try {
      const stored = await storageGetLocal({
        [STORAGE_KEYS.widgetPositions]: {}
      });
      const positions = stored && typeof stored[STORAGE_KEYS.widgetPositions] === "object"
        ? stored[STORAGE_KEYS.widgetPositions]
        : {};

      widgetPosition = normalizeWidgetPosition(positions[getWidgetPositionKey()]);
    } catch (error) {
      widgetPosition = null;
    }

    return widgetPosition;
  }

  async function saveWidgetPosition(position) {
    const normalized = normalizeWidgetPosition(position);

    if (!normalized) {
      return;
    }

    widgetPosition = normalized;

    const stored = await storageGetLocal({
      [STORAGE_KEYS.widgetPositions]: {}
    });
    const existing = stored && typeof stored[STORAGE_KEYS.widgetPositions] === "object"
      ? stored[STORAGE_KEYS.widgetPositions]
      : {};

    await storageSetLocal({
      [STORAGE_KEYS.widgetPositions]: {
        ...existing,
        [getWidgetPositionKey()]: normalized
      }
    });
  }

  function applyWidgetPosition() {
    if (!focusPanelHost) {
      return;
    }

    if (!widgetPosition) {
      focusPanelHost.style.top = "18px";
      focusPanelHost.style.right = "18px";
      focusPanelHost.style.left = "auto";
      focusPanelHost.style.bottom = "auto";
      return;
    }

    widgetPosition = clampWidgetPosition(widgetPosition);
    focusPanelHost.style.top = `${widgetPosition.top}px`;
    focusPanelHost.style.left = `${widgetPosition.left}px`;
    focusPanelHost.style.right = "auto";
    focusPanelHost.style.bottom = "auto";
  }

  function clampWidgetPosition(position) {
    const normalized = normalizeWidgetPosition(position);

    if (!normalized) {
      return null;
    }

    const rect = focusPanelHost ? focusPanelHost.getBoundingClientRect() : null;
    const width = rect && rect.width ? rect.width : 286;
    const height = rect && rect.height ? rect.height : 320;
    const minLeft = 12;
    const minTop = 12;
    const maxLeft = Math.max(window.innerWidth - width - minLeft, minLeft);
    const maxTop = Math.max(window.innerHeight - height - minTop, minTop);

    return {
      left: Math.round(Math.min(Math.max(normalized.left, minLeft), maxLeft)),
      top: Math.round(Math.min(Math.max(normalized.top, minTop), maxTop))
    };
  }

  function normalizeWidgetPosition(position) {
    if (!position || typeof position !== "object") {
      return null;
    }

    const left = Number(position.left);
    const top = Number(position.top);

    if (!Number.isFinite(left) || !Number.isFinite(top)) {
      return null;
    }

    return {
      left: Math.round(left),
      top: Math.round(top)
    };
  }

  function getWidgetPositionKey() {
    return `${activeSite.id}:${window.location.hostname.toLowerCase()}`;
  }

  function highlightWidgetLevel() {
    widgetLevelHighlight = true;

    if (widgetLevelHighlightTimer) {
      window.clearTimeout(widgetLevelHighlightTimer);
    }

    widgetLevelHighlightTimer = window.setTimeout(() => {
      widgetLevelHighlight = false;
      widgetLevelHighlightTimer = 0;

      if (widgetVisible && Date.now() >= widgetRefreshHoldUntil) {
        refreshFocusPanel();
      }
    }, 2600);
  }

  function launchWidgetLevelUp(levelUp) {
    if (!focusPanelRoot) {
      return;
    }

    const panel = focusPanelRoot.querySelector(".panel");

    if (!panel) {
      return;
    }

    const existing = focusPanelRoot.getElementById("socialxp-levelup");

    if (existing) {
      existing.remove();
    }

    const overlay = document.createElement("div");
    overlay.id = "socialxp-levelup";
    overlay.style.position = "absolute";
    overlay.style.inset = "-2px";
    overlay.style.pointerEvents = "none";
    overlay.style.overflow = "hidden";
    overlay.style.zIndex = "3";
    overlay.innerHTML = `
      <div style="
        position:absolute;
        inset:0;
        background:
          radial-gradient(circle at 50% 12%, rgba(255, 236, 180, 0.24), transparent 34%),
          radial-gradient(circle at 50% 68%, rgba(255, 197, 74, 0.14), transparent 46%);
        opacity:0;
        animation:socialxp-level-glow 1800ms ease forwards;
      "></div>
      <div style="
        position:absolute;
        left:50%;
        top:18px;
        transform:translateX(-50%);
        min-width:178px;
        padding:11px 14px;
        border-radius:18px;
        border:1px solid rgba(255,224,141,0.28);
        color:#fff1cf;
        text-align:center;
        background:
          radial-gradient(circle at top, rgba(255,239,191,0.22), transparent 56%),
          linear-gradient(180deg, rgba(28,22,10,0.96), rgba(8,8,8,0.96));
        box-shadow:0 20px 42px rgba(0,0,0,0.38), 0 0 24px rgba(255, 219, 121, 0.12);
        animation:socialxp-level-banner 2200ms cubic-bezier(0.2,0.9,0.24,1) forwards;
      ">
        <div style="color:#d5aa44;font-size:9px;letter-spacing:0.22em;text-transform:uppercase;">Level Up</div>
        <div style="
          margin-top:4px;
          font-size:28px;
          font-weight:700;
          line-height:1;
          color:transparent;
          background:linear-gradient(180deg, #fff7cb 0%, #ffe7a1 36%, #f0c865 72%, #b07618 100%);
          -webkit-background-clip:text;
          background-clip:text;
        ">Level ${escapeHtml(String(levelUp.toLevel))}</div>
        <div style="margin-top:5px;color:rgba(255,241,207,0.74);font-size:11px;">${escapeHtml(String(levelUp.remainingXp))} XP to next level</div>
      </div>
      <div style="position:absolute;inset:0;">
        ${createWidgetConfettiPieces(40)}
      </div>
      <style>
        @keyframes socialxp-level-glow {
          0% {
            opacity: 0;
          }

          16%,
          64% {
            opacity: 1;
          }

          100% {
            opacity: 0;
          }
        }

        @keyframes socialxp-level-banner {
          0% {
            opacity: 0;
            transform: translateX(-50%) translateY(-16px) scale(0.82);
          }

          14% {
            opacity: 1;
            transform: translateX(-50%) translateY(0) scale(1.04);
          }

          24% {
            transform: translateX(-50%) translateY(0) scale(1);
          }

          82% {
            opacity: 1;
            transform: translateX(-50%) translateY(0) scale(1);
          }

          100% {
            opacity: 0;
            transform: translateX(-50%) translateY(-8px) scale(0.96);
          }
        }

        @keyframes socialxp-confetti-fall {
          0% {
            opacity: 0;
            transform: translate3d(0, -12%, 0) rotate(0deg);
          }

          8% {
            opacity: 1;
          }

          100% {
            opacity: 0;
            transform: translate3d(var(--drift), 112%, 0) rotate(var(--rotate));
          }
        }
      </style>
    `;

    panel.appendChild(overlay);
    panel.animate(
      [
        { transform: "scale(1)", filter: "brightness(1)" },
        { transform: "scale(1.016)", filter: "brightness(1.08)" },
        { transform: "scale(1)", filter: "brightness(1)" }
      ],
      {
        duration: 760,
        easing: "cubic-bezier(0.2, 0.9, 0.24, 1)"
      }
    );

    window.setTimeout(() => {
      overlay.remove();
    }, 2500);
  }

  function createWidgetConfettiPieces(count) {
    return Array.from({ length: count }, (_, index) => {
      const x = 4 + Math.random() * 92;
      const drift = -56 + Math.random() * 112;
      const duration = 1200 + Math.random() * 700;
      const delay = Math.random() * 180;
      const rotate = 180 + Math.random() * 300;
      const width = 4 + Math.random() * 5;
      const height = width * (1.5 + Math.random() * 1.6);
      const color = [
        "#ffe7a1",
        "#d5aa44",
        "#f0c865",
        "#fff5cf",
        "#9c670f"
      ][index % 5];

      return `<span style="
        position:absolute;
        top:-10%;
        left:${x}%;
        width:${width}px;
        height:${height}px;
        border-radius:999px;
        background:linear-gradient(180deg, rgba(255,255,255,0.82), ${color});
        box-shadow:0 0 10px rgba(255,223,146,0.18);
        opacity:0;
        --drift:${drift}px;
        --rotate:${rotate}deg;
        animation:socialxp-confetti-fall ${duration}ms cubic-bezier(0.18,0.72,0.24,1) forwards;
        animation-delay:${delay}ms;
      "></span>`;
    }).join("");
  }

  function ensureToastRoot() {
    if (toastRoot) {
      return;
    }

    const host = document.createElement("div");
    host.id = "socialxp-toast-root";
    host.style.position = "fixed";
    host.style.right = "18px";
    host.style.bottom = "18px";
    host.style.zIndex = "2147483647";
    host.style.pointerEvents = "none";
    document.documentElement.appendChild(host);
    toastRoot = host.attachShadow({ mode: "open" });
  }

  function showToast(event, dashboard) {
    ensureToastRoot();

    const wrapper = document.createElement("div");
    const totalXp = dashboard && dashboard.periods && dashboard.periods.daily ? dashboard.periods.daily.xp : event.xp;
    const dailyGoal = dashboard && dashboard.periods && dashboard.periods.daily ? dashboard.periods.daily.goal.xp : event.xp;
    const progress = dashboard && dashboard.periods && dashboard.periods.daily ? dashboard.periods.daily.progress.xp : 0;

    wrapper.innerHTML = `
      <style>
        .toast {
          width: 260px;
          padding: 14px 16px;
          border-radius: 18px;
          color: #f8ecd2;
          background:
            linear-gradient(145deg, rgba(15, 15, 15, 0.98), rgba(29, 20, 8, 0.98)),
            #101010;
          border: 1px solid rgba(255, 208, 95, 0.28);
          box-shadow: 0 18px 40px rgba(0, 0, 0, 0.48);
          backdrop-filter: blur(14px);
          font: 13px/1.4 "Trebuchet MS", "Gill Sans", sans-serif;
          animation: slide-in 180ms ease-out, fade-out 260ms ease-in 3.4s forwards;
        }

        .eyebrow {
          margin: 0 0 4px;
          color: #d6b35a;
          font-size: 10px;
          letter-spacing: 0.18em;
          text-transform: uppercase;
        }

        .title {
          margin: 0;
          font-size: 18px;
          font-weight: 700;
        }

        .sub {
          margin: 4px 0 10px;
          color: rgba(248, 236, 210, 0.82);
        }

        .bar {
          height: 8px;
          border-radius: 999px;
          overflow: hidden;
          background: rgba(255, 255, 255, 0.08);
        }

        .fill {
          height: 100%;
          width: ${Math.max(6, Math.round(progress * 100))}%;
          border-radius: inherit;
          background:
            linear-gradient(90deg, #8a5b15, #ffcb57, #fff0a3, #d19a23);
          background-size: 200% 100%;
          animation: shimmer 1.8s linear infinite;
        }

        .meta {
          margin-top: 8px;
          display: flex;
          justify-content: space-between;
          color: rgba(248, 236, 210, 0.74);
          font-size: 11px;
        }

        @keyframes shimmer {
          from { background-position: 0% 50%; }
          to { background-position: 200% 50%; }
        }

        @keyframes slide-in {
          from { transform: translateY(12px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }

        @keyframes fade-out {
          to { transform: translateY(8px); opacity: 0; }
        }
      </style>
      <div class="toast">
        <p class="eyebrow">Social-XP</p>
        <p class="title">+${event.xp} XP</p>
        <p class="sub">${event.activityType === "reply" ? "Reply / comment" : "New post"} tracked on ${event.siteLabel}</p>
        <div class="bar"><div class="fill"></div></div>
        <div class="meta">
          <span>${totalXp} XP today</span>
          <span>${Math.max(totalXp, 0)} / ${Math.max(dailyGoal, 0)} XP</span>
        </div>
      </div>
    `;

    toastRoot.appendChild(wrapper);

    window.setTimeout(() => {
      wrapper.remove();
    }, 3800);
  }

  function showLevelUpToast(levelUp) {
    ensureToastRoot();

    const wrapper = document.createElement("div");
    wrapper.innerHTML = `
      <style>
        .level-toast {
          position: relative;
          width: 278px;
          margin-top: 10px;
          padding: 16px 16px 15px;
          overflow: hidden;
          border-radius: 22px;
          color: #f8ecd2;
          background:
            radial-gradient(circle at top, rgba(255, 239, 191, 0.18), transparent 54%),
            linear-gradient(145deg, rgba(18, 14, 7, 0.98), rgba(29, 20, 8, 0.98));
          border: 1px solid rgba(255, 208, 95, 0.32);
          box-shadow: 0 18px 40px rgba(0, 0, 0, 0.48);
          backdrop-filter: blur(14px);
          font: 13px/1.4 "Trebuchet MS", "Gill Sans", sans-serif;
          animation: level-slide-in 220ms ease-out, level-fade-out 260ms ease-in 3.5s forwards;
        }

        .level-toast::before {
          content: "";
          position: absolute;
          inset: 0;
          background: radial-gradient(circle at 50% 10%, rgba(255, 224, 141, 0.16), transparent 34%);
          pointer-events: none;
        }

        .eyebrow {
          margin: 0 0 4px;
          color: #d6b35a;
          font-size: 10px;
          letter-spacing: 0.18em;
          text-transform: uppercase;
        }

        .title {
          margin: 0;
          font-size: 28px;
          font-weight: 700;
          line-height: 1;
          color: transparent;
          background: linear-gradient(180deg, #fff7cb 0%, #ffe7a1 36%, #f0c865 72%, #b07618 100%);
          -webkit-background-clip: text;
          background-clip: text;
        }

        .sub {
          margin: 6px 0 0;
          color: rgba(248, 236, 210, 0.82);
        }

        .meta {
          margin-top: 10px;
          color: rgba(248, 236, 210, 0.74);
          font-size: 11px;
        }

        .confetti {
          position: absolute;
          inset: 0;
          pointer-events: none;
        }

        .piece {
          position: absolute;
          top: -14%;
          left: var(--x);
          width: var(--size);
          height: var(--height);
          border-radius: 999px;
          background: linear-gradient(180deg, rgba(255,255,255,0.82), var(--confetti));
          box-shadow: 0 0 10px rgba(255,223,146,0.18);
          opacity: 0;
          transform: translate3d(0, 0, 0) rotate(0deg);
          animation: toast-confetti-fall var(--duration) cubic-bezier(0.18, 0.72, 0.24, 1) forwards;
          animation-delay: var(--delay);
        }

        @keyframes level-slide-in {
          from { transform: translateY(12px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }

        @keyframes level-fade-out {
          to { transform: translateY(8px); opacity: 0; }
        }

        @keyframes toast-confetti-fall {
          0% {
            opacity: 0;
            transform: translate3d(0, -10%, 0) rotate(0deg);
          }

          8% {
            opacity: 1;
          }

          100% {
            opacity: 0;
            transform: translate3d(var(--drift), 118%, 0) rotate(var(--rotate));
          }
        }
      </style>
      <div class="level-toast">
        <div class="confetti">${createToastConfettiPieces(22)}</div>
        <p class="eyebrow">Level Up</p>
        <p class="title">Level ${escapeHtml(String(levelUp.toLevel))}</p>
        <p class="sub">You crossed into a new level.</p>
        <p class="meta">${escapeHtml(String(levelUp.remainingXp))} XP to next level</p>
      </div>
    `;

    toastRoot.appendChild(wrapper);

    window.setTimeout(() => {
      wrapper.remove();
    }, 4000);
  }

  function createToastConfettiPieces(count) {
    return Array.from({ length: count }, (_, index) => {
      const x = 5 + Math.random() * 90;
      const drift = -48 + Math.random() * 96;
      const duration = 1100 + Math.random() * 700;
      const delay = Math.random() * 180;
      const rotate = 180 + Math.random() * 320;
      const width = 4 + Math.random() * 4;
      const height = width * (1.5 + Math.random() * 1.6);
      const color = ["#ffe7a1", "#d5aa44", "#f0c865", "#fff5cf", "#9c670f"][index % 5];

      return `<span class="piece" style="--x:${x}%;--drift:${drift}px;--duration:${duration}ms;--delay:${delay}ms;--rotate:${rotate}deg;--size:${width}px;--height:${height}px;--confetti:${color};"></span>`;
    }).join("");
  }

  function getActiveSite() {
    const hostname = window.location.hostname.toLowerCase();

    return SITE_CONFIGS.find((site) => {
      return site.hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`));
    });
  }

  function isVisible(element) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();

    return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
  }

  function isSearchLike(element) {
    const hint = normalizeText([
      element.getAttribute && element.getAttribute("aria-label"),
      element.getAttribute && element.getAttribute("placeholder"),
      element.getAttribute && element.getAttribute("name"),
      element.getAttribute && element.getAttribute("type")
    ].join(" "));

    return hint.includes("search");
  }

  function hasMeaningfulContent(content) {
    return normalizeText(content).length >= 2;
  }

  function normalizeText(value) {
    return normalizeWhitespace(value).toLowerCase();
  }

  function normalizeWhitespace(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function containsAny(value, patterns) {
    return patterns.some((pattern) => value.includes(pattern));
  }

  function sendMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        resolve(response);
      });
    });
  }

  function storageGetLocal(defaults) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(defaults, (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        resolve(result);
      });
    });
  }

  function storageSetLocal(values) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set(values, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        resolve();
      });
    });
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function getBrandBadge() {
    return `<img class="brand-badge" src="${chrome.runtime.getURL("assets/icons/icon48.png")}" alt="">`;
  }

  function getInlineIcon(name) {
    const icons = {
      dashboard: `
        <svg class="inline-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none">
          <path d="M4 19.5H20" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"></path>
          <rect x="5.2" y="13.8" width="2.7" height="5.7" rx="0.9" fill="currentColor"></rect>
          <rect x="9.9" y="10.2" width="2.9" height="9.3" rx="0.9" fill="currentColor"></rect>
          <rect x="14.9" y="6.4" width="3" height="13.1" rx="0.9" fill="currentColor"></rect>
          <path d="M5 11.8C8.4 11.2 11.6 9.9 14.1 7.6C15.3 6.5 16.4 5.1 17.4 3.5L15.8 3.3L19.4 1L19.2 5.4L17.7 4.7C16.8 6.1 15.7 7.4 14.4 8.5C11.8 10.8 8.6 12.4 5 13.1V11.8Z" fill="currentColor"></path>
        </svg>
      `,
      close: `
        <svg class="inline-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none">
          <path d="M7 7 17 17" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>
          <path d="M17 7 7 17" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>
        </svg>
      `,
      gear: `
        <svg class="inline-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none">
          <path d="M10.6 2h2.8l.5 2.4a7.9 7.9 0 0 1 1.9.8l2.1-1.2 2 2-1.2 2.1c.35.6.62 1.24.8 1.92L22 10.6v2.8l-2.4.5a7.9 7.9 0 0 1-.8 1.9l1.2 2.1-2 2-2.1-1.2a7.9 7.9 0 0 1-1.92.8L13.4 22h-2.8l-.5-2.4a7.9 7.9 0 0 1-1.9-.8l-2.1 1.2-2-2 1.2-2.1a7.9 7.9 0 0 1-.8-1.92L2 13.4v-2.8l2.4-.5c.18-.68.45-1.32.8-1.9L4 6.2l2-2 2.1 1.2c.6-.35 1.24-.62 1.92-.8L10.6 2Z" stroke="currentColor" stroke-width="1.5"></path>
          <circle cx="12" cy="12" r="3" fill="currentColor"></circle>
        </svg>
      `,
      spark: `
        <svg class="inline-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none">
          <path d="M12 2 14.7 8.2 21 11l-6.3 2.8L12 20l-2.7-6.2L3 11l6.3-2.8L12 2Z" fill="currentColor"></path>
        </svg>
      `,
      streak: `
        <svg class="inline-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none">
          <path d="M13.5 2c.9 3-1.6 4.7-1.6 6.9 0 1.4.9 2.2 2 2.2 1.6 0 2.7-1.5 2.7-3.3 0-.4-.04-.83-.16-1.27C18.5 8.1 21 10.8 21 14.4 21 19 17.4 22 12.7 22 8 22 4 19.1 4 14.7c0-2.8 1.3-5.1 3.3-6.9-.2 3.2 1.7 4.6 3.2 4.6 1.3 0 2.3-.9 2.3-2.3 0-2.1-1.7-3.5.7-8.1Z" fill="currentColor"></path>
        </svg>
      `,
      level: `
        <svg class="inline-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none">
          <path d="M12 3 14.9 8.9 21.4 9.8 16.7 14.3 17.8 20.8 12 17.7 6.2 20.8 7.3 14.3 2.6 9.8 9.1 8.9 12 3Z" fill="currentColor"></path>
        </svg>
      `,
      target: `
        <svg class="inline-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none">
          <circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.6"></circle>
          <circle cx="12" cy="12" r="4.2" stroke="currentColor" stroke-width="1.6"></circle>
          <circle cx="12" cy="12" r="1.8" fill="currentColor"></circle>
        </svg>
      `,
      flag: `
        <svg class="inline-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none">
          <path d="M6 3v18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>
          <path d="M7 4h9l-1.4 3L16 10H7V4Z" fill="currentColor"></path>
        </svg>
      `
    };

    return icons[name] || "";
  }

  function getSiteIcon(siteId) {
    const palette = {
      x: "#e8d29a",
      linkedin: "#c99a2b",
      threads: "#f0cf80",
      discord: "#d7aa47",
      reddit: "#ffd36a",
      facebook: "#e7bf62",
      bluesky: "#f7d98c"
    };
    const color = palette[siteId] || "#d5aa44";

    return `
      <svg class="inline-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none">
        <rect x="3" y="3" width="18" height="18" rx="6" fill="${color}" fill-opacity="0.18" stroke="${color}" stroke-width="1.4"></rect>
        <circle cx="12" cy="12" r="3.2" fill="${color}"></circle>
      </svg>
    `;
  }

  function capitalize(value) {
    return value.charAt(0).toUpperCase() + value.slice(1);
  }
})();
