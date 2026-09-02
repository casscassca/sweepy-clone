import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  desiccantRemainingDays,
  previousFilterLastDone,
  shouldSyncRfidDesiccant,
} from "./petlibro";

const asOf = new Date("2026-09-01T12:00:00-05:00");

describe("petlibro desiccant sync", () => {
  it("fires when the filter add-on is due on Reset wet food", () => {
    const task = {
      name: "Reset wet food",
      addonName: "clean setup",
      addonFrequencyDays: 6,
      addonLastDoneAt: new Date("2026-08-20T12:00:00-05:00"),
      addon2Name: "replace food/water filters",
      addon2FrequencyDays: 30,
      addon2LastDoneAt: new Date("2026-08-01T12:00:00-05:00"),
    };
    assert.equal(shouldSyncRfidDesiccant(task, asOf), true);
  });

  it("skips when the filter add-on is not due yet", () => {
    const task = {
      name: "Reset wet food",
      addon2Name: "replace food/water filters",
      addon2FrequencyDays: 30,
      addon2LastDoneAt: new Date("2026-08-25T12:00:00-05:00"),
    };
    assert.equal(shouldSyncRfidDesiccant(task, asOf), false);
  });

  it("fires for a standalone task with that name", () => {
    assert.equal(
      shouldSyncRfidDesiccant({ name: "Replace Food/Water Filters" }, asOf),
      true,
    );
  });

  it("leaves 23 days when the filter was changed a week ago on a 30-day cycle", () => {
    assert.equal(
      desiccantRemainingDays(new Date("2026-08-25T12:00:00-05:00"), 30, asOf),
      23,
    );
  });

  it("leaves the full cycle when changed today", () => {
    assert.equal(desiccantRemainingDays(asOf, 30, asOf), 30);
  });

  it("rebuilds the previous filter last-done across wet-food completions", () => {
    const completions = [
      new Date("2026-07-01T12:00:00-05:00"),
      new Date("2026-07-04T12:00:00-05:00"),
      new Date("2026-07-07T12:00:00-05:00"),
      new Date("2026-08-01T12:00:00-05:00"),
      new Date("2026-08-04T12:00:00-05:00"),
    ];
    assert.equal(
      previousFilterLastDone(completions, 30)?.toISOString(),
      new Date("2026-08-01T12:00:00-05:00").toISOString(),
    );
  });
});
