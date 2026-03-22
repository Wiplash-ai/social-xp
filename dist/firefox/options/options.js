"use strict";

const PERIODS = ["daily", "weekly", "monthly", "yearly"];
const PERIOD_FACTORS = {
  daily: 1,
  weekly: 7,
  monthly: 30,
  yearly: 365
};
const XP_VALUES = {
  post: 20,
  reply: 8
};
const THEME_MEDIA = window.matchMedia("(prefers-color-scheme: dark)");
let themePreference = "system";

document.addEventListener("DOMContentLoaded", async () => {
  bindEvents();
  prepareMotion();
  applyThemePreference("system");
  THEME_MEDIA.addEventListener("change", handleThemeMediaChange);

  try {
    const response = await sendMessage({ type: "GET_DASHBOARD_DATA" });

    if (!response || !response.ok) {
      throw new Error(response && response.error ? response.error : "Unable to load Social-XP settings");
    }

    applyThemePreference(response.settings && response.settings.themePreference);
    hydrateGoalInputs(response.dashboard.goals);
    updateXpTargets();
    setStatus("");
  } catch (error) {
    setStatus(error && error.message ? error.message : "Unable to load");
  }
});

function bindEvents() {
  document.getElementById("goalsForm").addEventListener("submit", handleSave);
  document.getElementById("resetData").addEventListener("click", handleReset);
  document.getElementById("openDashboard").addEventListener("click", openDashboardPage);
  document.getElementById("toggleTheme").addEventListener("click", handleThemeToggle);
  document.getElementById("openXpGuide").addEventListener("click", openXpGuide);
  document.getElementById("closeXpGuide").addEventListener("click", closeXpGuide);
  document.getElementById("xpGuideModal").addEventListener("click", handleModalClick);
  document.addEventListener("keydown", handleKeydown);
  chrome.storage.onChanged.addListener(handleStorageChange);

  PERIODS.forEach((period) => {
    getInput(period, "post").addEventListener("input", () => syncLinkedGoals(period, "post"));
    getInput(period, "reply").addEventListener("input", () => syncLinkedGoals(period, "reply"));
  });
}

function handleStorageChange(changes, areaName) {
  if (areaName !== "local" || !changes.socialXpSettings) {
    return;
  }

  applyThemePreference(changes.socialXpSettings.newValue && changes.socialXpSettings.newValue.themePreference);
}

async function handleSave(event) {
  event.preventDefault();
  setStatus("Saving...");

  try {
    const goals = collectGoalsFromInputs();
    const response = await sendMessage({
      type: "SAVE_GOALS",
      payload: { goals }
    });

    if (!response || !response.ok) {
      throw new Error(response && response.error ? response.error : "Save failed");
    }

    hydrateGoalInputs(response.goals);
    updateXpTargets();
    setStatus("Goals saved");
  } catch (error) {
    setStatus(error && error.message ? error.message : "Save failed");
  }
}

async function handleReset() {
  const confirmed = window.confirm("Clear all tracked Social-XP activity? This only removes saved counters.");

  if (!confirmed) {
    return;
  }

  setStatus("Resetting...");

  try {
    const response = await sendMessage({ type: "CLEAR_ACTIVITY" });

    if (!response || !response.ok) {
      throw new Error(response && response.error ? response.error : "Reset failed");
    }

    setStatus("Tracked activity reset");
  } catch (error) {
    setStatus(error && error.message ? error.message : "Reset failed");
  }
}

function hydrateGoalInputs(goals) {
  PERIODS.forEach((period) => {
    getInput(period, "post").value = String(goals[period].post);
    getInput(period, "reply").value = String(goals[period].reply);
  });
}

function collectGoalsFromInputs() {
  return PERIODS.reduce((accumulator, period) => {
    accumulator[period] = {
      post: toNonNegativeInt(getInput(period, "post").value),
      reply: toNonNegativeInt(getInput(period, "reply").value)
    };
    return accumulator;
  }, {});
}

function updateXpTargets() {
  PERIODS.forEach((period) => {
    const postValue = toNonNegativeInt(getInput(period, "post").value);
    const replyValue = toNonNegativeInt(getInput(period, "reply").value);
    const xpTarget = postValue * XP_VALUES.post + replyValue * XP_VALUES.reply;
    animateValue(`${period}XpTarget`, xpTarget, " XP");
  });
}

function syncLinkedGoals(sourcePeriod, type) {
  const sourceValue = toNonNegativeInt(getInput(sourcePeriod, type).value);
  const perDayRate = sourceValue / PERIOD_FACTORS[sourcePeriod];

  PERIODS.forEach((period) => {
    const linkedValue = Math.round(perDayRate * PERIOD_FACTORS[period]);
    getInput(period, type).value = String(linkedValue);
  });

  updateXpTargets();
}

function openDashboardPage() {
  window.location.href = chrome.runtime.getURL("dashboard/dashboard.html");
}

function openXpGuide() {
  const modal = document.getElementById("xpGuideModal");
  modal.hidden = false;
  document.body.classList.add("modal-open");
}

function closeXpGuide() {
  const modal = document.getElementById("xpGuideModal");
  modal.hidden = true;
  document.body.classList.remove("modal-open");
}

function handleModalClick(event) {
  if (event.target instanceof HTMLElement && event.target.hasAttribute("data-close-modal")) {
    closeXpGuide();
  }
}

function handleKeydown(event) {
  if (event.key === "Escape" && !document.getElementById("xpGuideModal").hidden) {
    closeXpGuide();
  }
}

function handleThemeMediaChange() {
  if (themePreference === "system") {
    applyThemePreference("system");
  }
}

async function handleThemeToggle() {
  const nextPreference = getNextThemePreference(themePreference, getSystemTheme());

  try {
    const response = await sendMessage({
      type: "SAVE_SETTINGS",
      payload: {
        settings: {
          themePreference: nextPreference
        }
      }
    });

    if (!response || !response.ok) {
      throw new Error(response && response.error ? response.error : "Unable to save theme");
    }

    applyThemePreference(response.settings && response.settings.themePreference);
  } catch (error) {
    applyThemePreference(themePreference);
  }
}

function applyThemePreference(nextPreference) {
  themePreference = sanitizeThemePreference(nextPreference);
  const effectiveTheme = resolveEffectiveTheme(themePreference);

  document.body.dataset.theme = effectiveTheme;
  document.documentElement.style.colorScheme = effectiveTheme;
  renderThemeToggle();
}

function renderThemeToggle() {
  const button = document.getElementById("toggleTheme");
  const icon = document.getElementById("themeToggleIcon");
  const label = document.getElementById("themeToggleLabel");
  const effectiveTheme = resolveEffectiveTheme(themePreference);
  const systemTheme = getSystemTheme();

  if (!button || !icon || !label) {
    return;
  }

  icon.innerHTML = effectiveTheme === "light" ? getThemeIcon("sun") : getThemeIcon("moon");
  label.textContent = `${themePreference === "system" ? "Auto" : "Manual"} ${capitalize(effectiveTheme)}`;
  button.title = themePreference === "system"
    ? `Following your system ${effectiveTheme} mode. Click to use ${effectiveTheme === "dark" ? "light" : "dark"} mode.`
    : `Using ${effectiveTheme} mode. Click to return to system ${systemTheme} mode.`;
}

function getNextThemePreference(currentPreference, systemTheme) {
  return currentPreference === "system" ? (systemTheme === "dark" ? "light" : "dark") : "system";
}

function getSystemTheme() {
  return THEME_MEDIA.matches ? "dark" : "light";
}

function resolveEffectiveTheme(preference) {
  const normalized = sanitizeThemePreference(preference);
  return normalized === "system" ? getSystemTheme() : normalized;
}

function sanitizeThemePreference(value) {
  return value === "light" || value === "dark" ? value : "system";
}

function prepareMotion() {
  document.querySelectorAll(".site-card").forEach((card, index) => {
    card.style.setProperty("--site-index", String(index));
  });

  document.querySelectorAll(".goal-form .goal-grid:not(.header-row)").forEach((row, index) => {
    row.style.setProperty("--row-index", String(index));
  });

  document.querySelectorAll(".hero-chip").forEach((chip, index) => {
    chip.style.setProperty("--chip-index", String(index));
  });
}

function getInput(period, type) {
  return document.getElementById(`${period}${capitalize(type)}`);
}

function setStatus(message) {
  document.getElementById("saveStatus").textContent = message;
}

function animateValue(id, target, suffix = "") {
  const element = document.getElementById(id);

  if (!element) {
    return;
  }

  const nextValue = Number.isFinite(target) ? target : 0;
  const previousValue = Number.parseFloat(element.dataset.value || "0");
  const startValue = Number.isFinite(previousValue) ? previousValue : 0;
  const duration = 720;
  const startTime = performance.now();

  if (typeof element.__socialXpRaf === "number") {
    window.cancelAnimationFrame(element.__socialXpRaf);
  }

  element.dataset.value = String(nextValue);

  function tick(now) {
    const progress = Math.min((now - startTime) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const currentValue = startValue + (nextValue - startValue) * eased;

    element.textContent = `${Math.round(currentValue).toLocaleString()}${suffix}`;

    if (progress < 1) {
      element.__socialXpRaf = window.requestAnimationFrame(tick);
      return;
    }

    element.__socialXpRaf = null;
  }

  element.__socialXpRaf = window.requestAnimationFrame(tick);
}

function toNonNegativeInt(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
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

function getThemeIcon(type) {
  if (type === "sun") {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true" fill="none">
        <circle cx="12" cy="12" r="4.5" stroke="currentColor" stroke-width="1.8"></circle>
        <path d="M12 2.8V5.2M12 18.8V21.2M21.2 12H18.8M5.2 12H2.8M18.5 5.5L16.8 7.2M7.2 16.8L5.5 18.5M18.5 18.5L16.8 16.8M7.2 7.2L5.5 5.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>
      </svg>
    `;
  }

  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none">
      <path d="M19.2 14.1A7.5 7.5 0 1 1 9.9 4.8A6.6 6.6 0 0 0 19.2 14.1Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"></path>
    </svg>
  `;
}
