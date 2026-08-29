import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isAllowedOnDate, nextAllowedOnOrAfter } from "./allowed-days";
import { capacityLoad, overflowNextDate, weekendFillRemaining } from "./capacity";
import { cleanlinessPct, dirtWord, dirtinessRatio, dueDayStr, dueOnAllowedDay, isDirtyEnough } from "./dirtiness";
import { daysForFrequency } from "./frequency";
import { personAway, returnDay } from "./vacation";

const WED = "3";
const lastWed = new Date("2026-08-12T12:00:00-05:00");

describe("capacity load", () => {
  it("ignores completed and one-off assignments", () => {
    const rows = [
      { completedAt: new Date("2026-08-29T12:00:00-05:00"), task: { oneOff: false }, points: 3 },
      { completedAt: null, task: { oneOff: false }, points: 2 },
      { completedAt: null, task: { oneOff: true }, points: 3 },
    ];
    assert.deepEqual(capacityLoad(rows, (row) => row.points), { pts: 2, tasks: 1 });
  });
});

describe("weekend fill remaining", () => {
  const pot = { pts: 16, tasks: 6 };
  const sat = { pts: 4, tasks: 1 };
  const sun = { pts: 3, tasks: 1 };

  it("lets Saturday use the full pot, ignoring Sunday seats", () => {
    const rem = weekendFillRemaining("2026-08-29", pot, sat, sun);
    assert.equal(rem.tasks, 5);
    assert.equal(rem.pts, 12);
  });

  it("counts Saturday plus Sunday once Sunday is being filled", () => {
    const rem = weekendFillRemaining("2026-08-30", pot, sat, sun);
    assert.equal(rem.tasks, 4);
    assert.equal(rem.pts, 9);
  });
});

describe("weekly Wednesday-only", () => {
  it("lands every Wednesday and never Thursday", () => {
    const due = dueOnAllowedDay(lastWed, daysForFrequency(1, "week"), WED, "2026-08-13", "2026-09-09");
    assert.equal(due, "2026-08-19");
    assert.equal(isAllowedOnDate(WED, due!), true);
    assert.equal(isAllowedOnDate(WED, "2026-08-20"), false);
  });

  it("skips a missed Wednesday to the next Wednesday", () => {
    const due = dueOnAllowedDay(lastWed, 7, WED, "2026-08-20", "2026-09-09");
    assert.equal(due, "2026-08-26");
  });

  it("overflows off Wednesday onto the next Wednesday", () => {
    const dest = nextAllowedOnOrAfter(WED, overflowNextDate("2026-08-19", false));
    assert.equal(dest, "2026-08-26");
  });

  it("unparks from vacation onto the next allowed day", () => {
    const person = { vacationOn: true, vacationStart: "2026-08-19", vacationEnd: "2026-08-21" };
    const house = { houseVacation: false, houseVacationStart: "", houseVacationEnd: "" };
    assert.equal(personAway(person, house, "2026-08-19"), true);
    const back = returnDay(person, house, "2026-08-19");
    assert.equal(back, "2026-08-22");
    assert.equal(nextAllowedOnOrAfter(WED, back!), "2026-08-26");
  });
});

describe("every three days", () => {
  const lastMon = new Date("2026-08-17T23:30:00-05:00");

  it("shows up three calendar days later", () => {
    assert.equal(dueDayStr(lastMon, 3), "2026-08-20");
    assert.equal(dirtinessRatio(lastMon, 3, new Date("2026-08-20T12:00:00-05:00")), 1);
  });

  it("stays hidden for due-only until that day, but peeks early otherwise", () => {
    const tue = new Date("2026-08-18T12:00:00-05:00");
    assert.equal(isDirtyEnough(lastMon, 3, tue, false), true);
    assert.equal(isDirtyEnough(lastMon, 3, tue, true), false);
    assert.equal(isDirtyEnough(lastMon, 3, new Date("2026-08-20T12:00:00-05:00"), true), true);
  });

  it("snaps a Thursday due date to Wednesday when only Wednesday is allowed", () => {
    assert.equal(dueOnAllowedDay(lastMon, 3, WED, "2026-08-18", "2026-09-09"), "2026-08-26");
  });
});

describe("room bar at due", () => {
  it("stays nearly full when a chore is only just due", () => {
    assert.equal(cleanlinessPct(1), 88);
    assert.ok(cleanlinessPct(2) < 50);
  });

  it("calls past-due what catch-up counts, not due or filthy", () => {
    assert.equal(dirtWord(1), "due");
    assert.equal(dirtWord(1.2), "past due");
    assert.equal(dirtWord(2), "filthy");
  });
});
