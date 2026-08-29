import { addDays, format, getDay, parseISO } from "date-fns";

export type PersonCaps = {
  dailyCapacity: number;
  dailyTaskLimit: number;
  weekdayCapacities?: string | null;
  weekdayTaskLimits?: string | null;
  weekendShare?: boolean;
  weekendCapacity?: number;
  weekendTaskLimit?: number;
};

function clampCap(n: number) {
  return Math.min(20, Math.max(0, Math.round(Number(n)) || 0));
}

export function parseWeek(raw: string | null | undefined, fallback: number): number[] {
  const parts = (raw ?? "").split(",").map((s) => Math.round(Number(s.trim())));
  const v = clampCap(fallback);
  if ((parts.length === 7 || parts.length === 5) && parts.every((n) => Number.isFinite(n))) {
    const week = parts.map(clampCap);
    while (week.length < 7) week.push(v);
    return week;
  }
  return [v, v, v, v, v, v, v];
}

export function encodeWeek(values: number[]): string {
  const next = values.slice(0, 7).map(clampCap);
  while (next.length < 7) next.push(next[next.length - 1] ?? 0);
  return next.join(",");
}

export function weekdayIndex(date: Date | string): number | null {
  const d = typeof date === "string" ? parseISO(`${date}T12:00:00`) : date;
  const dow = getDay(d);
  if (dow === 0 || dow === 6) return null;
  return dow - 1;
}

export function isWeekendDate(date: Date | string) {
  return weekdayIndex(date) === null;
}

export function personWeekendOn(person: PersonCaps) {
  return person.weekendShare !== false;
}

export function personWeekendPot(person: PersonCaps) {
  return {
    pts: person.weekendCapacity ?? 6,
    tasks: person.weekendTaskLimit ?? 4,
  };
}

export function personCapOnDate(person: PersonCaps, date: Date | string) {
  const idx = weekdayIndex(date);
  if (idx === null) {
    if (personWeekendOn(person)) return personWeekendPot(person);
    const d = typeof date === "string" ? parseISO(`${date}T12:00:00`) : date;
    const slot = getDay(d) === 6 ? 5 : 6;
    return {
      pts: parseWeek(person.weekdayCapacities, person.dailyCapacity)[slot],
      tasks: parseWeek(person.weekdayTaskLimits, person.dailyTaskLimit)[slot],
    };
  }
  return {
    pts: parseWeek(person.weekdayCapacities, person.dailyCapacity)[idx],
    tasks: parseWeek(person.weekdayTaskLimits, person.dailyTaskLimit)[idx],
  };
}

export function capacityLoad<T extends { completedAt: Date | null; task: { oneOff: boolean } }>(
  rows: T[],
  pointsFor: (row: T) => number,
) {
  const catalog = rows.filter((row) => row.completedAt === null && !row.task.oneOff);
  return {
    pts: catalog.reduce((sum, row) => sum + pointsFor(row), 0),
    tasks: catalog.length,
  };
}

export function weekendPair(dateStr: string) {
  const d = parseISO(`${dateStr}T12:00:00`);
  const dow = getDay(d);
  if (dow === 6) return { sat: dateStr, sun: format(addDays(d, 1), "yyyy-MM-dd") };
  if (dow === 0) return { sat: format(addDays(d, -1), "yyyy-MM-dd"), sun: dateStr };
  return null;
}

export function weekendFillRemaining(
  date: string,
  pot: { pts: number; tasks: number },
  sat: { pts: number; tasks: number },
  sun: { pts: number; tasks: number },
) {
  const pair = weekendPair(date);
  if (!pair) return { pts: 0, tasks: 0 };
  if (date === pair.sat) {
    return { pts: pot.pts - sat.pts, tasks: pot.tasks - sat.tasks };
  }
  return { pts: pot.pts - sat.pts - sun.pts, tasks: pot.tasks - sat.tasks - sun.tasks };
}

export function overflowNextDate(dateStr: string, weekendShare: boolean) {
  const d = parseISO(`${dateStr}T12:00:00`);
  if (weekendShare && isWeekendDate(d)) {
    return format(addDays(d, getDay(d) === 6 ? 2 : 1), "yyyy-MM-dd");
  }
  return format(addDays(d, 1), "yyyy-MM-dd");
}

export function weekCapacity(people: PersonCaps[]) {
  let pts = 0;
  let tasks = 0;
  for (const person of people) {
    const ptsDays = parseWeek(person.weekdayCapacities, person.dailyCapacity);
    const taskDays = parseWeek(person.weekdayTaskLimits, person.dailyTaskLimit);
    pts += ptsDays.slice(0, 5).reduce((s, n) => s + n, 0);
    tasks += taskDays.slice(0, 5).reduce((s, n) => s + n, 0);
    if (personWeekendOn(person)) {
      const pot = personWeekendPot(person);
      pts += pot.pts;
      tasks += pot.tasks;
    } else {
      pts += ptsDays[5] + ptsDays[6];
      tasks += taskDays[5] + taskDays[6];
    }
  }
  return { pts, tasks };
}
