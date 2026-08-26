import { NextResponse } from "next/server";
import { addonFields } from "@/lib/addon";
import { normalizeAllowedDays } from "@/lib/allowed-days";
import { scheduleHaMqttSync } from "@/lib/ha-mqtt";
import { prisma } from "@/lib/prisma";
import { dropCleanUnheldAssignments } from "@/lib/scheduler";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { name, roomId, difficulty, frequencyDays, allowedDays, assignableUserIds, lastDoneAt, important, dueOnly, notes, addonName, addonFrequencyDays, addonPoints, addonLastDoneAt, addon2Name, addon2FrequencyDays, addon2Points, addon2LastDoneAt } = await req.json();
  const addon = addonName !== undefined
    ? addonFields({ addonName, addonFrequencyDays, addonPoints, addonLastDoneAt, addon2Name, addon2FrequencyDays, addon2Points, addon2LastDoneAt })
    : null;

  // Replace assignable users if provided
  if (assignableUserIds !== undefined) {
    await prisma.taskAssignableUser.deleteMany({ where: { taskId: id } });
    if (assignableUserIds.length > 0) {
      await prisma.taskAssignableUser.createMany({
        data: assignableUserIds.map((userId: string) => ({ taskId: id, userId })),
      });
    }
  }

  const task = await prisma.task.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(roomId !== undefined && { roomId }),
      ...(difficulty !== undefined && { difficulty: Number(difficulty) }),
      ...(frequencyDays !== undefined && { frequencyDays: Number(frequencyDays) }),
      ...(allowedDays !== undefined && { allowedDays: normalizeAllowedDays(allowedDays) }),
      ...(lastDoneAt !== undefined && { lastDoneAt: lastDoneAt ? new Date(lastDoneAt) : null }),
      ...(important !== undefined && { important: Boolean(important) }),
      ...(dueOnly !== undefined && { dueOnly: Boolean(dueOnly) }),
      ...(notes !== undefined && { notes: typeof notes === "string" ? notes.trim().slice(0, 2000) : "" }),
      ...(addon && addon),
    },
    include: { assignableUsers: { include: { user: true } } },
  });

  await dropCleanUnheldAssignments();
  scheduleHaMqttSync();
  return NextResponse.json(task);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.task.delete({ where: { id } });
  scheduleHaMqttSync();
  return NextResponse.json({ ok: true });
}
