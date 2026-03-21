"use strict";

const STORAGE_KEYS = Object.freeze({
  events: "socialXpEvents",
  rewards: "socialXpRewardEvents",
  goals: "socialXpGoals",
  settings: "socialXpSettings"
});

const XP_VALUES = Object.freeze({
  post: 20,
  reply: 8
});

const XP_BONUSES = Object.freeze({
  goal: Object.freeze({
    daily: 25,
    weekly: 150,
    monthly: 700,
    yearly: 3600
  }),
  difficulty: Object.freeze({
    min: 0.75,
    max: 1.35
  }),
  streak: Object.freeze([
    Object.freeze({ days: 30, xp: 20 }),
    Object.freeze({ days: 14, xp: 15 }),
    Object.freeze({ days: 7, xp: 10 }),
    Object.freeze({ days: 3, xp: 5 })
  ]),
  overgoal: Object.freeze([
    Object.freeze({ key: "125", multiplier: 1.25, xp: 10 }),
    Object.freeze({ key: "150", multiplier: 1.5, xp: 15 }),
    Object.freeze({ key: "200", multiplier: 2, xp: 25 })
  ])
});

const DEFAULT_GOALS = Object.freeze({
  daily: { post: 3, reply: 6 },
  weekly: { post: 21, reply: 42 },
  monthly: { post: 90, reply: 180 },
  yearly: { post: 1095, reply: 2190 }
});

const LEGACY_DEFAULT_GOALS = Object.freeze({
  daily: { post: 2, reply: 5 },
  weekly: { post: 10, reply: 25 },
  monthly: { post: 40, reply: 100 },
  yearly: { post: 480, reply: 1200 }
});

const DEFAULT_SETTINGS = Object.freeze({
  toastEnabled: true
});

const PERIODS = Object.freeze(["daily", "weekly", "monthly", "yearly"]);
const EXTENSION_PAGES = Object.freeze({
  dashboard: "dashboard/dashboard.html",
  goals: "options/options.html"
});
const MAX_EVENT_AGE_DAYS = 365 * 3;
const DEDUPE_WINDOW_MS = 8000;

chrome.runtime.onInstalled.addListener((details) => {
  ensureInitialized().then(() => {
    if (details.reason === "install") {
      chrome.runtime.openOptionsPage();
    }
  });
});

chrome.runtime.onStartup.addListener(() => {
  ensureInitialized();
});

chrome.action.onClicked.addListener((tab) => {
  toggleWidgetOnTab(tab)
    .catch((error) => {
      console.error("Social-XP failed to toggle widget", error);
    });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((error) => {
      console.error("Social-XP message failed", error);
      sendResponse({
        ok: false,
        error: error && error.message ? error.message : "Unknown error"
      });
    });

  return true;
});

async function handleMessage(message) {
  await ensureInitialized();

  switch (message && message.type) {
    case "LOG_ACTIVITY":
      return logActivity(message.payload || {});
    case "GET_DASHBOARD_DATA":
      return getDashboardData();
    case "SAVE_GOALS":
      return saveGoals(message.payload || {});
    case "CLEAR_ACTIVITY":
      return clearActivity();
    case "OPEN_DASHBOARD_PAGE":
      return openExtensionPage("dashboard");
    case "OPEN_GOALS_PAGE":
      return openExtensionPage("goals");
    default:
      return { ok: false, error: "Unknown message type" };
  }
}

async function ensureInitialized() {
  const stored = await storageGet({
    [STORAGE_KEYS.events]: null,
    [STORAGE_KEYS.rewards]: null,
    [STORAGE_KEYS.goals]: null,
    [STORAGE_KEYS.settings]: null
  });

  const next = {};
  const now = Date.now();
  const normalizedEvents = Array.isArray(stored[STORAGE_KEYS.events])
    ? pruneEvents(normalizeEvents(stored[STORAGE_KEYS.events]), now)
    : [];
  let effectiveGoals = isValidGoals(stored[STORAGE_KEYS.goals])
    ? sanitizeGoals(stored[STORAGE_KEYS.goals])
    : cloneGoals(DEFAULT_GOALS);

  if (!Array.isArray(stored[STORAGE_KEYS.events]) || normalizedEvents.length !== stored[STORAGE_KEYS.events].length) {
    next[STORAGE_KEYS.events] = normalizedEvents;
  }

  if (!isValidGoals(stored[STORAGE_KEYS.goals])) {
    effectiveGoals = cloneGoals(DEFAULT_GOALS);
    next[STORAGE_KEYS.goals] = effectiveGoals;
  }

  if (isValidGoals(stored[STORAGE_KEYS.goals]) && goalsEqual(stored[STORAGE_KEYS.goals], LEGACY_DEFAULT_GOALS)) {
    effectiveGoals = cloneGoals(DEFAULT_GOALS);
    next[STORAGE_KEYS.goals] = effectiveGoals;
  }

  if (!Array.isArray(stored[STORAGE_KEYS.rewards])) {
    next[STORAGE_KEYS.rewards] = deriveRewardEvents(normalizedEvents, effectiveGoals);
  } else {
    const normalizedRewards = pruneRewardEvents(normalizeRewardEvents(stored[STORAGE_KEYS.rewards]), now);

    if (normalizedRewards.length !== stored[STORAGE_KEYS.rewards].length) {
      next[STORAGE_KEYS.rewards] = normalizedRewards;
    }
  }

  if (!stored[STORAGE_KEYS.settings] || typeof stored[STORAGE_KEYS.settings] !== "object") {
    next[STORAGE_KEYS.settings] = { ...DEFAULT_SETTINGS };
  }

  if (Object.keys(next).length > 0) {
    await storageSet(next);
  }
}

async function logActivity(payload) {
  const site = typeof payload.site === "string" ? payload.site : "unknown";
  const siteLabel = typeof payload.siteLabel === "string" ? payload.siteLabel : site;
  const activityType = payload.activityType === "reply" ? "reply" : "post";
  const fingerprint = normalizeFingerprint(payload.fingerprint);
  const source = typeof payload.source === "string" ? payload.source : "unknown";
  const now = Date.now();

  const stored = await storageGet({
    [STORAGE_KEYS.events]: [],
    [STORAGE_KEYS.rewards]: [],
    [STORAGE_KEYS.goals]: cloneGoals(DEFAULT_GOALS),
    [STORAGE_KEYS.settings]: { ...DEFAULT_SETTINGS }
  });

  const existingEvents = normalizeEvents(stored[STORAGE_KEYS.events]);
  const existingRewards = pruneRewardEvents(normalizeRewardEvents(stored[STORAGE_KEYS.rewards]), now);
  const goals = isValidGoals(stored[STORAGE_KEYS.goals]) ? stored[STORAGE_KEYS.goals] : cloneGoals(DEFAULT_GOALS);
  const settings = stored[STORAGE_KEYS.settings] || { ...DEFAULT_SETTINGS };
  const previousDashboard = buildDashboard(existingEvents, goals, existingRewards, now);
  const recentEvent = [...existingEvents]
    .reverse()
    .find((event) => {
      return (
        event.site === site &&
        event.activityType === activityType &&
        event.fingerprint === fingerprint &&
        now - event.timestamp < DEDUPE_WINDOW_MS
      );
    });

  if (recentEvent) {
    return {
      ok: true,
      duplicate: true,
      dashboard: previousDashboard,
      settings
    };
  }

  const event = {
    id: crypto.randomUUID(),
    site,
    siteLabel,
    activityType,
    source,
    fingerprint,
    xp: XP_VALUES[activityType],
    timestamp: now
  };

  const nextEvents = pruneEvents([...existingEvents, event], now);
  const nextRewards = updateRewardEvents(nextEvents, existingRewards, goals, now);

  await storageSet({
    [STORAGE_KEYS.events]: nextEvents,
    [STORAGE_KEYS.rewards]: nextRewards
  });

  const dashboard = buildDashboard(nextEvents, goals, nextRewards, now);
  const awardedXp = Math.max(dashboard.allTime.xp - previousDashboard.allTime.xp, event.xp);
  const levelUp = getLevelUp(previousDashboard.level, dashboard.level);

  return {
    ok: true,
    duplicate: false,
    event: {
      ...event,
      baseXp: event.xp,
      bonusXp: Math.max(awardedXp - event.xp, 0),
      xp: awardedXp
    },
    dashboard,
    levelUp,
    settings
  };
}

async function getDashboardData() {
  const stored = await storageGet({
    [STORAGE_KEYS.events]: [],
    [STORAGE_KEYS.rewards]: [],
    [STORAGE_KEYS.goals]: cloneGoals(DEFAULT_GOALS),
    [STORAGE_KEYS.settings]: { ...DEFAULT_SETTINGS }
  });

  const events = normalizeEvents(stored[STORAGE_KEYS.events]);
  const rewardEvents = normalizeRewardEvents(stored[STORAGE_KEYS.rewards]);
  const goals = isValidGoals(stored[STORAGE_KEYS.goals]) ? stored[STORAGE_KEYS.goals] : cloneGoals(DEFAULT_GOALS);
  const settings = stored[STORAGE_KEYS.settings] || { ...DEFAULT_SETTINGS };

  return {
    ok: true,
    dashboard: buildDashboard(events, goals, rewardEvents, Date.now()),
    settings
  };
}

async function saveGoals(payload) {
  const sanitizedGoals = sanitizeGoals(payload.goals);

  await storageSet({
    [STORAGE_KEYS.goals]: sanitizedGoals
  });

  const stored = await storageGet({
    [STORAGE_KEYS.events]: [],
    [STORAGE_KEYS.rewards]: []
  });

  return {
    ok: true,
    goals: sanitizedGoals,
    dashboard: buildDashboard(
      normalizeEvents(stored[STORAGE_KEYS.events]),
      sanitizedGoals,
      normalizeRewardEvents(stored[STORAGE_KEYS.rewards]),
      Date.now()
    )
  };
}

async function clearActivity() {
  await storageSet({
    [STORAGE_KEYS.events]: [],
    [STORAGE_KEYS.rewards]: []
  });

  const stored = await storageGet({
    [STORAGE_KEYS.goals]: cloneGoals(DEFAULT_GOALS)
  });

  const goals = isValidGoals(stored[STORAGE_KEYS.goals]) ? stored[STORAGE_KEYS.goals] : cloneGoals(DEFAULT_GOALS);

  return {
    ok: true,
    dashboard: buildDashboard([], goals, [], Date.now())
  };
}

async function toggleWidgetOnTab(tab) {
  if (!tab || typeof tab.id !== "number") {
    return openExtensionPage("dashboard");
  }

  try {
    const response = await new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_WIDGET" }, (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        resolve(result);
      });
    });

    return response && typeof response === "object" ? response : { ok: true };
  } catch (error) {
    return openExtensionPage("dashboard");
  }
}

async function openExtensionPage(pageKey) {
  const relativePath = EXTENSION_PAGES[pageKey];

  if (!relativePath) {
    return { ok: false, error: "Unknown page" };
  }

  const url = chrome.runtime.getURL(relativePath);

  await new Promise((resolve, reject) => {
    chrome.tabs.create({ url }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve();
    });
  });

  return { ok: true, url };
}

function buildDashboard(events, goals, rewardEvents = [], now) {
  const windows = getTimeWindows(now);

  const dailyEvents = events.filter((event) => event.timestamp >= windows.daily);
  const weeklyEvents = events.filter((event) => event.timestamp >= windows.weekly);
  const monthlyEvents = events.filter((event) => event.timestamp >= windows.monthly);
  const yearlyEvents = events.filter((event) => event.timestamp >= windows.yearly);
  const dailyRewards = rewardEvents.filter((event) => event.timestamp >= windows.daily);
  const weeklyRewards = rewardEvents.filter((event) => event.timestamp >= windows.weekly);
  const monthlyRewards = rewardEvents.filter((event) => event.timestamp >= windows.monthly);
  const yearlyRewards = rewardEvents.filter((event) => event.timestamp >= windows.yearly);

  const periods = {
    daily: createPeriodSummary(dailyEvents, goals.daily, dailyRewards),
    weekly: createPeriodSummary(weeklyEvents, goals.weekly, weeklyRewards),
    monthly: createPeriodSummary(monthlyEvents, goals.monthly, monthlyRewards),
    yearly: createPeriodSummary(yearlyEvents, goals.yearly, yearlyRewards)
  };

  const allTime = createPeriodSummary(events, { post: 0, reply: 0 }, rewardEvents);

  return {
    periods,
    goals,
    streakDays: calculateStreak(events, now),
    siteBreakdown: buildSiteBreakdown(dailyEvents),
    allTime,
    level: calculateLevel(allTime.xp),
    analytics: buildAnalytics(events, rewardEvents, now),
    xpValues: { ...XP_VALUES },
    xpBonuses: { ...XP_BONUSES }
  };
}

function createPeriodSummary(events, goal, rewardEvents = []) {
  const posts = events.filter((event) => event.activityType === "post").length;
  const replies = events.filter((event) => event.activityType === "reply").length;
  const baseXp = sumXp(events);
  const bonusXp = sumXp(rewardEvents);
  const xp = baseXp + bonusXp;
  const normalizedGoal = {
    post: toGoalNumber(goal && goal.post),
    reply: toGoalNumber(goal && goal.reply)
  };
  const xpGoal = calculateGoalXp(normalizedGoal);

  return {
    posts,
    replies,
    totalActions: posts + replies,
    baseXp,
    bonusXp,
    xp,
    goal: {
      post: normalizedGoal.post,
      reply: normalizedGoal.reply,
      xp: xpGoal
    },
    progress: {
      post: calculateProgress(posts, normalizedGoal.post),
      reply: calculateProgress(replies, normalizedGoal.reply),
      xp: calculateProgress(xp, xpGoal)
    },
    remaining: {
      post: Math.max(normalizedGoal.post - posts, 0),
      reply: Math.max(normalizedGoal.reply - replies, 0),
      xp: Math.max(xpGoal - xp, 0)
    },
    bonuses: {
      total: bonusXp,
      goalTotal: rewardEvents
        .filter((event) => event.bonusType === "goal")
        .reduce((total, event) => total + event.xp, 0),
      dailyGoal: rewardEvents
        .filter((event) => event.bonusType === "goal" && event.scope === "daily")
        .reduce((total, event) => total + event.xp, 0),
      weeklyGoal: rewardEvents
        .filter((event) => event.bonusType === "goal" && event.scope === "weekly")
        .reduce((total, event) => total + event.xp, 0),
      monthlyGoal: rewardEvents
        .filter((event) => event.bonusType === "goal" && event.scope === "monthly")
        .reduce((total, event) => total + event.xp, 0),
      yearlyGoal: rewardEvents
        .filter((event) => event.bonusType === "goal" && event.scope === "yearly")
        .reduce((total, event) => total + event.xp, 0),
      overgoal: rewardEvents
        .filter((event) => event.bonusType === "overgoal")
        .reduce((total, event) => total + event.xp, 0),
      streak: rewardEvents
        .filter((event) => event.bonusType === "streak")
        .reduce((total, event) => total + event.xp, 0)
    }
  };
}

function buildSiteBreakdown(events) {
  const bySite = new Map();

  events.forEach((event) => {
    const existing = bySite.get(event.site) || {
      site: event.site,
      siteLabel: event.siteLabel || titleCase(event.site),
      posts: 0,
      replies: 0,
      xp: 0
    };

    if (event.activityType === "reply") {
      existing.replies += 1;
    } else {
      existing.posts += 1;
    }

    existing.xp += Number(event.xp) || 0;
    bySite.set(event.site, existing);
  });

  return [...bySite.values()].sort((left, right) => right.xp - left.xp);
}

function calculateLevel(totalXp) {
  let level = 1;
  let currentLevelXp = Math.max(0, Number(totalXp) || 0);
  let nextLevelXp = getLevelRequirement(level);

  while (currentLevelXp >= nextLevelXp) {
    currentLevelXp -= nextLevelXp;
    level += 1;
    nextLevelXp = getLevelRequirement(level);
  }

  return {
    level,
    totalXp,
    currentLevelXp,
    nextLevel: level + 1,
    nextLevelXp,
    remainingXp: Math.max(nextLevelXp - currentLevelXp, 0),
    progress: calculateProgress(currentLevelXp, nextLevelXp)
  };
}

function getLevelUp(previousLevel, nextLevel) {
  const previous = previousLevel && typeof previousLevel === "object" ? previousLevel : null;
  const next = nextLevel && typeof nextLevel === "object" ? nextLevel : null;

  if (!previous || !next || next.level <= previous.level) {
    return null;
  }

  return {
    fromLevel: previous.level,
    toLevel: next.level,
    gainedLevels: next.level - previous.level,
    totalXp: next.totalXp,
    nextLevel: next.nextLevel,
    remainingXp: next.remainingXp
  };
}

function getLevelRequirement(level) {
  const normalizedLevel = Math.max(1, Number(level) || 1);
  return Math.round(75 * Math.pow(1.03, normalizedLevel - 1) + 6 * (normalizedLevel - 1));
}

function buildAnalytics(events, rewardEvents, now) {
  return {
    daily: buildAnalyticsWindow(events, rewardEvents, createHourlyBuckets(now, 12)),
    weekly: buildAnalyticsWindow(events, rewardEvents, createDayBuckets(now, 7)),
    monthly: buildAnalyticsWindow(events, rewardEvents, createDayBuckets(now, 30)),
    yearly: buildAnalyticsWindow(events, rewardEvents, createMonthBuckets(now, 12))
  };
}

function buildAnalyticsWindow(events, rewardEvents, buckets) {
  const points = buckets.map((bucket) => ({
    key: bucket.key,
    label: bucket.label,
    shortLabel: bucket.shortLabel,
    xp: 0,
    posts: 0,
    replies: 0,
    totalActions: 0
  }));
  const byBucket = new Map(points.map((point) => [point.key, point]));
  const startTime = buckets.length > 0 ? buckets[0].start : 0;
  const inRangeEvents = events.filter((event) => event.timestamp >= startTime);
  const inRangeRewards = rewardEvents.filter((event) => event.timestamp >= startTime);

  inRangeEvents.forEach((event) => {
    const key = getBucketKeyForTimestamp(event.timestamp, buckets[0].granularity);
    const point = byBucket.get(key);

    if (!point) {
      return;
    }

    point.xp += Number(event.xp) || 0;
    point.totalActions += 1;

    if (event.activityType === "reply") {
      point.replies += 1;
    } else {
      point.posts += 1;
    }
  });

  inRangeRewards.forEach((event) => {
    const key = getBucketKeyForTimestamp(event.timestamp, buckets[0].granularity);
    const point = byBucket.get(key);

    if (!point) {
      return;
    }

    point.xp += Number(event.xp) || 0;
  });

  return {
    points,
    totals: createPeriodSummary(inRangeEvents, { post: 0, reply: 0 }, inRangeRewards),
    siteBreakdown: buildSiteBreakdown(inRangeEvents),
    maxXp: points.reduce((max, point) => Math.max(max, point.xp), 0)
  };
}

function deriveRewardEvents(events, goals) {
  const sortedEvents = [...events].sort((left, right) => left.timestamp - right.timestamp);
  const dayMap = new Map();
  const weekMap = new Map();
  const monthMap = new Map();
  const yearMap = new Map();

  sortedEvents.forEach((event) => {
    const dayKey = toDayKey(event.timestamp);
    const weekKey = toWeekKey(event.timestamp);
    const monthKey = toMonthKey(event.timestamp);
    const yearKey = toYearKey(event.timestamp);
    const dayStart = toDayStart(event.timestamp);
    const weekStart = toWeekStart(event.timestamp);
    const monthStart = toMonthStart(event.timestamp);
    const yearStart = toYearStart(event.timestamp);
    const dayGroup = dayMap.get(dayKey) || createRewardBucket(dayKey, dayStart);
    const weekGroup = weekMap.get(weekKey) || createRewardBucket(weekKey, weekStart);
    const monthGroup = monthMap.get(monthKey) || createRewardBucket(monthKey, monthStart);
    const yearGroup = yearMap.get(yearKey) || createRewardBucket(yearKey, yearStart);

    applyEventToRewardBucket(dayGroup, event);
    applyEventToRewardBucket(weekGroup, event);
    applyEventToRewardBucket(monthGroup, event);
    applyEventToRewardBucket(yearGroup, event);

    dayMap.set(dayKey, dayGroup);
    weekMap.set(weekKey, weekGroup);
    monthMap.set(monthKey, monthGroup);
    yearMap.set(yearKey, yearGroup);
  });

  return finalizeRewardEvents({
    dayGroups: [...dayMap.values()].sort((left, right) => left.start - right.start),
    weekGroups: [...weekMap.values()].sort((left, right) => left.start - right.start),
    monthGroups: [...monthMap.values()].sort((left, right) => left.start - right.start),
    yearGroups: [...yearMap.values()].sort((left, right) => left.start - right.start)
  }, goals);
}

function updateRewardEvents(events, existingRewards, goals, now) {
  const nextRewards = pruneRewardEvents(normalizeRewardEvents(existingRewards), now);
  const rewardIds = new Set(nextRewards.map((event) => event.id));
  const currentRewards = deriveCurrentRewardEvents(events, goals, now);

  currentRewards.forEach((event) => {
    if (!rewardIds.has(event.id)) {
      rewardIds.add(event.id);
      nextRewards.push(event);
    }
  });

  return nextRewards.sort((left, right) => left.timestamp - right.timestamp);
}

function finalizeRewardEvents(groups, goals) {
  const rewardEvents = [];
  const dayGroups = groups.dayGroups || [];
  let streak = 0;
  let previousDayStart = null;
  const difficultyMultiplier = calculateDifficultyMultiplier(goals.daily);

  dayGroups.forEach((group) => {
    const isConsecutive = previousDayStart !== null && areConsecutiveDays(previousDayStart, group.start);
    streak = isConsecutive ? streak + 1 : 1;
    previousDayStart = group.start;

    rewardEvents.push(...getDailyRewardEvents(group, streak, goals.daily, difficultyMultiplier));
  });

  (groups.weekGroups || []).forEach((group) => {
    const reward = getGoalRewardEvent("weekly", group, goals.weekly, difficultyMultiplier);

    if (reward) {
      rewardEvents.push(reward);
    }
  });

  (groups.monthGroups || []).forEach((group) => {
    const reward = getGoalRewardEvent("monthly", group, goals.monthly, difficultyMultiplier);

    if (reward) {
      rewardEvents.push(reward);
    }
  });

  (groups.yearGroups || []).forEach((group) => {
    const reward = getGoalRewardEvent("yearly", group, goals.yearly, difficultyMultiplier);

    if (reward) {
      rewardEvents.push(reward);
    }
  });

  return rewardEvents.sort((left, right) => left.timestamp - right.timestamp);
}

function deriveCurrentRewardEvents(events, goals, now) {
  const rewardEvents = [];
  const difficultyMultiplier = calculateDifficultyMultiplier(goals.daily);
  const dayStart = toDayStart(now);
  const weekStart = toWeekStart(now);
  const monthStart = toMonthStart(now);
  const yearStart = toYearStart(now);
  const dayGroup = createRewardBucketFromEvents(toDayKey(now), dayStart, events.filter((event) => event.timestamp >= dayStart));
  const weekGroup = createRewardBucketFromEvents(toWeekKey(now), weekStart, events.filter((event) => event.timestamp >= weekStart));
  const monthGroup = createRewardBucketFromEvents(toMonthKey(now), monthStart, events.filter((event) => event.timestamp >= monthStart));
  const yearGroup = createRewardBucketFromEvents(toYearKey(now), yearStart, events.filter((event) => event.timestamp >= yearStart));

  if (dayGroup) {
    rewardEvents.push(...getDailyRewardEvents(dayGroup, calculateStreak(events, now), goals.daily, difficultyMultiplier));
  }

  [weekGroup, monthGroup, yearGroup].forEach((group, index) => {
    if (!group) {
      return;
    }

    const scope = ["weekly", "monthly", "yearly"][index];
    const reward = getGoalRewardEvent(scope, group, goals[scope], difficultyMultiplier);

    if (reward) {
      rewardEvents.push(reward);
    }
  });

  return rewardEvents;
}

function getDailyRewardEvents(group, streakDays, dailyGoal, difficultyMultiplier) {
  const rewardEvents = [];
  const dailyGoalXp = calculateGoalXp(dailyGoal);

  if (dailyGoalXp > 0 && group.baseXp >= dailyGoalXp) {
    rewardEvents.push(createRewardEvent(
      "goal",
      "daily",
      scaleGoalBonus(XP_BONUSES.goal.daily, difficultyMultiplier),
      group
    ));
  }

  if (dailyGoalXp > 0) {
    XP_BONUSES.overgoal.forEach((threshold) => {
      if (group.baseXp >= dailyGoalXp * threshold.multiplier) {
        rewardEvents.push(createRewardEvent("overgoal", "daily", threshold.xp, group, threshold.key));
      }
    });
  }

  const streakXp = getStreakBonusXp(streakDays);

  if (streakXp > 0) {
    rewardEvents.push(createRewardEvent("streak", "daily", streakXp, group));
  }

  return rewardEvents;
}

function getGoalRewardEvent(scope, group, goal, difficultyMultiplier) {
  const goalXp = calculateGoalXp(goal);
  const baseBonus = XP_BONUSES.goal[scope];

  if (goalXp <= 0 || group.baseXp < goalXp || !Number.isFinite(baseBonus)) {
    return null;
  }

  return createRewardEvent("goal", scope, scaleGoalBonus(baseBonus, difficultyMultiplier), group);
}

function createRewardBucketFromEvents(key, start, events) {
  if (!Array.isArray(events) || events.length === 0) {
    return null;
  }

  const bucket = createRewardBucket(key, start);
  events.forEach((event) => {
    applyEventToRewardBucket(bucket, event);
  });
  return bucket;
}

function createRewardBucket(key, start) {
  return {
    key,
    start,
    lastTimestamp: start,
    posts: 0,
    replies: 0,
    baseXp: 0
  };
}

function applyEventToRewardBucket(bucket, event) {
  bucket.lastTimestamp = Math.max(bucket.lastTimestamp, event.timestamp);
  bucket.baseXp += Number(event.xp) || 0;

  if (event.activityType === "reply") {
    bucket.replies += 1;
  } else {
    bucket.posts += 1;
  }
}

function createRewardEvent(bonusType, scope, xp, bucket, suffix = "") {
  const normalizedSuffix = suffix ? `-${suffix}` : "";

  return {
    id: `${bonusType}-${scope}-${bucket.key}${normalizedSuffix}`,
    bonusType,
    scope,
    xp,
    timestamp: bucket.lastTimestamp
  };
}

function calculateGoalXp(goal) {
  const normalizedGoal = goal && typeof goal === "object" ? goal : { post: 0, reply: 0 };
  return toGoalNumber(normalizedGoal.post) * XP_VALUES.post + toGoalNumber(normalizedGoal.reply) * XP_VALUES.reply;
}

function calculateDifficultyMultiplier(dailyGoal) {
  const baselineGoalXp = calculateGoalXp(DEFAULT_GOALS.daily);
  const dailyGoalXp = calculateGoalXp(dailyGoal);

  if (baselineGoalXp <= 0 || dailyGoalXp <= 0) {
    return 1;
  }

  const rawMultiplier = Math.sqrt(dailyGoalXp / baselineGoalXp);
  return clamp(rawMultiplier, XP_BONUSES.difficulty.min, XP_BONUSES.difficulty.max);
}

function scaleGoalBonus(baseBonus, multiplier) {
  return Math.max(1, Math.round(baseBonus * multiplier));
}

function getStreakBonusXp(streakDays) {
  const tier = XP_BONUSES.streak.find((entry) => streakDays >= entry.days);
  return tier ? tier.xp : 0;
}

function sumXp(entries) {
  return entries.reduce((total, entry) => total + (Number(entry.xp) || 0), 0);
}

function createHourlyBuckets(now, count) {
  const end = new Date(now);
  end.setMinutes(0, 0, 0);
  const buckets = [];

  for (let index = count - 1; index >= 0; index -= 1) {
    const start = new Date(end);
    start.setHours(end.getHours() - index);
    const hour = start.getHours();

    buckets.push({
      key: getBucketKeyForTimestamp(start.getTime(), "hour"),
      label: formatHourLabel(start),
      shortLabel: hour === 0 ? "12a" : hour < 12 ? `${hour}a` : hour === 12 ? "12p" : `${hour - 12}p`,
      start: start.getTime(),
      granularity: "hour"
    });
  }

  return buckets;
}

function createDayBuckets(now, count) {
  const end = new Date(now);
  end.setHours(0, 0, 0, 0);
  const buckets = [];

  for (let index = count - 1; index >= 0; index -= 1) {
    const start = new Date(end);
    start.setDate(end.getDate() - index);

    buckets.push({
      key: getBucketKeyForTimestamp(start.getTime(), "day"),
      label: formatDayLabel(start),
      shortLabel: start.toLocaleDateString(undefined, { weekday: "short" }),
      start: start.getTime(),
      granularity: "day"
    });
  }

  return buckets;
}

function createMonthBuckets(now, count) {
  const end = new Date(now);
  end.setDate(1);
  end.setHours(0, 0, 0, 0);
  const buckets = [];

  for (let index = count - 1; index >= 0; index -= 1) {
    const start = new Date(end);
    start.setMonth(end.getMonth() - index);

    buckets.push({
      key: getBucketKeyForTimestamp(start.getTime(), "month"),
      label: start.toLocaleDateString(undefined, { month: "long", year: "numeric" }),
      shortLabel: start.toLocaleDateString(undefined, { month: "short" }),
      start: start.getTime(),
      granularity: "month"
    });
  }

  return buckets;
}

function getBucketKeyForTimestamp(timestamp, granularity) {
  const date = new Date(timestamp);

  if (granularity === "hour") {
    return `${toDayKey(timestamp)}-${String(date.getHours()).padStart(2, "0")}`;
  }

  if (granularity === "month") {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }

  return toDayKey(timestamp);
}

function formatHourLabel(date) {
  return date.toLocaleTimeString(undefined, {
    hour: "numeric"
  });
}

function formatDayLabel(date) {
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric"
  });
}

function calculateStreak(events, now) {
  const dayKeys = new Set(
    events.map((event) => {
      return toDayKey(event.timestamp);
    })
  );

  const cursor = new Date(now);
  cursor.setHours(0, 0, 0, 0);

  let streak = 0;

  while (dayKeys.has(toDayKey(cursor.getTime()))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return streak;
}

function getTimeWindows(now) {
  const current = new Date(now);

  const daily = new Date(current);
  daily.setHours(0, 0, 0, 0);

  const weekly = new Date(daily);
  weekly.setDate(weekly.getDate() - weekly.getDay());

  const monthly = new Date(daily);
  monthly.setDate(1);

  const yearly = new Date(daily);
  yearly.setMonth(0, 1);

  return {
    daily: daily.getTime(),
    weekly: weekly.getTime(),
    monthly: monthly.getTime(),
    yearly: yearly.getTime()
  };
}

function calculateProgress(value, goal) {
  if (goal <= 0) {
    return value > 0 ? 1 : 0;
  }

  return Math.max(0, Math.min(value / goal, 1));
}

function normalizeEvents(events) {
  if (!Array.isArray(events)) {
    return [];
  }

  return events.filter((event) => {
    return (
      event &&
      typeof event === "object" &&
      typeof event.timestamp === "number" &&
      typeof event.site === "string" &&
      (event.activityType === "post" || event.activityType === "reply")
    );
  });
}

function normalizeRewardEvents(rewardEvents) {
  if (!Array.isArray(rewardEvents)) {
    return [];
  }

  return rewardEvents.filter((event) => {
    return (
      event &&
      typeof event === "object" &&
      typeof event.id === "string" &&
      typeof event.timestamp === "number" &&
      typeof event.xp === "number" &&
      typeof event.bonusType === "string" &&
      typeof event.scope === "string"
    );
  });
}

function pruneEvents(events, now) {
  const cutoff = now - MAX_EVENT_AGE_DAYS * 24 * 60 * 60 * 1000;

  return events.filter((event) => event.timestamp >= cutoff);
}

function pruneRewardEvents(rewardEvents, now) {
  const cutoff = now - MAX_EVENT_AGE_DAYS * 24 * 60 * 60 * 1000;

  return rewardEvents.filter((event) => event.timestamp >= cutoff);
}

function sanitizeGoals(goals) {
  const source = goals && typeof goals === "object" ? goals : {};
  const sanitized = {};

  PERIODS.forEach((period) => {
    const fallback = DEFAULT_GOALS[period];
    const current = source[period] && typeof source[period] === "object" ? source[period] : {};

    sanitized[period] = {
      post: toGoalNumber(current.post, fallback.post),
      reply: toGoalNumber(current.reply, fallback.reply)
    };
  });

  return sanitized;
}

function isValidGoals(goals) {
  return Boolean(
    goals &&
      typeof goals === "object" &&
      PERIODS.every((period) => {
        return goals[period] && typeof goals[period] === "object";
      })
  );
}

function cloneGoals(goals) {
  return sanitizeGoals(goals);
}

function goalsEqual(left, right) {
  if (!isValidGoals(left) || !isValidGoals(right)) {
    return false;
  }

  return PERIODS.every((period) => {
    return left[period].post === right[period].post && left[period].reply === right[period].reply;
  });
}

function toGoalNumber(value, fallback) {
  const nextValue = Number.parseInt(value, 10);

  if (Number.isFinite(nextValue) && nextValue >= 0) {
    return nextValue;
  }

  return Number.isFinite(fallback) ? fallback : 0;
}

function normalizeFingerprint(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().slice(0, 180);
}

function toDayKey(timestamp) {
  const date = new Date(toDayStart(timestamp));
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function toWeekKey(timestamp) {
  return toDayKey(toWeekStart(timestamp));
}

function toMonthKey(timestamp) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function toYearKey(timestamp) {
  return String(new Date(timestamp).getFullYear());
}

function toDayStart(timestamp) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function toWeekStart(timestamp) {
  const date = new Date(toDayStart(timestamp));
  date.setDate(date.getDate() - date.getDay());
  return date.getTime();
}

function toMonthStart(timestamp) {
  const date = new Date(toDayStart(timestamp));
  date.setDate(1);
  return date.getTime();
}

function toYearStart(timestamp) {
  const date = new Date(toDayStart(timestamp));
  date.setMonth(0, 1);
  return date.getTime();
}

function areConsecutiveDays(previousStart, currentStart) {
  const next = new Date(previousStart);
  next.setDate(next.getDate() + 1);
  return toDayKey(next.getTime()) === toDayKey(currentStart);
}

function titleCase(value) {
  return String(value)
    .split(/[\s_-]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function storageGet(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (items) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve(items);
    });
  });
}

function storageSet(items) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(items, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve();
    });
  });
}
