import { dirtinessRatio, isDirtyEnough } from "./dirtiness";
import { formatFrequency } from "./frequency";

export type AddonFields = {
  name?: string;
  difficulty?: number;
  lastDoneAt?: Date | string | null;
  frequencyDays?: number;
  dueOnly?: boolean;
  addonName?: string | null;
  addonFrequencyDays?: number | null;
  addonPoints?: number | null;
  addonLastDoneAt?: Date | string | null;
  addon2Name?: string | null;
  addon2FrequencyDays?: number | null;
  addon2Points?: number | null;
  addon2LastDoneAt?: Date | string | null;
};

function layerDue(
  lastDoneAt: Date | string | null | undefined,
  frequencyDays: number | null | undefined,
  asOf: Date,
  threshold: number,
) {
  const days = frequencyDays ?? 0;
  if (days <= 0) return false;
  return dirtinessRatio(lastDoneAt ?? null, days, asOf) >= threshold;
}

function near(a: Date | string, b: Date | string, ms: number) {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) < ms;
}

export function hasAddon(task: AddonFields) {
  return Boolean(task.addonName?.trim()) && (task.addonFrequencyDays ?? 0) > 0;
}

export function hasAddon2(task: AddonFields) {
  return hasAddon(task) && Boolean(task.addon2Name?.trim()) && (task.addon2FrequencyDays ?? 0) > 0;
}

export function isAddonDue(task: AddonFields, asOf: Date = new Date()) {
  if (!hasAddon(task)) return false;
  return layerDue(task.addonLastDoneAt, task.addonFrequencyDays, asOf, 1);
}

export function isAddon2Due(task: AddonFields, asOf: Date = new Date()) {
  if (!hasAddon2(task)) return false;
  return layerDue(task.addon2LastDoneAt, task.addon2FrequencyDays, asOf, 1);
}

export function isCatchUpTask(task: AddonFields, asOf?: Date) {
  const when = asOf ?? new Date();
  if (dirtinessRatio(task.lastDoneAt ?? null, task.frequencyDays ?? 0, when) > 1) return true;
  if (hasAddon(task) && dirtinessRatio(task.addonLastDoneAt ?? null, task.addonFrequencyDays ?? 0, when) > 1) return true;
  if (hasAddon2(task) && dirtinessRatio(task.addon2LastDoneAt ?? null, task.addon2FrequencyDays ?? 0, when) > 1) return true;
  return false;
}

export function isDueToday(task: AddonFields, asOf?: Date) {
  const when = asOf ?? new Date();
  if (isCatchUpTask(task, when)) return false;
  return dirtinessRatio(task.lastDoneAt ?? null, task.frequencyDays ?? 0, when) >= 1
    || isAddonDue(task, when)
    || isAddon2Due(task, when);
}

function addonLabel(task: AddonFields) {
  return (task.addonName ?? "").trim();
}

function addon2Label(task: AddonFields) {
  return (task.addon2Name ?? "").trim();
}

export function comboTaskName(name: string, addon: string) {
  return `${name} and ${addon}`;
}

export function stackedTaskName(name: string, addon: string, addon2: string) {
  return `${name}, ${addon}, and ${addon2}`;
}

export function displayTaskName(task: AddonFields, asOf: Date = new Date()) {
  const name = task.name ?? "";
  if (isAddon2Due(task, asOf)) return stackedTaskName(name, addonLabel(task), addon2Label(task));
  if (isAddonDue(task, asOf)) return comboTaskName(name, addonLabel(task));
  return name;
}

function completedWithAddon2(task: AddonFields, completedAt?: Date | string | null) {
  if (!completedAt || !task.addon2LastDoneAt || !hasAddon2(task)) return false;
  return near(completedAt, task.addon2LastDoneAt, 60_000);
}

function completedWithAddon(task: AddonFields, completedAt?: Date | string | null) {
  if (!completedAt || !task.addonLastDoneAt || !hasAddon(task)) return false;
  return near(completedAt, task.addonLastDoneAt, 60_000);
}

export function assignmentLabel(task: AddonFields, completedAt?: Date | string | null) {
  if (completedWithAddon2(task, completedAt)) {
    return stackedTaskName(task.name ?? "", addonLabel(task), addon2Label(task));
  }
  if (completedWithAddon(task, completedAt)) return comboTaskName(task.name ?? "", addonLabel(task));
  return displayTaskName(task);
}

function extraPoints(task: AddonFields, includeSecond: boolean) {
  let extra = 0;
  if (hasAddon(task)) extra += Math.max(0, task.addonPoints ?? 1);
  if (includeSecond && hasAddon2(task)) extra += Math.max(0, task.addon2Points ?? 1);
  return extra;
}

export function assignmentDifficulty(task: AddonFields, completedAt?: Date | string | null) {
  const difficulty = task.difficulty ?? 1;
  if (completedWithAddon2(task, completedAt)) return Math.min(3, difficulty + extraPoints(task, true));
  if (completedWithAddon(task, completedAt)) return Math.min(3, difficulty + extraPoints(task, false));
  return displayTaskDifficulty(task);
}

export function displayTaskDifficulty(task: AddonFields, asOf: Date = new Date()) {
  const difficulty = task.difficulty ?? 1;
  if (isAddon2Due(task, asOf)) return Math.min(3, difficulty + extraPoints(task, true));
  if (isAddonDue(task, asOf)) return Math.min(3, difficulty + extraPoints(task, false));
  return difficulty;
}

export function isTaskEligible(task: AddonFields, asOf: Date = new Date()) {
  return isDirtyEnough(task.lastDoneAt ?? null, task.frequencyDays ?? 0, asOf, task.dueOnly)
    || isAddonDue(task, asOf)
    || isAddon2Due(task, asOf);
}

export function addonDetail(task: AddonFields) {
  if (!hasAddon(task)) return "";
  const first = `also ${addonLabel(task)} · ${formatFrequency(task.addonFrequencyDays ?? 0).toLowerCase()}`;
  if (!hasAddon2(task)) return first;
  return `${first} · also ${addon2Label(task)} · ${formatFrequency(task.addon2FrequencyDays ?? 0).toLowerCase()}`;
}

function parsePoints(raw: unknown) {
  if (raw === undefined || raw === null || raw === "") return 1;
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return 1;
  return Math.min(2, Math.max(0, n));
}

function parseLayer(nameRaw: unknown, frequencyRaw: unknown, pointsRaw: unknown, lastRaw: unknown) {
  const name = typeof nameRaw === "string" ? nameRaw.trim().slice(0, 80) : "";
  const frequencyDays = name ? Math.max(0, Math.round(Number(frequencyRaw) || 0)) : 0;
  const on = Boolean(name) && frequencyDays > 0;
  const lastDoneAt = on && typeof lastRaw === "string" && lastRaw ? new Date(lastRaw) : null;
  return {
    on,
    name: on ? name : "",
    frequencyDays: on ? frequencyDays : 0,
    points: on ? parsePoints(pointsRaw) : 1,
    lastDoneAt,
  };
}

export function addonFields(body: {
  addonName?: unknown;
  addonFrequencyDays?: unknown;
  addonPoints?: unknown;
  addonLastDoneAt?: unknown;
  addon2Name?: unknown;
  addon2FrequencyDays?: unknown;
  addon2Points?: unknown;
  addon2LastDoneAt?: unknown;
}) {
  const first = parseLayer(body.addonName, body.addonFrequencyDays, body.addonPoints, body.addonLastDoneAt);
  const second = first.on
    ? parseLayer(body.addon2Name, body.addon2FrequencyDays, body.addon2Points, body.addon2LastDoneAt)
    : parseLayer("", 0, 1, null);
  return {
    addonName: first.name,
    addonFrequencyDays: first.frequencyDays,
    addonPoints: first.points,
    addonLastDoneAt: first.lastDoneAt,
    addon2Name: second.name,
    addon2FrequencyDays: second.frequencyDays,
    addon2Points: second.points,
    addon2LastDoneAt: second.lastDoneAt,
  };
}
