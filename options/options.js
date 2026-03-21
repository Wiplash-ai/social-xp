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

document.addEventListener("DOMContentLoaded", async () => {
  bindEvents();
  prepareMotion();

  try {
    const response = await sendMessage({ type: "GET_DASHBOARD_DATA" });

    if (!response || !response.ok) {
      throw new Error(response && response.error ? response.error : "Unable to load Social-XP settings");
    }

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
  document.getElementById("openXpGuide").addEventListener("click", openXpGuide);
  document.getElementById("closeXpGuide").addEventListener("click", closeXpGuide);
  document.getElementById("xpGuideModal").addEventListener("click", handleModalClick);
  document.addEventListener("keydown", handleKeydown);

  PERIODS.forEach((period) => {
    getInput(period, "post").addEventListener("input", () => syncLinkedGoals(period, "post"));
    getInput(period, "reply").addEventListener("input", () => syncLinkedGoals(period, "reply"));
  });
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
