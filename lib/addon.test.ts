import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addonFields, displayTaskDifficulty, displayTaskName, isAddon2Due, isAddonDue, isCatchUpTask, isDueToday, isTaskEligible } from "./addon";

const asOf = new Date("2026-08-19T12:00:00-05:00");

describe("due vs overdue", () => {
  it("treats the due day as due today, not overdue", () => {
    const task = { difficulty: 2, frequencyDays: 7, lastDoneAt: new Date("2026-08-12T12:00:00-05:00") };
    assert.equal(isDueToday(task, asOf), true);
    assert.equal(isCatchUpTask(task, asOf), false);
  });

  it("treats past the due day as overdue, not due today", () => {
    const task = { difficulty: 2, frequencyDays: 7, lastDoneAt: new Date("2026-08-11T12:00:00-05:00") };
    assert.equal(isDueToday(task, asOf), false);
    assert.equal(isCatchUpTask(task, asOf), true);
  });

  it("treats never done as overdue", () => {
    const task = { difficulty: 2, frequencyDays: 7, lastDoneAt: null };
    assert.equal(isDueToday(task, asOf), false);
    assert.equal(isCatchUpTask(task, asOf), true);
  });
});

describe("nested add-on", () => {
  const food = {
    name: "Reset wet food",
    difficulty: 1,
    frequencyDays: 3,
    lastDoneAt: new Date("2026-08-16T12:00:00-05:00"),
    dueOnly: true,
    addonName: "clean filter",
    addonFrequencyDays: 6,
    addonPoints: 1,
    addonLastDoneAt: new Date("2026-08-13T12:00:00-05:00"),
    addon2Name: "replace filter",
    addon2FrequencyDays: 30,
    addon2Points: 2,
    addon2LastDoneAt: new Date("2026-07-20T12:00:00-05:00"),
  };

  it("names the full stack when the second add-on is due", () => {
    assert.equal(displayTaskName(food, asOf), "Reset wet food, clean filter, and replace filter");
    assert.equal(isTaskEligible(food, asOf), true);
  });

  it("keeps due-only on the main chore and still lets a nested add-on surface the row", () => {
    const onlyStack = {
      ...food,
      lastDoneAt: new Date("2026-08-18T12:00:00-05:00"),
      addonLastDoneAt: new Date("2026-08-18T12:00:00-05:00"),
    };
    assert.equal(isAddonDue(onlyStack, asOf), false);
    assert.equal(isAddon2Due(onlyStack, asOf), true);
    assert.equal(isTaskEligible(onlyStack, asOf), true);
  });

  it("drops the second add-on when the first is off", () => {
    const parsed = addonFields({ addonName: "", addon2Name: "replace filter", addon2FrequencyDays: 30 });
    assert.equal(parsed.addon2Name, "");
    assert.equal(parsed.addon2FrequencyDays, 0);
  });

  it("lets an add-on be worth zero points", () => {
    const parsed = addonFields({ addonName: "clean filter", addonFrequencyDays: 6, addonPoints: 0 });
    assert.equal(parsed.addonPoints, 0);
    const zeroExtra = { ...food, addonPoints: 0, addon2Name: "", addon2FrequencyDays: 0 };
    assert.equal(displayTaskDifficulty(zeroExtra, asOf), 1);
  });
});
