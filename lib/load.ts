import { displayTaskDifficulty, isCatchUpTask } from "./addon";
import { weekCapacity, type PersonCaps } from "./capacity";

export type LoadTask = {
  difficulty: number;
  frequencyDays: number;
  lastDoneAt?: Date | string | null;
  oneOff?: boolean;
  addonName?: string | null;
  addonFrequencyDays?: number | null;
  addonPoints?: number | null;
  addonLastDoneAt?: Date | string | null;
  addon2Name?: string | null;
  addon2FrequencyDays?: number | null;
  addon2Points?: number | null;
  addon2LastDoneAt?: Date | string | null;
};

function addonOn(task: LoadTask) {
  return Boolean(task.addonName?.trim()) && (task.addonFrequencyDays ?? 0) > 0;
}

function addon2On(task: LoadTask) {
  return addonOn(task) && Boolean(task.addon2Name?.trim()) && (task.addon2FrequencyDays ?? 0) > 0;
}

export type LoadPerson = PersonCaps;

export function taskPointLoadPerDay(task: LoadTask) {
  if (task.oneOff || task.frequencyDays <= 0) return 0;
  const base = task.difficulty / task.frequencyDays;
  const addonDays = task.addonFrequencyDays ?? 0;
  const extra = addonOn(task) && addonDays > 0 ? Math.max(1, task.addonPoints ?? 1) / addonDays : 0;
  const addon2Days = task.addon2FrequencyDays ?? 0;
  const extra2 = addon2On(task) && addon2Days > 0 ? Math.max(1, task.addon2Points ?? 1) / addon2Days : 0;
  return base + extra + extra2;
}

export function taskCountLoadPerDay(task: LoadTask) {
  if (task.oneOff || task.frequencyDays <= 0) return 0;
  return 1 / task.frequencyDays;
}

export function householdLoad(tasks: LoadTask[], people: LoadPerson[], asOf: Date = new Date()) {
  const catalog = tasks.filter((t) => !t.oneOff);
  const needPtsDay = catalog.reduce((s, t) => s + taskPointLoadPerDay(t), 0);
  const needTasksDay = catalog.reduce((s, t) => s + taskCountLoadPerDay(t), 0);
  const weekCap = weekCapacity(people);
  // Catalog-wide past due (never done included). Due today and Today's list are not this count.
  const overdue = catalog.filter((t) => isCatchUpTask(t, asOf));
  const needPts = needPtsDay * 7;
  const needTasks = needTasksDay * 7;
  // Point cap is a ceiling. A 6-pt / 3-task day usually fills seats × catalog average, not 6.
  const avgPts = needTasksDay > 0 ? needPtsDay / needTasksDay : 1;
  const typicalPts = Math.min(weekCap.pts, weekCap.tasks * avgPts);
  const leftoverPts = typicalPts - needPts;
  const leftoverTasks = weekCap.tasks - needTasks;
  const catchUpPts = overdue.reduce((s, t) => s + displayTaskDifficulty(t, asOf), 0);
  const catchUpTasks = overdue.length;
  const byPts = leftoverPts > 0.05 ? (catchUpPts / leftoverPts) * 7 : Number.POSITIVE_INFINITY;
  const byTasks = leftoverTasks > 0.05 ? (catchUpTasks / leftoverTasks) * 7 : Number.POSITIVE_INFINITY;
  const days = Math.max(byPts, byTasks);

  return {
    taskCount: catalog.length,
    week: {
      needPts,
      capPts: weekCap.pts,
      needTasks,
      capTasks: weekCap.tasks,
      typicalPts,
    },
    day: {
      needPts: needPtsDay,
      capPts: weekCap.pts / 7,
      needTasks: needTasksDay,
      capTasks: weekCap.tasks / 7,
    },
    catchUp: {
      pts: catchUpPts,
      tasks: catchUpTasks,
      days: Number.isFinite(days) ? days : null,
    },
  };
}
