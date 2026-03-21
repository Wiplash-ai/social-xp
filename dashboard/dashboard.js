"use strict";

const TIMEFRAMES = ["daily", "weekly", "monthly", "yearly"];
const TIMEFRAME_LABELS = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  yearly: "Yearly"
};

let dashboardState = null;
let selectedTimeframe = "weekly";

document.addEventListener("DOMContentLoaded", async () => {
  document.getElementById("openGoals").addEventListener("click", openGoalsPage);

  document.querySelectorAll("[data-timeframe]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedTimeframe = button.dataset.timeframe;
      renderDashboard(dashboardState);
    });
  });

  chrome.storage.onChanged.addListener(handleStorageChange);

  await refreshDashboard();
});

async function refreshDashboard() {
  try {
    const response = await sendMessage({ type: "GET_DASHBOARD_DATA" });

    if (!response || !response.ok) {
      throw new Error(response && response.error ? response.error : "Unable to load dashboard");
    }

    const previousDashboard = dashboardState;
    dashboardState = response.dashboard;
    renderDashboard(dashboardState);

    if (previousDashboard && dashboardState.level.level > previousDashboard.level.level) {
      launchDashboardLevelUp(previousDashboard.level.level, dashboardState.level.level);
    }
  } catch (error) {
    renderError(error);
  }
}

function renderDashboard(dashboard) {
  if (!dashboard) {
    return;
  }

  updateTimeframeButtons();

  const summary = dashboard.periods[selectedTimeframe];
  const analytics = dashboard.analytics[selectedTimeframe];
  const timeframeLabel = TIMEFRAME_LABELS[selectedTimeframe];

  setText("selectedTimeframeLabel", `${timeframeLabel} Focus`);
  animateValue("selectedXp", summary.xp, {
    suffix: " XP",
    duration: 900
  });
  setText(
    "selectedSummary",
    `${summary.totalActions} actions • ${summary.posts} posts • ${summary.replies} replies`
  );
  setText("selectedGoalLabel", `${summary.xp} / ${summary.goal.xp} XP`);
  setWidth("selectedGoalFill", summary.progress.xp);

  animateValue("levelValue", dashboard.level.level, { duration: 760 });
  setText("streakCount", `${dashboard.streakDays}d`);
  animateValue("allTimeXp", dashboard.allTime.xp, { duration: 1100 });
  setText("nextLevelMeta", `${dashboard.level.remainingXp} XP to level ${dashboard.level.nextLevel}`);

  setText("trendTitle", `${timeframeLabel} XP Flow`);
  setText(
    "trendMeta",
    `${summary.xp} XP across ${analytics.points.length} ${selectedTimeframe === "yearly" ? "months" : "points"}.`
  );

  animateValue("mixTotal", summary.totalActions, { duration: 760 });
  animateValue("legendPosts", summary.posts, { duration: 700 });
  animateValue("legendReplies", summary.replies, { duration: 700 });
  animateValue("statActions", summary.totalActions, { duration: 760 });
  animateValue("statPosts", summary.posts, { duration: 700 });
  animateValue("statReplies", summary.replies, { duration: 700 });

  renderTrendChart(analytics);
  renderMixChart(summary);
  renderSiteGrid(analytics.siteBreakdown);
}

function renderTrendChart(analytics) {
  const svg = document.getElementById("trendChart");
  const points = analytics.points;
  const width = 720;
  const height = 280;
  const padding = { top: 18, right: 18, bottom: 34, left: 18 };
  const graphWidth = width - padding.left - padding.right;
  const graphHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(1, analytics.maxXp);
  const labelStep = Math.max(1, Math.ceil(points.length / 7));

  if (points.length === 0) {
    svg.innerHTML = "";
    return;
  }

  const coordinates = points.map((point, index) => {
    const x = padding.left + (points.length === 1 ? graphWidth / 2 : (graphWidth / (points.length - 1)) * index);
    const y = padding.top + graphHeight - (point.xp / maxValue) * graphHeight;

    return { x, y, point };
  });

  const linePath = coordinates
    .map((coordinate, index) => `${index === 0 ? "M" : "L"} ${coordinate.x.toFixed(2)} ${coordinate.y.toFixed(2)}`)
    .join(" ");
  const areaPath = [
    linePath,
    `L ${coordinates[coordinates.length - 1].x.toFixed(2)} ${(padding.top + graphHeight).toFixed(2)}`,
    `L ${coordinates[0].x.toFixed(2)} ${(padding.top + graphHeight).toFixed(2)} Z`
  ].join(" ");

  svg.innerHTML = `
    <defs>
      <linearGradient id="graphFill" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#ffe7a1" stop-opacity="0.52"></stop>
        <stop offset="100%" stop-color="#d5aa44" stop-opacity="0.04"></stop>
      </linearGradient>
      <linearGradient id="graphStroke" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#8d6118"></stop>
        <stop offset="45%" stop-color="#d5aa44"></stop>
        <stop offset="100%" stop-color="#ffe7a1"></stop>
      </linearGradient>
      <filter id="goldGlow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="4" result="blur"></feGaussianBlur>
        <feMerge>
          <feMergeNode in="blur"></feMergeNode>
          <feMergeNode in="SourceGraphic"></feMergeNode>
        </feMerge>
      </filter>
    </defs>
    ${[0, 1, 2, 3]
      .map((step) => {
        const y = padding.top + (graphHeight / 3) * step;
        return `<line class="trend-grid-line" x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="rgba(255,222,132,0.12)" stroke-width="1"></line>`;
      })
      .join("")}
    <path class="trend-area" d="${areaPath}" fill="url(#graphFill)"></path>
    <path class="trend-line" d="${linePath}" pathLength="100" fill="none" stroke="url(#graphStroke)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" filter="url(#goldGlow)"></path>
    ${coordinates
      .map((coordinate, index) => {
        return `
          <g class="trend-point" style="--point-delay:${140 + index * 55}ms">
            <circle class="trend-point-ring" cx="${coordinate.x}" cy="${coordinate.y}" r="5.5" fill="#060606" stroke="#ffe7a1" stroke-width="2"></circle>
            <circle class="trend-point-core" cx="${coordinate.x}" cy="${coordinate.y}" r="2.5" fill="#d5aa44"></circle>
          </g>
        `;
      })
      .join("")}
    ${coordinates
      .map((coordinate, index) => {
        if (index % labelStep !== 0 && index !== coordinates.length - 1) {
          return "";
        }

        return `
          <text class="trend-label" x="${coordinate.x}" y="${height - 8}" text-anchor="middle" fill="rgba(255,233,184,0.72)" font-size="11" style="--label-delay:${180 + index * 45}ms">
            ${escapeHtml(coordinate.point.shortLabel)}
          </text>
        `;
      })
      .join("")}
  `;
}

function renderSiteGrid(sites) {
  const container = document.getElementById("siteGrid");
  container.innerHTML = "";

  if (!sites || sites.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No tracked activity in this window yet.";
    container.appendChild(empty);
    return;
  }

  sites.slice(0, 6).forEach((site) => {
    const tile = document.createElement("article");
    tile.className = "site-tile";
    tile.style.setProperty("--tile-index", String(container.children.length));
    tile.innerHTML = `
      <div class="site-title-row">
        <strong>${escapeHtml(site.siteLabel)}</strong>
        <span class="site-icon" style="background:${siteGradient(site.site)}"></span>
      </div>
      <p class="site-xp">${site.xp} XP</p>
      <p class="site-meta">${site.posts} posts • ${site.replies} replies</p>
    `;
    container.appendChild(tile);
  });
}

function renderMixChart(summary) {
  const svg = document.getElementById("mixChart");
  const total = Math.max(summary.totalActions, 1);
  const postsRatio = summary.posts / total;
  const repliesRatio = summary.replies / total;
  const postsLength = Math.max(postsRatio * 100, 0);
  const repliesLength = Math.max(repliesRatio * 100, 0);

  svg.innerHTML = `
    <circle class="mix-track" cx="80" cy="80" r="52" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="16"></circle>
    <circle
      class="mix-ring mix-ring-posts"
      cx="80"
      cy="80"
      r="52"
      fill="none"
      stroke="#ffe7a1"
      stroke-width="16"
      stroke-linecap="round"
      pathLength="100"
      stroke-dasharray="${postsLength} 100"
      stroke-dashoffset="100"
    ></circle>
    <circle
      class="mix-ring mix-ring-replies"
      cx="80"
      cy="80"
      r="52"
      fill="none"
      stroke="#a86d18"
      stroke-width="16"
      stroke-linecap="round"
      pathLength="100"
      stroke-dasharray="${repliesLength} 100"
      stroke-dashoffset="100"
    ></circle>
  `;

  window.requestAnimationFrame(() => {
    const postsRing = svg.querySelector(".mix-ring-posts");
    const repliesRing = svg.querySelector(".mix-ring-replies");

    if (postsRing) {
      postsRing.style.strokeDashoffset = "0";
    }

    if (repliesRing) {
      repliesRing.style.strokeDashoffset = `${-postsLength}`;
    }
  });
}

function updateTimeframeButtons() {
  document.querySelectorAll("[data-timeframe]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.timeframe === selectedTimeframe);
  });
}

function handleStorageChange(changes, areaName) {
  if (areaName !== "local") {
    return;
  }

  if (changes.socialXpEvents || changes.socialXpGoals) {
    refreshDashboard();
  }
}

function openGoalsPage() {
  window.location.href = chrome.runtime.getURL("options/options.html");
}

function renderError(error) {
  setText("selectedSummary", "Dashboard unavailable");
  setText("trendMeta", error && error.message ? error.message : "Unable to load Social-XP");
}

function setText(id, value) {
  const element = document.getElementById(id);

  if (element) {
    element.textContent = value;
  }
}

function setWidth(id, progress) {
  const element = document.getElementById(id);

  if (element) {
    window.requestAnimationFrame(() => {
      element.style.width = `${progress > 0 ? Math.round(progress * 100) : 0}%`;
    });
  }
}

function animateValue(id, target, options = {}) {
  const element = document.getElementById(id);

  if (!element) {
    return;
  }

  const nextValue = Number.isFinite(target) ? target : 0;
  const previousValue = Number.parseFloat(element.dataset.value || "0");
  const startValue = Number.isFinite(previousValue) ? previousValue : 0;
  const duration = options.duration || 800;
  const format = options.format || ((value) => `${Math.round(value).toLocaleString()}${options.suffix || ""}`);
  const startTime = performance.now();

  if (typeof element.__socialXpRaf === "number") {
    window.cancelAnimationFrame(element.__socialXpRaf);
  }

  element.dataset.value = String(nextValue);

  function tick(now) {
    const progress = Math.min((now - startTime) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const currentValue = startValue + (nextValue - startValue) * eased;

    element.textContent = format(currentValue, nextValue);

    if (progress < 1) {
      element.__socialXpRaf = window.requestAnimationFrame(tick);
      return;
    }

    element.__socialXpRaf = null;
  }

  element.__socialXpRaf = window.requestAnimationFrame(tick);
}

function launchDashboardLevelUp(fromLevel, toLevel) {
  const shell = document.querySelector(".page-shell");
  const existing = document.querySelector(".level-up-overlay");

  if (existing) {
    existing.remove();
  }

  if (shell) {
    shell.classList.add("is-leveling");
    window.setTimeout(() => {
      shell.classList.remove("is-leveling");
    }, 1800);
  }

  const overlay = document.createElement("div");
  overlay.className = "level-up-overlay";
  overlay.innerHTML = `
    <div class="level-up-banner">
      <span class="level-up-kicker">Level Up</span>
      <strong>Level ${toLevel}</strong>
      <p>${Math.max(toLevel - fromLevel, 1)} level${toLevel - fromLevel === 1 ? "" : "s"} gained</p>
    </div>
    <div class="level-up-confetti">
      ${createConfettiPieces(52)}
    </div>
  `;

  document.body.appendChild(overlay);

  window.setTimeout(() => {
    overlay.remove();
  }, 2800);
}

function createConfettiPieces(count) {
  return Array.from({ length: count }, (_, index) => {
    const x = 4 + Math.random() * 92;
    const drift = -120 + Math.random() * 240;
    const duration = 1400 + Math.random() * 900;
    const delay = Math.random() * 220;
    const rotate = 180 + Math.random() * 360;
    const size = 6 + Math.random() * 8;
    const height = size * (1.4 + Math.random() * 1.8);
    const hue = index % 5;
    const color = [
      "#ffe7a1",
      "#d5aa44",
      "#f0c865",
      "#fff5cf",
      "#9c670f"
    ][hue];

    return `<span class="confetti-piece" style="--x:${x}%;--drift:${drift}px;--duration:${duration}ms;--delay:${delay}ms;--rotate:${rotate}deg;--size:${size}px;--height:${height}px;--confetti:${color};"></span>`;
  }).join("");
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

function siteGradient(siteId) {
  const gradients = {
    x: "linear-gradient(135deg, #ffe7a1, #a86d18)",
    linkedin: "linear-gradient(135deg, #f5d88d, #8d6118)",
    threads: "linear-gradient(135deg, #fff2c4, #c18b1b)",
    discord: "linear-gradient(135deg, #f0c865, #704412)",
    reddit: "linear-gradient(135deg, #ffd97f, #a55c11)",
    facebook: "linear-gradient(135deg, #ffe7a1, #9c7419)",
    bluesky: "linear-gradient(135deg, #fff1c4, #b8841d)"
  };

  return gradients[siteId] || "linear-gradient(135deg, #ffe7a1, #84540f)";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
