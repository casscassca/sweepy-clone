import { prisma } from "./prisma";
import { haConfig, listHaNotifyCatalog, postNotify, resolveNotifyTarget } from "./ha";
import { appendIntegrationLog } from "./integration-log";
import { displayTaskDifficulty, displayTaskName, isTaskEligible } from "./addon";
import { dirtinessRatio, dueOnAllowedDay } from "./dirtiness";
import { calendarDayStr } from "./dates";
import {
  isWeekendDate,
  overflowNextDate,
  personCapOnDate,
  personWeekendOn,
  weekendPair,
} from "./capacity";
import { personAway, returnDay } from "./vacation";
import { applyDirtPause, loadVacationContext } from "./vacation-db";
import { isAllowedOnDate, nextAllowedOnOrAfter } from "./allowed-days";
import { scheduleHaMqttSync } from "./ha-mqtt";
import { addDays, format, parseISO } from "date-fns";

function todayStr() {
  return calendarDayStr(new Date());
}

async function relocateOpen(
  id: string,
  taskId: string,
  date: string,
  extra: { parked?: boolean; held?: boolean } = {},
) {
  const clash = await prisma.dailyAssignment.findUnique({
    where: { date_taskId: { date, taskId } },
  });
  if (clash && clash.id !== id) {
    await prisma.dailyAssignment.delete({ where: { id } });
    return;
  }
  await prisma.dailyAssignment.update({ where: { id }, data: { date, ...extra } });
}

/** Keep the earliest open assignment per task; drop later copies. */
export async function dedupeOpenAssignments() {
  const open = await prisma.dailyAssignment.findMany({
    where: { completedAt: null },
    orderBy: [{ date: "asc" }, { order: "asc" }],
    select: { id: true, taskId: true },
  });
  const seen = new Set<string>();
  const extra: string[] = [];
  for (const a of open) {
    if (seen.has(a.taskId)) extra.push(a.id);
    else seen.add(a.taskId);
  }
  if (extra.length > 0) {
    await prisma.dailyAssignment.deleteMany({ where: { id: { in: extra } } });
  }
  return extra.length;
}

/** Auto-scheduled rows that are still too clean come off the list. Held ones stay. */
export async function dropCleanUnheldAssignments() {
  const open = await prisma.dailyAssignment.findMany({
    where: { completedAt: null, held: false, parked: false },
    include: { task: { select: { lastDoneAt: true, frequencyDays: true, oneOff: true, dueOnly: true, addonName: true, addonFrequencyDays: true, addonPoints: true, addonLastDoneAt: true, addon2Name: true, addon2FrequencyDays: true, addon2Points: true, addon2LastDoneAt: true } } },
  });
  const { house, dirtAsOf } = await loadVacationContext(todayStr());
  const drop = open
    .filter((a) => {
      if (a.task.oneOff) return false;
      const asOf = house.pauseDirtiness && house.dirtFrozenOn ? dirtAsOf : new Date(`${a.date}T12:00:00`);
      return !isTaskEligible(a.task, asOf);
    })
    .map((a) => a.id);
  if (drop.length > 0) {
    await prisma.dailyAssignment.deleteMany({ where: { id: { in: drop } } });
  }
  return drop.length;
}

/** Unfinished chores from earlier days roll to the next day they are allowed on. */
export async function rollForwardPastAssignments(today = todayStr()) {
  const { awayIds } = await loadVacationContext(today);
  const past = await prisma.dailyAssignment.findMany({
    where: { completedAt: null, parked: false, date: { lt: today } },
    include: { task: { select: { allowedDays: true } } },
  });
  for (const a of past) {
    if (awayIds.has(a.userId)) continue;
    const target = nextAllowedOnOrAfter(a.task.allowedDays, today);
    if (!target) continue;
    await relocateOpen(a.id, a.taskId, target);
  }
  return past.length;
}

function isManualStay(a: { pinned: boolean; held: boolean; task: { oneOff: boolean } }) {
  return a.pinned || a.held || a.task.oneOff;
}

function staysOnItsDay(a: { pinned: boolean; held: boolean; task: { oneOff: boolean; dueOnly?: boolean } }) {
  return isManualStay(a) || !!a.task.dueOnly;
}

const TASK_LOAD_SELECT = {
  difficulty: true,
  lastDoneAt: true,
  frequencyDays: true,
  oneOff: true,
  important: true,
  dueOnly: true,
  allowedDays: true,
  addonName: true,
  addonFrequencyDays: true,
  addonPoints: true,
  addonLastDoneAt: true,
  addon2Name: true,
  addon2FrequencyDays: true,
  addon2Points: true,
  addon2LastDoneAt: true,
} as const;

async function catalogUseOn(date: string, userId: string) {
  const rows = await prisma.dailyAssignment.findMany({
    where: { date, userId, parked: false, task: { oneOff: false } },
    include: { task: { select: TASK_LOAD_SELECT } },
  });
  const asOf = new Date(`${date}T12:00:00`);
  return {
    pts: rows.reduce((s, a) => s + displayTaskDifficulty(a.task, asOf), 0),
    tasks: rows.length,
  };
}

async function weekendRemaining(
  date: string,
  userId: string,
  pot: { weekendCapacity: number; weekendTaskLimit: number },
) {
  const pair = weekendPair(date);
  if (!pair) return { pts: 0, tasks: 0 };
  const [sat, sun] = await Promise.all([catalogUseOn(pair.sat, userId), catalogUseOn(pair.sun, userId)]);
  return {
    pts: pot.weekendCapacity - sat.pts - sun.pts,
    tasks: pot.weekendTaskLimit - sat.tasks - sun.tasks,
  };
}

/**
 * Auto-picks that overflow a person's daily points or task count slide forward.
 * Regular chores go first (cleanest first). Important autos only slide if
 * nothing else can. Pins, one-offs, due-only chores, and anything placed
 * by hand stay put and do not push other chores off the day — a day can
 * go over capacity on purpose.
 */
export async function enforceCapacity(fromDate = todayStr(), horizon = 21) {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      dailyCapacity: true,
      dailyTaskLimit: true,
      weekdayCapacities: true,
      weekdayTaskLimits: true,
      weekendShare: true,
      weekendCapacity: true,
      weekendTaskLimit: true,
      vacationOn: true,
      vacationStart: true,
      vacationEnd: true,
    },
  });
  const vac = await loadVacationContext(fromDate);
  const start = parseISO(`${fromDate}T12:00:00`);

  for (let i = 0; i < horizon; i++) {
    const date = format(addDays(start, i), "yyyy-MM-dd");
    const open = await prisma.dailyAssignment.findMany({
      where: { date, completedAt: null, parked: false },
      include: { task: { select: TASK_LOAD_SELECT } },
    });

    const byUser = new Map<string, typeof open>();
    for (const a of open) {
      const list = byUser.get(a.userId) ?? [];
      list.push(a);
      byUser.set(a.userId, list);
    }

    for (const [userId, items] of byUser) {
      const person = users.find((u) => u.id === userId);
      if (person && personAway(person, vac.house, date)) continue;
      const autos = items.filter((a) => !staysOnItsDay(a));
      const asOf = vac.dirtAsOf;
      let points = autos.reduce((s, a) => s + displayTaskDifficulty(a.task, asOf), 0);
      let count = autos.length;
      let limit = 6;
      let maxTasks = 6;
      if (person && personWeekendOn(person) && isWeekendDate(date)) {
        const rem = await weekendRemaining(date, userId, person);
        limit = rem.pts + points;
        maxTasks = rem.tasks + count;
      } else {
        const dayCap = person ? personCapOnDate(person, date) : { pts: 6, tasks: 6 };
        limit = dayCap.pts;
        maxTasks = dayCap.tasks;
      }
      const ranked = [...autos].sort((a, b) => {
        if (a.task.important !== b.task.important) return a.task.important ? 1 : -1;
        return dirtinessRatio(a.task.lastDoneAt, a.task.frequencyDays, vac.dirtAsOf) -
          dirtinessRatio(b.task.lastDoneAt, b.task.frequencyDays, vac.dirtAsOf);
      });
      let idx = 0;
      while ((points > limit || count > maxTasks) && idx < ranked.length) {
        const spill = ranked[idx++];
        const dest = nextAllowedOnOrAfter(
          spill.task.allowedDays,
          overflowNextDate(date, person ? personWeekendOn(person) : false),
        );
        if (!dest || dest === date) continue;
        await relocateOpen(spill.id, spill.taskId, dest);
        points -= displayTaskDifficulty(spill.task, asOf);
        count -= 1;
      }
    }
  }
}

/** Wipe auto catalog rows from today forward, then refill around what should stay. */
export async function reshuffleFrom(
  fromDate = todayStr(),
  horizon = 21,
  opts?: { keepHeld?: boolean },
) {
  await prepareAssignments(fromDate);
  const start = parseISO(`${fromDate}T12:00:00`);
  const days = Array.from({ length: horizon }, (_, i) => format(addDays(start, i), "yyyy-MM-dd"));
  await prisma.dailyAssignment.deleteMany({
    where: {
      date: { in: days },
      completedAt: null,
      pinned: false,
      parked: false,
      ...(opts?.keepHeld ? { held: false } : {}),
      task: { oneOff: false },
    },
  });
  // Plant due-only chores on their real due day first so leftover capacity
  // on later days cannot steal them.
  await placeDueOnlyOnDueDays(fromDate, horizon);
  let assigned = 0;
  for (const date of days) {
    assigned += (await runDailyAssignment(date, fromDate, { prepare: false })).assigned;
  }
  scheduleHaMqttSync();
  return { assigned };
}

let prepareLock: Promise<void> = Promise.resolve();

export async function prepareAssignments(notBefore = todayStr()) {
  const previous = prepareLock;
  let unlock = () => {};
  prepareLock = new Promise<void>((resolve) => {
    unlock = resolve;
  });
  await previous;
  try {
    await applyDirtPause(notBefore);
    await applyVacation(notBefore);
    const duplicates = await dedupeOpenAssignments();
    const rolled = await rollForwardPastAssignments(notBefore);
    const dropped = await dropCleanUnheldAssignments();
    await snapDueOnlyToDueDay(notBefore);
    await enforceCapacity(notBefore);
    await snapToAllowedDays(notBefore);
    await applyVacation(notBefore);
    return { duplicates, rolled, dropped };
  } finally {
    unlock();
  }
}

async function applyVacation(day: string) {
  const { house, users, awayIds } = await loadVacationContext(day);
  const open = await prisma.dailyAssignment.findMany({
    where: { completedAt: null },
    include: { task: { select: { oneOff: true, allowedDays: true } } },
  });
  const dismiss: string[] = [];
  for (const a of open) {
    const person = users.find((u) => u.id === a.userId);
    if (!person) continue;
    const awayToday = awayIds.has(a.userId);
    const awayOnDate = personAway(person, house, a.date);

    if (a.parked) {
      if (!awayToday) {
        const landing = nextAllowedOnOrAfter(a.task.allowedDays, day) ?? day;
        await relocateOpen(a.id, a.taskId, landing, { parked: false, held: true });
      }
      continue;
    }

    const stay = a.pinned || a.held || a.task.oneOff;
    if (!stay && awayOnDate) {
      await prisma.dailyAssignment.delete({ where: { id: a.id } });
      dismiss.push(a.id);
      continue;
    }
    if (!awayToday || a.date > day || !stay) continue;
    const back = returnDay(person, house, day);
    if (back && back > day) {
      const landing = nextAllowedOnOrAfter(a.task.allowedDays, back) ?? back;
      await relocateOpen(a.id, a.taskId, landing, { held: true, parked: false });
    } else {
      await prisma.dailyAssignment.update({
        where: { id: a.id },
        data: { parked: true, held: true },
      });
    }
    dismiss.push(a.id);
  }
  for (const id of dismiss) await dismissAssignmentNotify(id);
}

/** Move unheld due-only chores onto the day the interval is actually up. */
async function snapDueOnlyToDueDay(fromDate = todayStr(), horizon = 21) {
  const until = format(addDays(parseISO(`${fromDate}T12:00:00`), horizon - 1), "yyyy-MM-dd");
  const open = await prisma.dailyAssignment.findMany({
    where: { completedAt: null, pinned: false, held: false, parked: false, task: { dueOnly: true, oneOff: false } },
    include: { task: { select: { lastDoneAt: true, frequencyDays: true, allowedDays: true } } },
  });
  for (const a of open) {
    const target = dueOnAllowedDay(a.task.lastDoneAt, a.task.frequencyDays, a.task.allowedDays, fromDate, until);
    if (!target || target === a.date) continue;
    const clash = await prisma.dailyAssignment.findUnique({
      where: { date_taskId: { date: target, taskId: a.taskId } },
    });
    if (clash) await prisma.dailyAssignment.delete({ where: { id: a.id } });
    else await prisma.dailyAssignment.update({ where: { id: a.id }, data: { date: target } });
  }
}

async function snapToAllowedDays(fromDate = todayStr()) {
  const open = await prisma.dailyAssignment.findMany({
    where: { completedAt: null, parked: false, pinned: false, held: false, task: { oneOff: false } },
    include: { task: { select: { allowedDays: true } } },
  });
  for (const a of open) {
    if (isAllowedOnDate(a.task.allowedDays, a.date)) continue;
    const from = a.date < fromDate ? fromDate : a.date;
    const target = nextAllowedOnOrAfter(a.task.allowedDays, from);
    if (!target || target === a.date) continue;
    await relocateOpen(a.id, a.taskId, target);
  }
}

/** After a reshuffle wipe, seat due-only chores on their due day before filler runs. */
async function placeDueOnlyOnDueDays(fromDate: string, horizon: number) {
  const until = format(addDays(parseISO(`${fromDate}T12:00:00`), horizon - 1), "yyyy-MM-dd");
  const [tasks, users, open, vac] = await Promise.all([
    prisma.task.findMany({
      where: { dueOnly: true, oneOff: false },
      include: { assignableUsers: true },
    }),
    prisma.user.findMany({
      orderBy: { createdAt: "asc" },
      select: { id: true, vacationOn: true, vacationStart: true, vacationEnd: true },
    }),
    prisma.dailyAssignment.findMany({
      where: { completedAt: null },
      select: { taskId: true, date: true, userId: true, order: true },
    }),
    loadVacationContext(fromDate),
  ]);

  const taken = new Set(open.map((a) => a.taskId));
  const load = new Map<string, number>();
  const lastOrder = new Map<string, number>();
  for (const a of open) {
    const userKey = `${a.date}:${a.userId}`;
    load.set(userKey, (load.get(userKey) ?? 0) + 1);
    lastOrder.set(userKey, Math.max(lastOrder.get(userKey) ?? -1, a.order));
  }

  const toCreate: Array<{ date: string; userId: string; taskId: string; order: number }> = [];
  for (const task of tasks) {
    if (taken.has(task.id)) continue;
    const date = dueOnAllowedDay(task.lastDoneAt, task.frequencyDays, task.allowedDays, fromDate, until);
    if (!date) continue;

    const allowed = (task.assignableUsers.length > 0
      ? task.assignableUsers.map((au) => au.userId)
      : users.map((u) => u.id)
    ).filter((uid) => {
      const person = users.find((u) => u.id === uid);
      return person && !personAway(person, vac.house, date);
    });
    if (allowed.length === 0) continue;

    let bestUser = allowed[0];
    let bestLoad = Number.POSITIVE_INFINITY;
    for (const uid of allowed) {
      const n = load.get(`${date}:${uid}`) ?? 0;
      if (n < bestLoad) {
        bestLoad = n;
        bestUser = uid;
      }
    }

    const userKey = `${date}:${bestUser}`;
    const order = (lastOrder.get(userKey) ?? -1) + 1;
    lastOrder.set(userKey, order);
    load.set(userKey, (load.get(userKey) ?? 0) + 1);
    taken.add(task.id);
    toCreate.push({ date, userId: bestUser, taskId: task.id, order });
  }

  if (toCreate.length > 0) {
    await prisma.dailyAssignment.createMany({ data: toCreate });
  }
  return toCreate.length;
}

export async function holdAssignmentOnDate(id: string, date: string, opts?: { respectAllowed?: boolean }) {
  const current = await prisma.dailyAssignment.findUnique({
    where: { id },
    include: { task: { select: { allowedDays: true } } },
  });
  if (!current) return null;
  const landing = opts?.respectAllowed === false
    ? date
    : (nextAllowedOnOrAfter(current.task.allowedDays, date) ?? date);
  if (current.date !== landing) {
    const clash = await prisma.dailyAssignment.findUnique({
      where: { date_taskId: { date: landing, taskId: current.taskId } },
    });
    if (clash) {
      await prisma.dailyAssignment.delete({ where: { id } });
      await prisma.dailyAssignment.update({
        where: { id: clash.id },
        data: { held: true, remindAt: null, pinned: current.pinned || clash.pinned },
      });
      return clash;
    }
  }
  const assignment = await prisma.dailyAssignment.update({
    where: { id },
    data: { date: landing, held: true, remindAt: null },
  });
  return assignment;
}

export async function addTaskToDate(taskId: string, date: string, preferredUserId?: string) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { assignableUsers: true },
  });
  if (!task) return { ok: false as const, status: 404, reason: "task not found" };
  if (task.oneOff) return { ok: false as const, status: 400, reason: "one-off" };
  const landing = nextAllowedOnOrAfter(task.allowedDays, date) ?? date;

  const open = await prisma.dailyAssignment.findFirst({
    where: { taskId, completedAt: null },
  });
  if (open) {
    const moved = await holdAssignmentOnDate(open.id, landing);
    return { ok: true as const, already: open.date === landing, assignment: moved };
  }

  const existingToday = await prisma.dailyAssignment.findUnique({
    where: { date_taskId: { date: landing, taskId } },
  });
  if (existingToday) return { ok: true as const, already: true, assignment: existingToday };

  const people = await prisma.user.findMany({ orderBy: { createdAt: "asc" }, select: { id: true } });
  const allowed = task.assignableUsers.length > 0
    ? task.assignableUsers.map((a) => a.userId)
    : people.map((u) => u.id);
  const userId = preferredUserId && allowed.includes(preferredUserId) ? preferredUserId : allowed[0];
  if (!userId) return { ok: false as const, status: 422, reason: "no people to assign to" };

  const last = await prisma.dailyAssignment.findFirst({
    where: { date: landing, userId },
    orderBy: { order: "desc" },
    select: { order: true },
  });
  const created = await prisma.dailyAssignment.create({
    data: { date: landing, taskId, userId, order: (last?.order ?? -1) + 1, held: true },
  });
  return { ok: true as const, already: false, assignment: created };
}

export async function createOneOff(opts: {
  name: string;
  userId: string;
  difficulty: number;
  date: string;
}) {
  const name = opts.name.trim();
  if (!name) return { ok: false as const, status: 400, reason: "name required" };
  const user = await prisma.user.findUnique({ where: { id: opts.userId }, select: { id: true } });
  if (!user) return { ok: false as const, status: 404, reason: "person not found" };
  const difficulty = Math.min(3, Math.max(1, Math.round(Number(opts.difficulty) || 1)));

  const last = await prisma.dailyAssignment.findFirst({
    where: { date: opts.date, userId: opts.userId },
    orderBy: { order: "desc" },
    select: { order: true },
  });
  const task = await prisma.task.create({
    data: {
      name,
      oneOff: true,
      difficulty,
      frequencyDays: 1,
      assignments: {
        create: {
          date: opts.date,
          userId: opts.userId,
          order: (last?.order ?? -1) + 1,
          held: true,
        },
      },
    },
  });
  return { ok: true as const, taskId: task.id };
}

export async function runDailyAssignment(
  dateStr?: string,
  householdToday = todayStr(),
  opts?: { prepare?: boolean },
) {
  const date = dateStr ?? householdToday;
  const targetDate = new Date(date + "T12:00:00"); // noon to avoid DST edge cases
  if (opts?.prepare !== false) await prepareAssignments(householdToday);
  const vac = await loadVacationContext(date);
  const dirtAsOf = vac.dirtAsOf;

  const [tasks, users, existing, openElsewhere] = await Promise.all([
    prisma.task.findMany({
      where: { oneOff: false },
      include: { assignableUsers: { include: { user: true } } },
    }),
    prisma.user.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.dailyAssignment.findMany({
      where: { date, parked: false },
      include: { task: { select: { difficulty: true, lastDoneAt: true, frequencyDays: true, oneOff: true, dueOnly: true, addonName: true, addonFrequencyDays: true, addonPoints: true, addonLastDoneAt: true, addon2Name: true, addon2FrequencyDays: true, addon2Points: true, addon2LastDoneAt: true } } },
    }),
    prisma.dailyAssignment.findMany({
      where: { completedAt: null, date: { not: date } },
      select: { taskId: true },
    }),
  ]);

  const alreadyAssignedIds = new Set(existing.map((a) => a.taskId));
  const blockedIds = new Set(openElsewhere.map((a) => a.taskId));

  const eligible = tasks
    .filter((t) => !alreadyAssignedIds.has(t.id) && !blockedIds.has(t.id))
    .filter((t) => isAllowedOnDate(t.allowedDays, date))
    .map((t) => ({
      task: t,
      dirt: dirtinessRatio(t.lastDoneAt, t.frequencyDays, dirtAsOf),
      exclusive: t.assignableUsers.length === 1,
      important: t.important,
    }))
    .filter(({ task }) => isTaskEligible(task, dirtAsOf))
    .sort((a, b) => {
      if (a.important !== b.important) return a.important ? -1 : 1;
      if (a.exclusive !== b.exclusive) return a.exclusive ? -1 : 1;
      return b.dirt - a.dirt;
    });

  if (eligible.length === 0) return { assigned: 0 };

  const capacityLeft = new Map<string, number>();
  const slotsLeft = new Map<string, number>();
  for (const user of users) {
    if (personAway(user, vac.house, date)) {
      capacityLeft.set(user.id, 0);
      slotsLeft.set(user.id, 0);
      continue;
    }
    if (personWeekendOn(user) && isWeekendDate(date)) {
      const rem = await weekendRemaining(date, user.id, user);
      capacityLeft.set(user.id, rem.pts);
      slotsLeft.set(user.id, rem.tasks);
    } else {
      const cap = personCapOnDate(user, date);
      capacityLeft.set(user.id, cap.pts);
      slotsLeft.set(user.id, cap.tasks);
    }
  }
  const orderCounters = new Map<string, number>(users.map((u) => [u.id, 0]));
  for (const a of existing) {
    const owner = users.find((u) => u.id === a.userId);
    if (!(owner && personWeekendOn(owner) && isWeekendDate(date))) {
      capacityLeft.set(a.userId, (capacityLeft.get(a.userId) ?? 0) - displayTaskDifficulty(a.task, targetDate));
      slotsLeft.set(a.userId, (slotsLeft.get(a.userId) ?? 0) - 1);
    }
    orderCounters.set(a.userId, (orderCounters.get(a.userId) ?? 0) + 1);
  }

  const toCreate: Array<{ date: string; userId: string; taskId: string; order: number }> = [];

  const pickUser = (task: (typeof eligible)[number]["task"], allowOver: boolean) => {
    const assignableUserIds =
      task.assignableUsers.length > 0
        ? task.assignableUsers.map((au: { userId: string }) => au.userId)
        : users.map((u) => u.id);
    const difficulty = displayTaskDifficulty(task, targetDate);

    let bestUser: string | null = null;
    let bestCapacity = allowOver ? Number.NEGATIVE_INFINITY : -1;
    for (const uid of assignableUserIds) {
      if (vac.awayIds.has(uid)) continue;
      const cap = capacityLeft.get(uid) ?? 0;
      const slots = slotsLeft.get(uid) ?? 0;
      if (!allowOver && (slots < 1 || cap < difficulty)) continue;
      if (cap > bestCapacity) {
        bestCapacity = cap;
        bestUser = uid;
      }
    }
    return bestUser;
  };

  const place = (items: typeof eligible, allowOver: boolean) => {
    for (const { task } of items) {
      const bestUser = pickUser(task, allowOver);
      if (!bestUser) continue;
      const difficulty = displayTaskDifficulty(task, targetDate);
      capacityLeft.set(bestUser, (capacityLeft.get(bestUser) ?? 0) - difficulty);
      slotsLeft.set(bestUser, (slotsLeft.get(bestUser) ?? 0) - 1);
      const order = orderCounters.get(bestUser) ?? 0;
      orderCounters.set(bestUser, order + 1);
      toCreate.push({ date, userId: bestUser, taskId: task.id, order });
    }
  };

  // Due-only chores get their actual due day, even if that day is already full.
  place(eligible.filter((e) => e.task.dueOnly), true);
  place(eligible.filter((e) => !e.task.dueOnly), false);

  if (toCreate.length > 0) {
    await prisma.dailyAssignment.createMany({ data: toCreate });
  }

  return { assigned: toCreate.length };
}

export type NotifyAttempt = {
  taskName: string;
  service: string;
  url: string;
  ok: boolean;
  status: number;
  detail: string;
};

async function logNotify(entry: {
  ok: boolean;
  userName: string;
  summary: string;
  detail?: string;
}) {
  console[entry.ok ? "log" : "error"](`[notify] ${entry.userName}: ${entry.summary}${entry.detail ? ` — ${entry.detail}` : ""}`);
  await appendIntegrationLog({ kind: "notify", ...entry });
}

function parseNotifyTags(raw: string | null | undefined) {
  return (raw ?? "").split(",").map((t) => t.trim()).filter(Boolean);
}

/** Ask HA to drop this assignment's banner on whoever still has the tag. */
export async function dismissAssignmentNotify(assignmentId: string) {
  try {
    const assignment = await prisma.dailyAssignment.findUnique({
      where: { id: assignmentId },
      select: { id: true, taskId: true, userId: true },
    });
    if (!assignment) return;
    const ha = haConfig();
    if (!ha) return;

    const people = await prisma.user.findMany({
      where: { haNotifyTarget: { not: "" } },
      select: { id: true, haNotifyTarget: true, notifyTags: true },
    });
    const drop = [assignment.id, assignment.taskId];
    const targets = people.filter((user) => {
      const tags = parseNotifyTags(user.notifyTags);
      return user.id === assignment.userId || drop.some((tag) => tags.includes(tag));
    });
    if (targets.length === 0) return;

    const catalog = await listHaNotifyCatalog(ha);
    if (!catalog.reachable) return;

    for (const user of targets) {
      const resolved = resolveNotifyTarget(user.haNotifyTarget, catalog);
      if (!resolved.ok) continue;
      await clearPhoneNotifications(ha, resolved.service, drop);
      const next = parseNotifyTags(user.notifyTags).filter((tag) => !drop.includes(tag));
      await prisma.user.update({ where: { id: user.id }, data: { notifyTags: next.join(",") } });
    }
  } catch (err) {
    console.error("[notify] dismiss failed", err);
  }
}

async function clearPhoneNotifications(
  ha: NonNullable<ReturnType<typeof haConfig>>,
  service: string,
  tags: string[],
) {
  const unique = [...new Set(tags)];
  for (const tag of unique) {
    await postNotify(ha, service, {
      message: "clear_notification",
      data: { tag },
    });
  }
  return unique.length;
}

export async function sendNotificationsForUser(
  userId: string,
  date = todayStr(),
  onlyIds?: string[],
  opts?: { replace?: boolean },
) {
  const replace = opts?.replace === true;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { ok: false as const, reason: "person not found", sent: 0, cleared: 0, attempts: [] as NotifyAttempt[] };
  const vac = await loadVacationContext(date);
  if (personAway(user, vac.house, date)) {
    if (replace) {
      const haSkip = haConfig();
      if (haSkip && user.haNotifyTarget) {
        const catalog = await listHaNotifyCatalog(haSkip);
        const resolved = catalog.reachable ? resolveNotifyTarget(user.haNotifyTarget, catalog) : null;
        if (resolved?.ok) {
          await clearPhoneNotifications(haSkip, resolved.service, parseNotifyTags(user.notifyTags));
        }
      }
      await prisma.user.update({ where: { id: user.id }, data: { notifyTags: "" } });
    }
    return { ok: true as const, sent: 0, cleared: 0, reason: `${user.name} is away`, attempts: [] as NotifyAttempt[] };
  }

  const ha = haConfig();
  if (!ha) {
    await logNotify({ ok: false, userName: "", summary: "HA_URL or HA_TOKEN is not set" });
    return { ok: false as const, reason: "HA_URL or HA_TOKEN is not set", sent: 0, cleared: 0, attempts: [] as NotifyAttempt[] };
  }
  if (!user.haNotifyTarget) {
    await logNotify({ ok: false, userName: user.name, summary: `${user.name} has no HA notify target` });
    return { ok: false as const, reason: `${user.name} has no HA notify target`, sent: 0, cleared: 0, attempts: [] as NotifyAttempt[] };
  }

  const catalog = await listHaNotifyCatalog(ha);
  if (!catalog.reachable) {
    const reason = catalog.error ?? "Home Assistant is unreachable";
    await logNotify({ ok: false, userName: user.name, summary: reason, detail: ha.url });
    return { ok: false as const, reason, sent: 0, cleared: 0, attempts: [] as NotifyAttempt[] };
  }

  const resolved = resolveNotifyTarget(user.haNotifyTarget, catalog);
  if (!resolved.ok) {
    const reason = resolved.hint ?? `unknown notify target ${user.haNotifyTarget}`;
    await logNotify({
      ok: false,
      userName: user.name,
      summary: reason,
      detail: `stored ${user.haNotifyTarget}\nservices ${catalog.services.map((s) => `notify.${s}`).join(", ")}\nentities ${catalog.entities.join(", ")}`,
    });
    return { ok: false as const, reason, sent: 0, cleared: 0, attempts: [] as NotifyAttempt[] };
  }

  const assignments = await prisma.dailyAssignment.findMany({
    where: {
      userId: user.id,
      completedAt: null,
      parked: false,
      ...(onlyIds ? { id: { in: onlyIds } } : {
        date,
        OR: [{ remindAt: null }, { remindAt: { lte: new Date() } }],
      }),
    },
    include: { task: { include: { room: true } } },
    orderBy: { order: "asc" },
  });
  assignments.sort((a, b) => {
    const aImp = a.task.important ? 1 : 0;
    const bImp = b.task.important ? 1 : 0;
    if (aImp !== bImp) return bImp - aImp;
    return a.order - b.order;
  });

  // iOS rarely honors clear_notification (the app has to wake). Same-tag
  // replace is what actually updates a banner. Keep assignment.id as the tag
  // so a resend overwrites this morning's notifies instead of stacking.
  let cleared = 0;
  if (replace) {
    const keep = new Set(assignments.map((a) => a.id));
    const leftovers = [
      ...parseNotifyTags(user.notifyTags),
      ...assignments.map((a) => a.taskId),
    ].filter((tag) => !keep.has(tag));
    cleared = await clearPhoneNotifications(ha, resolved.service, leftovers);
    if (cleared > 0) {
      await logNotify({
        ok: true,
        userName: user.name,
        summary: `asked HA to dismiss ${cleared} leftover notify tag${cleared === 1 ? "" : "s"} for ${user.name}`,
      });
    }
  }

  if (assignments.length === 0) {
    if (replace) {
      await prisma.user.update({ where: { id: user.id }, data: { notifyTags: "" } });
      await logNotify({ ok: true, userName: user.name, summary: `cleared ${user.name}'s notifies — nothing on ${date}` });
      return { ok: true as const, sent: 0, cleared, reason: `cleared ${user.name}'s notifies — nothing on today's list`, attempts: [] as NotifyAttempt[] };
    }
    await logNotify({ ok: false, userName: user.name, summary: `${user.name} has no open tasks on ${date}` });
    return { ok: false as const, reason: `${user.name} has no open tasks on ${date}`, sent: 0, cleared, attempts: [] as NotifyAttempt[] };
  }

  const errors: string[] = [];
  const attempts: NotifyAttempt[] = [];
  let sent = 0;
  const sentIds: string[] = [];

  for (const assignment of assignments) {
    const difficulty = ["", "quick", "medium", "big job"][displayTaskDifficulty(assignment.task)];
    const taskName = displayTaskName(assignment.task);
    const tag = assignment.id;
    const base = {
      title: assignment.task.room ? `${assignment.task.room.name}: ${taskName}` : taskName,
      message: `${difficulty} · tap an action below`,
    };
    // Short action ids — iOS / companion historically cap identifiers around 32 chars.
    // cuid() is 25; DONE_ + id = 30, DEFER_ + id = 31, YDAY_ + id = 30.
    const withActions = {
      ...base,
      data: {
        tag,
        apns_headers: { "apns-collapse-id": tag },
        sweepyUserId: user.id,
        action_data: { sweepyUserId: user.id },
        actions: [
          { action: `DONE_${assignment.id}`, title: "Done" },
          { action: `DEFER_${assignment.id}`, title: "Tomorrow" },
          { action: `YDAY_${assignment.id}`, title: "Yesterday" },
        ],
      },
    };
    try {
      let result = await postNotify(ha, resolved.service, withActions);
      if (!result.ok && result.status === 400) {
        result = await postNotify(ha, resolved.service, base);
      }
      const detail = result.ok
        ? (resolved.hint ?? `notify.${resolved.service}`)
        : `${result.status} ${result.body.slice(0, 240)}`;
      const attempt: NotifyAttempt = {
        taskName,
        service: `notify.${resolved.service}`,
        url: result.url,
        ok: result.ok,
        status: result.status,
        detail,
      };
      attempts.push(attempt);
      await logNotify({
        ok: result.ok,
        userName: user.name,
        summary: result.ok ? `${taskName} → notify.${resolved.service}` : `${taskName}: HA ${result.status}`,
        detail: `${result.url}\nstored ${user.haNotifyTarget}\n${detail}`,
      });
      if (!result.ok) {
        errors.push(`${taskName}: HA ${result.status} notify.${resolved.service} ${result.body.slice(0, 160)}`);
        continue;
      }
      sent++;
      sentIds.push(assignment.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      attempts.push({ taskName, service: `notify.${resolved.service}`, url: "", ok: false, status: 0, detail: msg });
      await logNotify({ ok: false, userName: user.name, summary: `${taskName}: ${msg}` });
      errors.push(`${taskName}: ${msg}`);
    }
  }

  const previous = parseNotifyTags(user.notifyTags);
  const nextTags = onlyIds && !replace
    ? [...new Set([...previous, ...sentIds])]
    : sentIds;
  await prisma.user.update({ where: { id: user.id }, data: { notifyTags: nextTags.join(",") } });

  return { ok: errors.length === 0, sent, cleared, reason: errors[0] ?? resolved.hint, errors, attempts };
}

/** If this person is still under today's cap, add the next due chore and ping them. */
export async function fillUserTodayAndNotify(userId: string) {
  const date = todayStr();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      dailyCapacity: true,
      dailyTaskLimit: true,
      weekdayCapacities: true,
      weekdayTaskLimits: true,
      weekendShare: true,
      weekendCapacity: true,
      weekendTaskLimit: true,
      vacationOn: true,
      vacationStart: true,
      vacationEnd: true,
    },
  });
  if (!user) return 0;
  const vac = await loadVacationContext(date);
  if (personAway(user, vac.house, date)) return 0;

  const open = await prisma.dailyAssignment.findMany({
    where: { userId, date, completedAt: null, parked: false },
    include: { task: { select: { difficulty: true, lastDoneAt: true, frequencyDays: true, dueOnly: true, addonName: true, addonFrequencyDays: true, addonPoints: true, addonLastDoneAt: true, addon2Name: true, addon2FrequencyDays: true, addon2Points: true, addon2LastDoneAt: true } } },
  });
  const asOf = new Date(`${date}T12:00:00`);
  const points = open.reduce((s, a) => s + displayTaskDifficulty(a.task, asOf), 0);
  let pointsLeft = 0;
  if (personWeekendOn(user) && isWeekendDate(date)) {
    const rem = await weekendRemaining(date, user.id, user);
    if (rem.tasks < 1 || rem.pts < 1) return 0;
    pointsLeft = rem.pts;
  } else {
    const cap = personCapOnDate(user, date);
    if (open.length >= cap.tasks || points >= cap.pts) return 0;
    pointsLeft = cap.pts - points;
  }

  const addedId = await assignNextForUser(user.id, date, pointsLeft);
  if (!addedId) return 0;
  await sendNotificationsForUser(userId, date, [addedId]);
  return 1;
}

async function assignNextForUser(userId: string, date: string, pointsLeft: number) {
  const targetDate = new Date(`${date}T12:00:00`);
  const [tasks, existing, openElsewhere] = await Promise.all([
    prisma.task.findMany({
      where: { oneOff: false },
      include: { assignableUsers: true },
    }),
    prisma.dailyAssignment.findMany({
      where: { date, parked: false },
    }),
    prisma.dailyAssignment.findMany({
      where: { completedAt: null, date: { not: date } },
      select: { taskId: true },
    }),
  ]);
  const taken = new Set(existing.map((a) => a.taskId));
  const blocked = new Set(openElsewhere.map((a) => a.taskId));
  const lastOrder = existing
    .filter((a) => a.userId === userId)
    .reduce((max, a) => Math.max(max, a.order), -1);

  const next = tasks
    .filter((t) => !taken.has(t.id) && !blocked.has(t.id))
    .filter((t) => isAllowedOnDate(t.allowedDays, date))
    .filter((t) => t.assignableUsers.length === 0 || t.assignableUsers.some((au) => au.userId === userId))
    .map((t) => ({
      task: t,
      dirt: dirtinessRatio(t.lastDoneAt, t.frequencyDays, targetDate),
      exclusive: t.assignableUsers.length === 1,
    }))
    .filter(({ task }) => isTaskEligible(task, targetDate) && displayTaskDifficulty(task, targetDate) <= pointsLeft)
    .sort((a, b) => {
      if (a.task.dueOnly !== b.task.dueOnly) return a.task.dueOnly ? -1 : 1;
      if (a.task.important !== b.task.important) return a.task.important ? -1 : 1;
      if (a.exclusive !== b.exclusive) return a.exclusive ? -1 : 1;
      return b.dirt - a.dirt;
    })[0];

  if (!next) return null;
  const created = await prisma.dailyAssignment.create({
    data: { date, userId, taskId: next.task.id, order: lastOrder + 1 },
  });
  return created.id;
}

export async function sendDueReminders() {
  const due = await prisma.dailyAssignment.findMany({
    where: { completedAt: null, remindAt: { lte: new Date() } },
    select: { id: true, userId: true },
  });
  for (const a of due) {
    const result = await sendNotificationsForUser(a.userId, todayStr(), [a.id]);
    if (result.sent > 0) {
      await prisma.dailyAssignment.update({
        where: { id: a.id },
        data: { remindAt: null },
      });
    }
  }
}

export async function sendNotificationsForTime(timeStr: string) {
  const users = await prisma.user.findMany({
    where: { notifyTime: timeStr, haNotifyTarget: { not: "" } },
  });
  if (users.length === 0) return;

  const ha = haConfig();
  if (!ha) {
    console.warn("[notify] skipped — HA_URL or HA_TOKEN is not set");
    return;
  }

  const vac = await loadVacationContext(todayStr());
  for (const user of users) {
    if (personAway(user, vac.house, todayStr())) continue;
    const result = await sendNotificationsForUser(user.id);
    console.log(`[notify] ${timeStr} ${user.name}: sent ${result.sent}${result.reason ? ` (${result.reason})` : ""}`);
  }
}

export async function sendNudgesForTime(timeStr: string) {
  const users = await prisma.user.findMany({
    where: { nudgeTime: timeStr, haNotifyTarget: { not: "" } },
  });
  if (users.length === 0) return;

  const ha = haConfig();
  if (!ha) {
    console.warn("[notify] nudge skipped — HA_URL or HA_TOKEN is not set");
    return;
  }

  const day = todayStr();
  const vac = await loadVacationContext(day);
  for (const user of users) {
    if (!user.nudgeTime || user.nudgeTime === user.notifyTime) continue;
    if (personAway(user, vac.house, day)) continue;
    const result = await sendNotificationsForUser(user.id, day, undefined, { replace: true });
    console.log(`[notify] nudge ${timeStr} ${user.name}: sent ${result.sent}${result.reason ? ` (${result.reason})` : ""}`);
  }
}
