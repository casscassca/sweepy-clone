import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { scheduleHaMqttSync } from "@/lib/ha-mqtt";
import { addTaskToDate, createOneOff } from "@/lib/scheduler";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import { format } from "date-fns";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date") ?? format(new Date(), "yyyy-MM-dd");

  const assignments = await prisma.dailyAssignment.findMany({
    where: { date, parked: false },
    include: {
      task: { include: { room: true } },
      user: true,
    },
    orderBy: [{ userId: "asc" }, { order: "asc" }],
  });

  return NextResponse.json(assignments);
}

// Reorder or reassign
export async function PATCH(req: Request) {
  const { assignments } = await req.json();
  // assignments: Array<{ id: string, userId: string, order: number }>

  await Promise.all(
    assignments.map(({ id, userId, order, held }: { id: string; userId: string; order: number; held?: boolean }) =>
      prisma.dailyAssignment.update({
        where: { id },
        data: { userId, order, ...(held === true && { held: true }) },
      })
    )
  );

  scheduleHaMqttSync();
  return NextResponse.json({ ok: true });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const day = typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
    ? body.date
    : format(new Date(), "yyyy-MM-dd");

  if (body.oneOff) {
    if (typeof body.name !== "string" || typeof body.userId !== "string") {
      return NextResponse.json({ ok: false, reason: "name and userId required" }, { status: 400 });
    }
    const result = await createOneOff({
      name: body.name,
      userId: body.userId,
      difficulty: Number(body.difficulty) || 1,
      date: day,
    });
    if (!result.ok) return NextResponse.json(result, { status: result.status });
    return NextResponse.json(result, { status: 201 });
  }

  const taskIds = Array.isArray(body.taskIds)
    ? body.taskIds.filter((id: unknown) => typeof id === "string" && id)
    : typeof body.taskId === "string" && body.taskId
      ? [body.taskId]
      : [];
  if (taskIds.length === 0) {
    return NextResponse.json({ ok: false, reason: "taskId required" }, { status: 400 });
  }
  const cookieStore = await cookies();
  const userId = await verifySessionToken(cookieStore.get(COOKIE_NAME)?.value);
  const results = [];
  for (const taskId of taskIds) {
    const result = await addTaskToDate(taskId, day, userId ?? undefined);
    if (!result.ok) return NextResponse.json(result, { status: result.status });
    results.push(result);
  }
  scheduleHaMqttSync();
  return NextResponse.json(taskIds.length === 1 ? results[0] : { ok: true, added: results.length });
}
