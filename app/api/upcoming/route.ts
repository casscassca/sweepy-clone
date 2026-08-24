import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { format, addDays, parseISO } from "date-fns";

function daysFrom(from: string | null, count = 21): string[] {
  const start = from && /^\d{4}-\d{2}-\d{2}$/.test(from)
    ? from
    : format(new Date(), "yyyy-MM-dd");
  const noon = parseISO(`${start}T12:00:00`);
  return Array.from({ length: count }, (_, i) => format(addDays(noon, i), "yyyy-MM-dd"));
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const days = daysFrom(searchParams.get("from"));

  try {
    const assignments = await prisma.dailyAssignment.findMany({
      where: { date: { in: days }, parked: false },
      include: {
        task: { include: { room: true, assignableUsers: { include: { user: true } } } },
        user: true,
      },
      orderBy: [{ date: "asc" }, { userId: "asc" }, { order: "asc" }],
    });

    return NextResponse.json({ days, assignments });
  } catch (err) {
    const message = err instanceof Error ? err.message : "upcoming failed";
    console.error("[upcoming]", err);
    return NextResponse.json({ days, assignments: [], error: message }, { status: 500 });
  }
}
