import { connect, type MqttClient } from "mqtt";
import { calendarDayStr } from "./dates";
import {
  buildPublishPlan,
  completedEventPayload,
  idsToRemove,
  parseInventory,
  tombstoneTopics,
  type HaMqttAssignment,
  type HaMqttTask,
  type HaMqttTopics,
  type MqttMessage,
} from "./ha-mqtt-payload";
import { prisma } from "./prisma";
import { loadVacationContext } from "./vacation-db";

function envValue(name: string) {
  return (process.env[name] ?? "").trim().replace(/^['"]+|['"]+$/g, "");
}

export type MqttConn = {
  url: string;
  username: string | null;
  password: string | null;
  topics: HaMqttTopics;
};

export function mqttConfig(): MqttConn | null {
  const url = envValue("MQTT_URL").replace(/\/$/, "");
  if (!url) return null;
  const username = envValue("MQTT_USER");
  const password = envValue("MQTT_PASSWORD");
  return {
    url,
    username: username || null,
    password: password || null,
    topics: {
      discoveryPrefix: envValue("MQTT_DISCOVERY_PREFIX") || "homeassistant",
      base: envValue("MQTT_BASE") || "sweepy",
    },
  };
}

type MqttStatus = {
  configured: boolean;
  connected: boolean;
  lastError: string | null;
  lastSyncAt: string | null;
  url: string | null;
};

const status: MqttStatus = {
  configured: false,
  connected: false,
  lastError: null,
  lastSyncAt: null,
  url: null,
};

let started = false;
let client: MqttClient | null = null;
let syncTimer: ReturnType<typeof setTimeout> | null = null;
let syncLock: Promise<void> = Promise.resolve();
let lastInventory: { tasks: string[]; rooms: string[] } = { tasks: [], rooms: [] };
let inventoryHydrated = false;

export function haMqttStatus() {
  return { ...status };
}

export function startHaMqtt() {
  if (started) return;
  started = true;
  const cfg = mqttConfig();
  if (!cfg) {
    status.configured = false;
    status.lastError = "MQTT_URL is not set";
    return;
  }
  status.configured = true;
  status.url = cfg.url;
  connectBroker(cfg);
}

function connectBroker(cfg: MqttConn) {
  const next = connect(cfg.url, {
    reconnectPeriod: 5000,
    protocolVersion: 4,
    username: cfg.username ?? undefined,
    password: cfg.password ?? undefined,
    will: {
      topic: `${cfg.topics.base}/status`,
      payload: "offline",
      retain: true,
      qos: 1,
    },
  });
  client = next;

  next.on("connect", () => {
    status.connected = true;
    status.lastError = null;
    console.log(`[ha-mqtt] connected to ${cfg.url}`);
    next.publish(`${cfg.topics.base}/status`, "online", { retain: true, qos: 1 });
    void (async () => {
      if (!inventoryHydrated) {
        lastInventory = await readRetainedInventory(next, cfg);
        inventoryHydrated = true;
      }
      await runInventorySync();
    })();
  });

  next.on("offline", () => {
    status.connected = false;
  });

  next.on("error", (err) => {
    status.connected = false;
    status.lastError = err.message;
    console.warn("[ha-mqtt]", err.message);
  });
}

function readRetainedInventory(sock: MqttClient, cfg: MqttConn) {
  const topic = `${cfg.topics.base}/inventory`;
  return new Promise<{ tasks: string[]; rooms: string[] }>((resolve) => {
    const timer = setTimeout(() => {
      sock.removeListener("message", onMessage);
      resolve({ tasks: [], rooms: [] });
    }, 1500);
    const onMessage = (t: string, payload: Buffer) => {
      if (t !== topic) return;
      clearTimeout(timer);
      sock.removeListener("message", onMessage);
      let raw: unknown = null;
      try {
        raw = JSON.parse(payload.toString());
      } catch {
        raw = null;
      }
      resolve(parseInventory(raw));
    };
    sock.on("message", onMessage);
    sock.subscribe(topic, { qos: 1 });
  });
}

export function scheduleHaMqttSync() {
  if (!mqttConfig()) return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    void runInventorySync();
  }, 800);
}

export async function publishHaMqttTaskEvent(opts: {
  kind: "completed" | "uncompleted";
  taskId: string;
  completedAt: Date;
  userId?: string | null;
  completedById?: string | null;
}) {
  const cfg = mqttConfig();
  if (!cfg) return;
  const task = await loadTask(opts.taskId);
  if (!task) {
    scheduleHaMqttSync();
    return;
  }
  const [assignedTo, completedBy] = await Promise.all([
    nameFor(opts.userId),
    nameFor(opts.completedById),
  ]);
  if (opts.kind === "completed") {
    await publish({
      topic: `${cfg.topics.base}/task/${task.id}/event`,
      payload: "completed",
      retain: false,
    });
    await publish({
      topic: `${cfg.topics.base}/event/task_completed`,
      payload: JSON.stringify(completedEventPayload({
        task,
        completedAt: opts.completedAt,
        assignedTo,
        completedBy,
      })),
      retain: false,
    });
  }
  scheduleHaMqttSync();
}

async function nameFor(userId: string | null | undefined) {
  if (!userId) return null;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
  return user?.name ?? null;
}

async function runInventorySync() {
  const cfg = mqttConfig();
  if (!cfg || !client?.connected) return;
  const previous = syncLock;
  let unlock = () => {};
  syncLock = new Promise<void>((resolve) => {
    unlock = resolve;
  });
  await previous;
  try {
    await publishInventory(cfg);
  } catch (err) {
    status.lastError = err instanceof Error ? err.message : String(err);
    console.warn("[ha-mqtt] sync failed", status.lastError);
  } finally {
    unlock();
  }
}

async function publishInventory(cfg: MqttConn) {
  const today = calendarDayStr();
  const [rooms, unassigned, open, vac] = await Promise.all([
    prisma.room.findMany({
      orderBy: { order: "asc" },
      include: {
        tasks: {
          where: { oneOff: false },
          orderBy: { createdAt: "asc" },
          include: { assignableUsers: { include: { user: { select: { name: true } } } } },
        },
      },
    }),
    prisma.task.findMany({
      where: { oneOff: false, roomId: null },
      include: { assignableUsers: { include: { user: { select: { name: true } } } }, room: true },
    }),
    prisma.dailyAssignment.findMany({
      where: { completedAt: null, parked: false, task: { oneOff: false } },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { date: "asc" },
    }),
    loadVacationContext(today),
  ]);

  const assignments: HaMqttAssignment[] = open.map((row) => ({
    taskId: row.taskId,
    date: row.date,
    userId: row.user.id,
    userName: row.user.name,
  }));

  const { messages, inventory } = buildPublishPlan({
    rooms: rooms.map((room) => ({
      id: room.id,
      name: room.name,
      icon: room.icon,
      tasks: room.tasks.map(toHaTask),
    })),
    unassigned: unassigned.map(toHaTask),
    assignments,
    asOf: vac.dirtAsOf,
    today,
    topics: cfg.topics,
  });

  for (const topic of tombstoneTopics(
    cfg.topics,
    idsToRemove(lastInventory.tasks, inventory.tasks),
    idsToRemove(lastInventory.rooms, inventory.rooms),
  )) {
    await publish({ topic, payload: "", retain: true });
  }

  for (const message of messages) await publish(message);
  lastInventory = inventory;
  status.lastSyncAt = new Date().toISOString();
}

function toHaTask(task: {
  id: string;
  name: string;
  difficulty: number;
  frequencyDays: number;
  lastDoneAt: Date | null;
  allowedDays: string | null;
  important: boolean;
  dueOnly: boolean;
  notes: string;
  addonName: string;
  addonFrequencyDays: number;
  addonPoints: number;
  addonLastDoneAt: Date | null;
  addon2Name: string;
  addon2FrequencyDays: number;
  addon2Points: number;
  addon2LastDoneAt: Date | null;
  roomId: string | null;
  room?: { name: string } | null;
  assignableUsers: { user: { name: string } }[];
}): HaMqttTask {
  return {
    id: task.id,
    name: task.name,
    difficulty: task.difficulty,
    frequencyDays: task.frequencyDays,
    lastDoneAt: task.lastDoneAt,
    allowedDays: task.allowedDays,
    important: task.important,
    dueOnly: task.dueOnly,
    notes: task.notes,
    addonName: task.addonName,
    addonFrequencyDays: task.addonFrequencyDays,
    addonPoints: task.addonPoints,
    addonLastDoneAt: task.addonLastDoneAt,
    addon2Name: task.addon2Name,
    addon2FrequencyDays: task.addon2FrequencyDays,
    addon2Points: task.addon2Points,
    addon2LastDoneAt: task.addon2LastDoneAt,
    assignable: task.assignableUsers.map((row) => row.user.name),
    roomId: task.roomId,
    roomName: task.room?.name ?? null,
  };
}

async function loadTask(taskId: string): Promise<HaMqttTask | null> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      room: true,
      assignableUsers: { include: { user: { select: { name: true } } } },
    },
  });
  if (!task || task.oneOff) return null;
  return toHaTask(task);
}

async function publish(message: MqttMessage) {
  const sock = client;
  if (!sock?.connected) return;
  await new Promise<void>((resolve, reject) => {
    sock.publish(message.topic, message.payload, { retain: message.retain, qos: 1 }, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}
