import { isAddon2Due, type AddonFields } from "./addon";
import { calendarDaysBetween } from "./dates";

export const RFID_DESICCANT_CYCLE_ENTITY = "number.one_rfid_smart_feeder_desiccant_cycle";
export const RFID_DESICCANT_RESET_ENTITY = "button.one_rfid_smart_feeder_desiccant_reset";
export const FILTER_ADDON_NAME = "replace food/water filters";
export const DEFAULT_FILTER_CYCLE_DAYS = 30;

function foldName(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function isFilterNamedTask(task: { name?: string | null }) {
  return foldName(task.name ?? "") === foldName(FILTER_ADDON_NAME);
}

export function isFilterAddonTask(task: { addon2Name?: string | null }) {
  return foldName(task.addon2Name ?? "") === foldName(FILTER_ADDON_NAME);
}

/** True when this completion updates the filter last-done date. */
export function shouldSyncRfidDesiccant(task: AddonFields, completedAt: Date = new Date()) {
  if (isFilterNamedTask(task)) return true;
  return isFilterAddonTask(task) && isAddon2Due(task, completedAt);
}

export function filterCycleDays(task: {
  name?: string | null;
  frequencyDays?: number | null;
  addon2Name?: string | null;
  addon2FrequencyDays?: number | null;
}) {
  if (isFilterAddonTask(task)) {
    const days = Math.round(Number(task.addon2FrequencyDays) || 0);
    return days > 0 ? days : DEFAULT_FILTER_CYCLE_DAYS;
  }
  if (isFilterNamedTask(task)) {
    const days = Math.round(Number(task.frequencyDays) || 0);
    return days > 0 ? days : DEFAULT_FILTER_CYCLE_DAYS;
  }
  return DEFAULT_FILTER_CYCLE_DAYS;
}

/** Days left on the bag given when the filter was last replaced. */
export function desiccantRemainingDays(
  lastDoneAt: Date | string | null | undefined,
  cycleDays: number,
  asOf: Date = new Date(),
) {
  const cycle = Math.max(1, Math.round(cycleDays) || DEFAULT_FILTER_CYCLE_DAYS);
  if (!lastDoneAt) return 0;
  const elapsed = calendarDaysBetween(asOf, lastDoneAt);
  return Math.max(0, Math.min(60, cycle - elapsed));
}

/**
 * Walk prior completions and recreate when the filter last-done would have
 * been stamped (each time the parent was completed while the filter was due).
 */
export function previousFilterLastDone(completionsAsc: Date[], frequencyDays: number): Date | null {
  const freq = Math.max(1, Math.round(frequencyDays) || DEFAULT_FILTER_CYCLE_DAYS);
  let last: Date | null = null;
  for (const at of completionsAsc) {
    if (!last || calendarDaysBetween(at, last) >= freq) last = at;
  }
  return last;
}

/** Petlibro cannot write remaining days directly; reset after a temporary cycle. */
export async function syncRfidDesiccantRemaining(opts: {
  lastDoneAt: Date | string | null | undefined;
  cycleDays: number;
  asOf?: Date;
}) {
  const cycleDays = Math.max(1, Math.min(60, Math.round(opts.cycleDays) || DEFAULT_FILTER_CYCLE_DAYS));
  const remaining = Math.max(1, desiccantRemainingDays(opts.lastDoneAt, cycleDays, opts.asOf ?? new Date()));

  const { appendIntegrationLog } = await import("./integration-log");
  const { haConfig, postHaService } = await import("./ha");

  const ha = haConfig();
  if (!ha) {
    await appendIntegrationLog({
      kind: "notify",
      ok: false,
      summary: "Petlibro desiccant sync skipped",
      detail: "HA_URL or HA_TOKEN is not set",
    });
    return { ok: false as const, reason: "HA not configured" };
  }

  const setCycle = (value: number) =>
    postHaService(ha, "number", "set_value", {
      entity_id: RFID_DESICCANT_CYCLE_ENTITY,
      value,
    });

  const toRemaining = await setCycle(remaining);
  if (!toRemaining.ok) {
    await appendIntegrationLog({
      kind: "notify",
      ok: false,
      summary: "Petlibro desiccant sync failed",
      detail: `set remaining via cycle ${remaining}: ${toRemaining.status} ${toRemaining.body.slice(0, 200)}`,
    });
    return { ok: false as const, reason: "set remaining failed" };
  }

  const reset = await postHaService(ha, "button", "press", {
    entity_id: RFID_DESICCANT_RESET_ENTITY,
  });
  if (!reset.ok) {
    await setCycle(cycleDays);
    await appendIntegrationLog({
      kind: "notify",
      ok: false,
      summary: "Petlibro desiccant reset failed",
      detail: `${reset.status} ${reset.body.slice(0, 200)}`,
    });
    return { ok: false as const, reason: "reset failed" };
  }

  if (remaining !== cycleDays) {
    const restore = await setCycle(cycleDays);
    if (!restore.ok) {
      await appendIntegrationLog({
        kind: "notify",
        ok: false,
        summary: "Petlibro desiccant cycle restore failed",
        detail: `${restore.status} ${restore.body.slice(0, 200)}`,
      });
      return { ok: false as const, reason: "cycle restore failed", remaining };
    }
  }

  await appendIntegrationLog({
    kind: "notify",
    ok: true,
    summary: `Petlibro desiccant set to ${remaining} days`,
    detail: `last done ${opts.lastDoneAt ? new Date(opts.lastDoneAt).toISOString() : "never"}; cycle ${cycleDays}`,
  });
  return { ok: true as const, remaining, cycleDays };
}

export async function syncRfidDesiccantOnFilterComplete(task: AddonFields, completedAt: Date) {
  if (!shouldSyncRfidDesiccant(task, completedAt)) {
    return { ok: true as const, skipped: true as const };
  }
  return syncRfidDesiccantRemaining({
    lastDoneAt: completedAt,
    cycleDays: filterCycleDays(task),
  });
}

export async function syncRfidDesiccantOnFilterUndo(task: AddonFields, lastDoneAt: Date | null) {
  if (!isFilterNamedTask(task) && !isFilterAddonTask(task)) {
    return { ok: true as const, skipped: true as const };
  }
  return syncRfidDesiccantRemaining({
    lastDoneAt,
    cycleDays: filterCycleDays(task),
  });
}
