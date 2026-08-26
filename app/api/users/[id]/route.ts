import { NextResponse } from "next/server";
import { encodeWeek, parseWeek } from "@/lib/capacity";
import { prisma } from "@/lib/prisma";
import { hashPassword, generateWebhookSecret } from "@/lib/auth";
import { scheduleHaMqttSync } from "@/lib/ha-mqtt";
import { prepareAssignments } from "@/lib/scheduler";
import { ymd } from "@/lib/vacation";
import { calendarDayStr } from "@/lib/dates";

function hhmm(raw: unknown, fallback = ""): string {
  if (typeof raw !== "string") return fallback;
  const m = raw.trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return fallback;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return fallback;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  // Only allow specific fields to be set — never accept passwordHash/webhookSecret
  // directly from the client (that would be a mass-assignment hole).
  const data: Record<string, unknown> = {};
  if (typeof body.name === "string") data.name = body.name;
  if (typeof body.haNotifyTarget === "string") data.haNotifyTarget = body.haNotifyTarget;
  if (body.dailyCapacity !== undefined) {
    const v = Math.round(Number(body.dailyCapacity));
    if (Number.isFinite(v)) data.dailyCapacity = Math.min(20, Math.max(1, v));
  }
  if (body.dailyTaskLimit !== undefined) {
    const v = Math.round(Number(body.dailyTaskLimit));
    if (Number.isFinite(v)) data.dailyTaskLimit = Math.min(20, Math.max(1, v));
  }
  if (typeof body.weekdayCapacities === "string") {
    const fallback = typeof data.dailyCapacity === "number" ? data.dailyCapacity : 6;
    data.weekdayCapacities = encodeWeek(parseWeek(body.weekdayCapacities, fallback));
  }
  if (typeof body.weekdayTaskLimits === "string") {
    const fallback = typeof data.dailyTaskLimit === "number" ? data.dailyTaskLimit : 6;
    data.weekdayTaskLimits = encodeWeek(parseWeek(body.weekdayTaskLimits, fallback));
  }
  if (typeof body.weekendShare === "boolean") data.weekendShare = body.weekendShare;
  if (body.weekendCapacity !== undefined) {
    const v = Math.round(Number(body.weekendCapacity));
    if (Number.isFinite(v)) data.weekendCapacity = Math.min(20, Math.max(0, v));
  }
  if (body.weekendTaskLimit !== undefined) {
    const v = Math.round(Number(body.weekendTaskLimit));
    if (Number.isFinite(v)) data.weekendTaskLimit = Math.min(20, Math.max(0, v));
  }
  if (typeof body.notifyTime === "string") data.notifyTime = hhmm(body.notifyTime, "08:00");
  if (typeof body.nudgeTime === "string") data.nudgeTime = hhmm(body.nudgeTime);
  if (typeof body.color === "string") data.color = body.color;
  if (typeof body.vacationOn === "boolean") data.vacationOn = body.vacationOn;
  if (body.vacationStart !== undefined) data.vacationStart = ymd(body.vacationStart);
  if (body.vacationEnd !== undefined) data.vacationEnd = ymd(body.vacationEnd);

  // Set a password (hashed). Empty/whitespace is ignored.
  if (typeof body.password === "string" && body.password.trim().length > 0) {
    data.passwordHash = hashPassword(body.password);
  }
  // Rotate the webhook token on request.
  if (body.regenerateWebhookSecret === true) {
    data.webhookSecret = generateWebhookSecret();
  }

  const user = await prisma.user.update({
    where: { id },
    data,
    omit: { passwordHash: false, webhookSecret: false },
  });
  if (typeof body.vacationOn === "boolean" || body.vacationStart !== undefined || body.vacationEnd !== undefined) {
    await prepareAssignments(calendarDayStr());
  }
  scheduleHaMqttSync();
  const { passwordHash, ...rest } = user;
  return NextResponse.json({ ...rest, hasPassword: passwordHash != null });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.user.delete({ where: { id } });
  scheduleHaMqttSync();
  return NextResponse.json({ ok: true });
}
