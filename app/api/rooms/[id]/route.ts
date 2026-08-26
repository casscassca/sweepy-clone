import { NextResponse } from "next/server";
import { scheduleHaMqttSync } from "@/lib/ha-mqtt";
import { prisma } from "@/lib/prisma";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await req.json();
  const room = await prisma.room.update({ where: { id }, data });
  scheduleHaMqttSync();
  return NextResponse.json(room);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.room.delete({ where: { id } });
  scheduleHaMqttSync();
  return NextResponse.json({ ok: true });
}
