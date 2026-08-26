import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { haConfig, listHaNotifyCatalog, resolveNotifyTarget } from "@/lib/ha";
import { haEventStatus } from "@/lib/ha-events";
import { haMqttStatus } from "@/lib/ha-mqtt";

export async function GET() {
  const ha = haConfig();
  const mqtt = haMqttStatus();
  const log = prisma.integrationLog
    ? await prisma.integrationLog.findMany({
        orderBy: { createdAt: "desc" },
        take: 40,
      })
    : [];

  if (!ha) {
    return NextResponse.json({
      configured: false,
      url: null,
      reachable: false,
      error: "HA_URL or HA_TOKEN is not set",
      services: [],
      entities: [],
      people: [],
      log,
      mqtt,
    });
  }

  const catalog = await listHaNotifyCatalog(ha);
  const users = await prisma.user.findMany({
    select: { name: true, haNotifyTarget: true },
    orderBy: { createdAt: "asc" },
  });
  const people = users.map((u) => {
    if (!u.haNotifyTarget) {
      return { name: u.name, target: "", resolved: null, ok: false, hint: "no notify target" };
    }
    const resolved = resolveNotifyTarget(u.haNotifyTarget, catalog);
    return {
      name: u.name,
      target: u.haNotifyTarget,
      resolved: resolved.ok ? `notify.${resolved.service}` : null,
      ok: resolved.ok,
      hint: resolved.hint ?? null,
    };
  });

  const events = haEventStatus();
  return NextResponse.json({
    configured: true,
    url: ha.url,
    reachable: catalog.reachable,
    listening: events.listening,
    lastEventAt: events.lastEventAt,
    listenError: events.lastError,
    error: catalog.error ?? null,
    services: catalog.services.map((s) => `notify.${s}`),
    entities: catalog.entities,
    people,
    log,
    mqtt,
  });
}
