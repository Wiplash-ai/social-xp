import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(projectRoot, "background.js"), "utf8");

const chromeStub = {
  runtime: {
    onInstalled: { addListener() {} },
    onStartup: { addListener() {} },
    onMessage: { addListener() {} },
    openOptionsPage() {},
    lastError: null,
    getURL(value) {
      return value;
    }
  },
  action: {
    onClicked: { addListener() {} }
  },
  storage: {
    local: {
      get(_keys, callback) {
        callback({});
      },
      set(_items, callback) {
        if (callback) {
          callback();
        }
      }
    }
  },
  tabs: {
    sendMessage(_tabId, _message, callback) {
      callback({ ok: true });
    },
    create(_options, callback) {
      callback({});
    }
  }
};

const context = vm.createContext({
  console,
  chrome: chromeStub,
  crypto: {
    randomUUID() {
      return "test-uuid";
    }
  },
  setTimeout,
  clearTimeout,
  Math,
  Date,
  Promise,
  Number,
  String,
  Boolean,
  Array,
  Map,
  Set,
  Object,
  JSON,
  RegExp
});

new vm.Script(`
${source}
globalThis.__testExports = {
  DEFAULT_GOALS,
  XP_VALUES,
  calculateGoalXp,
  calculateDifficultyMultiplier,
  getStreakBonusXp,
  getLevelRequirement,
  calculateLevel,
  deriveRewardEvents,
  updateRewardEvents
};
`).runInContext(context);

const api = context.__testExports;

function createEvent(dayOffset, activityType, sequence) {
  const timestamp = new Date(2026, 2, 22 + dayOffset, 12, sequence, 0, 0).getTime();

  return {
    id: `${activityType}-${dayOffset}-${sequence}`,
    site: "x",
    siteLabel: "X",
    activityType,
    source: "test",
    fingerprint: `${activityType}-${dayOffset}-${sequence}`,
    xp: api.XP_VALUES[activityType],
    timestamp
  };
}

function createDailyGoalEvents(dayOffset, posts = 3, replies = 6) {
  const events = [];

  for (let index = 0; index < posts; index += 1) {
    events.push(createEvent(dayOffset, "post", index));
  }

  for (let index = 0; index < replies; index += 1) {
    events.push(createEvent(dayOffset, "reply", posts + index));
  }

  return events;
}

function countRewards(rewardEvents, bonusType, scope) {
  return rewardEvents.filter((event) => event.bonusType === bonusType && event.scope === scope).length;
}

test("default daily goal XP baseline is 108", () => {
  assert.equal(api.calculateGoalXp(api.DEFAULT_GOALS.daily), 108);
});

test("difficulty multiplier stays within the designed clamps", () => {
  assert.equal(api.calculateDifficultyMultiplier(api.DEFAULT_GOALS.daily), 1);
  assert.equal(api.calculateDifficultyMultiplier({ post: 0, reply: 1 }), 0.75);
  assert.equal(api.calculateDifficultyMultiplier({ post: 40, reply: 120 }), 1.35);
});

test("streak bonus uses the 3/7/14/30 day tiers", () => {
  assert.equal(api.getStreakBonusXp(1), 0);
  assert.equal(api.getStreakBonusXp(3), 5);
  assert.equal(api.getStreakBonusXp(7), 10);
  assert.equal(api.getStreakBonusXp(14), 15);
  assert.equal(api.getStreakBonusXp(30), 20);
});

test("level curve ramps and level calculation advances correctly", () => {
  assert.equal(api.getLevelRequirement(1), 75);
  assert.ok(api.getLevelRequirement(10) > api.getLevelRequirement(3));
  assert.equal(api.calculateLevel(74).level, 1);
  assert.equal(api.calculateLevel(75).level, 2);
});

test("weekly reward derivation grants daily, weekly, and streak rewards", () => {
  const events = Array.from({ length: 7 }, (_, index) => createDailyGoalEvents(index)).flat();
  const rewards = api.deriveRewardEvents(events, api.DEFAULT_GOALS);

  assert.equal(countRewards(rewards, "goal", "daily"), 7);
  assert.equal(countRewards(rewards, "goal", "weekly"), 1);
  assert.equal(countRewards(rewards, "streak", "daily"), 5);
  assert.equal(countRewards(rewards, "overgoal", "daily"), 0);

  const streakXp = rewards
    .filter((event) => event.bonusType === "streak")
    .reduce((total, event) => total + event.xp, 0);

  assert.equal(streakXp, 30);
});

test("overgoal rewards stack at 125%, 150%, and 200% of the daily target", () => {
  const events = [...createDailyGoalEvents(0, 7, 10)];
  const rewards = api.deriveRewardEvents(events, api.DEFAULT_GOALS);

  assert.equal(countRewards(rewards, "goal", "daily"), 1);
  assert.equal(countRewards(rewards, "overgoal", "daily"), 3);
});

test("stored reward events are not rewritten when goals change later", () => {
  const events = createDailyGoalEvents(0);
  const existingRewards = api.deriveRewardEvents(events, api.DEFAULT_GOALS);
  const changedGoals = {
    ...api.DEFAULT_GOALS,
    daily: { post: 20, reply: 20 }
  };
  const updatedRewards = api.updateRewardEvents(
    events,
    existingRewards,
    changedGoals,
    new Date(2026, 2, 22, 18, 0, 0, 0).getTime()
  );

  const existingDailyGoalReward = existingRewards.find((event) => event.bonusType === "goal" && event.scope === "daily");
  const updatedDailyGoalReward = updatedRewards.find((event) => event.id === existingDailyGoalReward.id);

  assert.ok(updatedDailyGoalReward);
  assert.equal(updatedDailyGoalReward.xp, existingDailyGoalReward.xp);
});
