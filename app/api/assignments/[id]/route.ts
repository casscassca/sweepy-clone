import { NextResponse } from "next/server";
import { scheduleHaMqttSync } from "@/lib/ha-mqtt";
import { prisma } from "@/lib/prisma";
import { holdAssignmentOnDate } from "@/lib/scheduler";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const assignment = await prisma.dailyAssignment.findUnique({
    where: { id },
    include: { task: { select: { oneOff: true, id: true } } },
  });
  if (!assignment) return NextResponse.json({ ok: true });
  await prisma.dailyAssignment.delete({ where: { id } });
  if (assignment.task.oneOff) {
    const logs = await prisma.completionLog.count({ where: { taskId: assignment.task.id } });
    if (logs === 0) await prisma.task.delete({ where: { id: assignment.task.id } });
  }
  scheduleHaMqttSync();
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { date, userId, order, pinned } = await req.json();

  if (typeof pinned === "boolean") {
    const row = await prisma.dailyAssignment.update({
      where: { id },
      data: { pinned, ...(pinned ? { held: true } : {}) },
    });
    scheduleHaMqttSync();
    return NextResponse.json(row);
  }

  if (typeof date === "string") {
    const assignment = await holdAssignmentOnDate(id, date);
    if (!assignment) return NextResponse.json({ ok: false, reason: "not found" }, { status: 404 });
    if (typeof userId === "string" || typeof order === "number") {
      const row = await prisma.dailyAssignment.update({
        where: { id: assignment.id },
        data: {
          ...(typeof userId === "string" && { userId }),
          ...(typeof order === "number" && { order }),
        },
      });
      scheduleHaMqttSync();
      return NextResponse.json(row);
    }
    scheduleHaMqttSync();
    return NextResponse.json(assignment);
  }

  const assignment = await prisma.dailyAssignment.update({
    where: { id },
    data: {
      ...(typeof userId === "string" && { userId, held: true }),
      ...(order !== undefined && { order }),
    },
  });
  scheduleHaMqttSync();
  return NextResponse.json(assignment);
}
