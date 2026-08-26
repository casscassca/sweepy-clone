import { addDays } from "date-fns";
import { calendarDaysBetween } from "./dates";
import { prisma } from "./prisma";
import { dirtAsOfDate, houseVacationActive, personAway, type HouseVacation } from "./vacation";

const HOUSE_SELECT = {
  houseVacation: true,
  houseVacationStart: true,
  houseVacationEnd: true,
  pauseDirtiness: true,
  dirtFrozenOn: true,
} as const;

export async function loadHouseVacation(): Promise<HouseVacation> {
  const s = await prisma.settings.upsert({
    where: { id: "singleton" },
    create: { id: "singleton" },
    update: {},
    select: HOUSE_SELECT,
  });
  return s;
}

export async function loadVacationContext(day: string) {
  const [house, users] = await Promise.all([
    loadHouseVacation(),
    prisma.user.findMany({
      select: { id: true, vacationOn: true, vacationStart: true, vacationEnd: true },
    }),
  ]);
  const awayIds = new Set(users.filter((u) => personAway(u, house, day)).map((u) => u.id));
  return { house, users, awayIds, dirtAsOf: dirtAsOfDate(house, day) };
}

export async function applyDirtPause(day: string) {
  const house = await loadHouseVacation();
  const pausing = houseVacationActive(house, day) && house.pauseDirtiness;
  if (pausing) {
    if (!house.dirtFrozenOn) {
      await prisma.settings.update({
        where: { id: "singleton" },
        data: { dirtFrozenOn: day },
      });
    }
    return;
  }
  if (!house.dirtFrozenOn) return;
  const days = calendarDaysBetween(day, house.dirtFrozenOn);
  if (days > 0) {
    const tasks = await prisma.task.findMany({
      select: { id: true, lastDoneAt: true, addonLastDoneAt: true, addon2LastDoneAt: true },
    });
    for (const task of tasks) {
      const data: { lastDoneAt?: Date; addonLastDoneAt?: Date; addon2LastDoneAt?: Date } = {};
      if (task.lastDoneAt) data.lastDoneAt = addDays(task.lastDoneAt, days);
      if (task.addonLastDoneAt) data.addonLastDoneAt = addDays(task.addonLastDoneAt, days);
      if (task.addon2LastDoneAt) data.addon2LastDoneAt = addDays(task.addon2LastDoneAt, days);
      if (Object.keys(data).length > 0) {
        await prisma.task.update({ where: { id: task.id }, data });
      }
    }
  }
  await prisma.settings.update({
    where: { id: "singleton" },
    data: { dirtFrozenOn: "" },
  });
}
