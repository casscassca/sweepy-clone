import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { scheduleHaMqttSync } from "@/lib/ha-mqtt";
import { prepareAssignments } from "@/lib/scheduler";
import { houseVacationActive, ymd } from "@/lib/vacation";
import { calendarDayStr } from "@/lib/dates";

function withDirtAsOf<T extends {
  houseVacation: boolean;
  houseVacationStart: string;
  houseVacationEnd: string;
  pauseDirtiness: boolean;
  dirtFrozenOn: string;
}>(settings: T) {
  const day = calendarDayStr();
  const frozen = houseVacationActive(settings, day) && settings.pauseDirtiness && settings.dirtFrozenOn
    ? settings.dirtFrozenOn
    : null;
  return { ...settings, dirtAsOf: frozen };
}

export async function GET() {
  const settings = await prisma.settings.upsert({
    where: { id: "singleton" },
    create: { id: "singleton" },
    update: {},
  });
  const { sessionSecret, haUrl: _haUrl, haToken: _haToken, ...safe } = settings;
  return NextResponse.json(withDirtAsOf(safe));
}

export async function PATCH(req: Request) {
  const body = await req.json();
  const data: Record<string, unknown> = {};
  if (typeof body.darkMode === "boolean") data.darkMode = body.darkMode;
  if (typeof body.weekendShare === "boolean") data.weekendShare = body.weekendShare;
  if (typeof body.houseVacation === "boolean") data.houseVacation = body.houseVacation;
  if (body.houseVacationStart !== undefined) data.houseVacationStart = ymd(body.houseVacationStart);
  if (body.houseVacationEnd !== undefined) data.houseVacationEnd = ymd(body.houseVacationEnd);
  if (typeof body.pauseDirtiness === "boolean") data.pauseDirtiness = body.pauseDirtiness;

  const settings = await prisma.settings.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", ...data },
    update: data,
  });
  await prepareAssignments(calendarDayStr());
  scheduleHaMqttSync();
  const { sessionSecret, haUrl: _haUrl, haToken: _haToken, ...safe } = settings;
  return NextResponse.json(withDirtAsOf(safe));
}
