import { NextResponse } from "next/server";
import { calendarDayStr } from "@/lib/dates";
import { householdLoad } from "@/lib/load";
import { prisma } from "@/lib/prisma";
import { dirtAsOfDate, type HouseVacation } from "@/lib/vacation";

export async function GET() {
  const [tasks, people, settings] = await Promise.all([
    prisma.task.findMany({
      where: { oneOff: false },
      select: {
        difficulty: true,
        frequencyDays: true,
        lastDoneAt: true,
        addonName: true,
        addonFrequencyDays: true,
        addonPoints: true,
        addonLastDoneAt: true,
        addon2Name: true,
        addon2FrequencyDays: true,
        addon2Points: true,
        addon2LastDoneAt: true,
      },
    }),
    prisma.user.findMany({
      select: {
        dailyCapacity: true,
        dailyTaskLimit: true,
        weekdayCapacities: true,
        weekdayTaskLimits: true,
        weekendShare: true,
        weekendCapacity: true,
        weekendTaskLimit: true,
      },
    }),
    prisma.settings.findUnique({
      where: { id: "singleton" },
      select: {
        houseVacation: true,
        houseVacationStart: true,
        houseVacationEnd: true,
        pauseDirtiness: true,
        dirtFrozenOn: true,
      },
    }),
  ]);

  const house: HouseVacation = settings ?? {
    houseVacation: false,
    houseVacationStart: "",
    houseVacationEnd: "",
    pauseDirtiness: false,
    dirtFrozenOn: "",
  };

  return NextResponse.json(householdLoad(tasks, people, dirtAsOfDate(house, calendarDayStr())));
}
