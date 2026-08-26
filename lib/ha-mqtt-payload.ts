import { formatAllowedDays } from "./allowed-days";
import { displayTaskName, hasAddon, hasAddon2, isAddon2Due, isAddonDue, isCatchUpTask, isDueToday } from "./addon";
import { cleanlinessPct, dirtinessRatio, dirtWord, dueOnAllowedDay, roomDirtiness } from "./dirtiness";
import { formatFrequency } from "./frequency";

export const UNASSIGNED_ROOM_ID = "unassigned";

export type HaMqttTask = {
  id: string;
  name: string;
  difficulty: number;
  frequencyDays: number;
  lastDoneAt: Date | string | null;
  allowedDays: string | null;
  important: boolean;
  dueOnly: boolean;
  notes: string;
  addonName: string;
  addonFrequencyDays: number;
  addonPoints: number;
  addonLastDoneAt: Date | string | null;
  addon2Name: string;
  addon2FrequencyDays: number;
  addon2Points: number;
  addon2LastDoneAt: Date | string | null;
  assignable: string[];
  roomId: string | null;
  roomName: string | null;
};

export type HaMqttAssignment = {
  taskId: string;
  date: string;
  userId: string;
  userName: string;
};

export type HaMqttRoom = {
  id: string;
  name: string;
  icon: string;
  tasks: HaMqttTask[];
};

export type HaMqttTopics = {
  discoveryPrefix: string;
  base: string;
};

export type MqttMessage = {
  topic: string;
  payload: string;
  retain: boolean;
};

type DeviceInfo = {
  identifiers: string[];
  name: string;
  manufacturer: "Sweepy";
  model: "Room";
};

function roundDirt(ratio: number) {
  return Math.round(ratio * 100) / 100;
}

function isoOrNull(value: Date | string | null): string | null {
  if (!value) return null;
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function taskObjectId(taskId: string) {
  return `sweepy_task_${taskId}`;
}

export function lastDoneObjectId(taskId: string) {
  return `sweepy_task_${taskId}_last_done`;
}

export function addonObjectId(taskId: string) {
  return `sweepy_task_${taskId}_addon`;
}

export function addonLastDoneObjectId(taskId: string) {
  return `sweepy_task_${taskId}_addon_last_done`;
}

export function addon2ObjectId(taskId: string) {
  return `sweepy_task_${taskId}_addon2`;
}

export function addon2LastDoneObjectId(taskId: string) {
  return `sweepy_task_${taskId}_addon2_last_done`;
}

export function roomObjectId(roomId: string) {
  return `sweepy_room_${roomId}`;
}

export function completedTriggerId(taskId: string) {
  return `sweepy_task_${taskId}_completed`;
}

export type HaMqttInventory = { tasks: string[]; rooms: string[]; extras: string[] };

export function parseInventory(raw: unknown): HaMqttInventory {
  if (!raw || typeof raw !== "object") return { tasks: [], rooms: [], extras: [] };
  const tasks = "tasks" in raw && Array.isArray(raw.tasks)
    ? raw.tasks.filter((id): id is string => typeof id === "string")
    : [];
  const rooms = "rooms" in raw && Array.isArray(raw.rooms)
    ? raw.rooms.filter((id): id is string => typeof id === "string")
    : [];
  const extras = "extras" in raw && Array.isArray(raw.extras)
    ? raw.extras.filter((id): id is string => typeof id === "string")
    : [];
  return { tasks, rooms, extras };
}

export function idsToRemove(previous: string[], current: string[]) {
  const keep = new Set(current);
  return previous.filter((id) => !keep.has(id));
}

function roomDevice(roomId: string | null, roomName: string | null): DeviceInfo {
  if (!roomId || roomId === UNASSIGNED_ROOM_ID) {
    return {
      identifiers: [`sweepy_room_${UNASSIGNED_ROOM_ID}`],
      name: "No room",
      manufacturer: "Sweepy",
      model: "Room",
    };
  }
  return {
    identifiers: [`sweepy_room_${roomId}`],
    name: roomName || "Room",
    manufacturer: "Sweepy",
    model: "Room",
  };
}

function origin() {
  return { name: "Sweepy", sw_version: "0.1.0" };
}

function availability(base: string) {
  return {
    availability_topic: `${base}/status`,
    payload_available: "online",
    payload_not_available: "offline",
  };
}

export function roomState(room: HaMqttRoom, asOf: Date) {
  const catalog = room.tasks;
  const empty = catalog.length === 0;
  const dirt = empty ? 0 : roundDirt(roomDirtiness(catalog, asOf));
  const clean = empty ? 0 : Math.round(cleanlinessPct(dirt));
  return {
    cleanliness_pct: clean,
    dirt,
    dirt_word: empty ? "no chores" : dirtWord(dirt),
    task_count: catalog.length,
    icon: room.icon,
    room_id: room.id,
    name: room.name,
  };
}

export function taskState(
  task: HaMqttTask,
  assignment: HaMqttAssignment | undefined,
  asOf: Date,
  today: string,
) {
  const dirt = roundDirt(dirtinessRatio(task.lastDoneAt, task.frequencyDays, asOf));
  const addonOn = hasAddon(task);
  const stackOn = hasAddon2(task);
  return {
    dirt,
    dirt_word: dirtWord(dirt),
    cleanliness_pct: Math.round(cleanlinessPct(dirt)),
    last_done_at: isoOrNull(task.lastDoneAt),
    due_date: dueOnAllowedDay(task.lastDoneAt, task.frequencyDays, task.allowedDays, today),
    assigned_date: assignment?.date ?? null,
    assigned_to: assignment?.userName ?? null,
    assigned_to_id: assignment?.userId ?? null,
    frequency_days: task.frequencyDays,
    frequency: formatFrequency(task.frequencyDays),
    difficulty: task.difficulty,
    important: task.important,
    due_only: task.dueOnly,
    allowed_days: formatAllowedDays(task.allowedDays) || "any",
    notes: task.notes,
    addon_name: addonOn ? task.addonName.trim() : "",
    addon_frequency_days: addonOn ? task.addonFrequencyDays : 0,
    addon_points: addonOn ? task.addonPoints : 0,
    addon_last_done_at: addonOn ? isoOrNull(task.addonLastDoneAt) : null,
    addon_due: isAddonDue(task, asOf),
    addon2_name: stackOn ? task.addon2Name.trim() : "",
    addon2_frequency_days: stackOn ? task.addon2FrequencyDays : 0,
    addon2_points: stackOn ? task.addon2Points : 0,
    addon2_last_done_at: stackOn ? isoOrNull(task.addon2LastDoneAt) : null,
    addon2_due: isAddon2Due(task, asOf),
    overdue: isCatchUpTask(task, asOf),
    due_today: isDueToday(task, asOf),
    assignable: task.assignable,
    room: task.roomName,
    room_id: task.roomId,
    task_id: task.id,
    name: task.name,
    display_name: displayTaskName(task, asOf),
  };
}

export function layerDirtState(opts: {
  name: string;
  lastDoneAt: Date | string | null;
  frequencyDays: number;
  asOf: Date;
  parentId: string;
  layer: "addon" | "addon2";
}) {
  const dirt = roundDirt(dirtinessRatio(opts.lastDoneAt, opts.frequencyDays, opts.asOf));
  return {
    dirt,
    dirt_word: dirtWord(dirt),
    cleanliness_pct: Math.round(cleanlinessPct(dirt)),
    last_done_at: isoOrNull(opts.lastDoneAt),
    frequency_days: opts.frequencyDays,
    frequency: formatFrequency(opts.frequencyDays),
    due: dirt >= 1,
    overdue: dirt > 1,
    parent_task_id: opts.parentId,
    name: opts.name,
    layer: opts.layer,
  };
}

function sensorDiscovery(opts: {
  name: string;
  objectId: string;
  uniqueId: string;
  stateTopic: string;
  valueTemplate: string;
  device: DeviceInfo;
  topics: HaMqttTopics;
  unit?: string;
  icon: string;
  precision?: number;
  stateClass?: string;
  deviceClass?: string;
}) {
  return {
    name: opts.name,
    object_id: opts.objectId,
    unique_id: opts.uniqueId,
    state_topic: opts.stateTopic,
    value_template: opts.valueTemplate,
    json_attributes_topic: opts.stateTopic,
    device: opts.device,
    origin: origin(),
    icon: opts.icon,
    ...(opts.precision !== undefined ? { suggested_display_precision: opts.precision } : {}),
    ...(opts.unit ? { unit_of_measurement: opts.unit } : {}),
    ...(opts.stateClass ? { state_class: opts.stateClass } : {}),
    ...(opts.deviceClass ? { device_class: opts.deviceClass } : {}),
    ...availability(opts.topics.base),
  };
}

export function roomDiscovery(room: HaMqttRoom, topics: HaMqttTopics) {
  const objectId = roomObjectId(room.id);
  return sensorDiscovery({
    name: `${room.name} cleanliness`,
    objectId,
    uniqueId: objectId,
    stateTopic: `${topics.base}/room/${room.id}/state`,
    valueTemplate: "{{ value_json.cleanliness_pct }}",
    device: roomDevice(room.id, room.name),
    topics,
    unit: "%",
    icon: "mdi:broom",
    precision: 0,
    stateClass: "measurement",
  });
}

export function taskDiscovery(task: HaMqttTask, topics: HaMqttTopics) {
  const objectId = taskObjectId(task.id);
  return sensorDiscovery({
    name: task.name,
    objectId,
    uniqueId: objectId,
    stateTopic: `${topics.base}/task/${task.id}/state`,
    valueTemplate: "{{ value_json.dirt }}",
    device: roomDevice(task.roomId, task.roomName),
    topics,
    icon: "mdi:checkbox-marked-outline",
    precision: 2,
    stateClass: "measurement",
  });
}

export function completedTriggerDiscovery(task: HaMqttTask, topics: HaMqttTopics) {
  return {
    automation_type: "trigger",
    type: "action",
    subtype: "completed",
    topic: `${topics.base}/task/${task.id}/event`,
    payload: "completed",
    device: roomDevice(task.roomId, task.roomName),
    origin: origin(),
  };
}

export function lastDoneDiscovery(opts: {
  name: string;
  objectId: string;
  stateTopic: string;
  task: HaMqttTask;
  topics: HaMqttTopics;
}) {
  return sensorDiscovery({
    name: opts.name,
    objectId: opts.objectId,
    uniqueId: opts.objectId,
    stateTopic: opts.stateTopic,
    valueTemplate: "{{ value_json.last_done_at }}",
    device: roomDevice(opts.task.roomId, opts.task.roomName),
    topics: opts.topics,
    icon: "mdi:clock-outline",
    deviceClass: "timestamp",
  });
}

export function addonDirtDiscovery(opts: {
  name: string;
  objectId: string;
  stateTopic: string;
  task: HaMqttTask;
  topics: HaMqttTopics;
}) {
  return sensorDiscovery({
    name: opts.name,
    objectId: opts.objectId,
    uniqueId: opts.objectId,
    stateTopic: opts.stateTopic,
    valueTemplate: "{{ value_json.dirt }}",
    device: roomDevice(opts.task.roomId, opts.task.roomName),
    topics: opts.topics,
    icon: "mdi:checkbox-marked-outline",
    precision: 2,
    stateClass: "measurement",
  });
}

export function tombstoneTopics(
  topics: HaMqttTopics,
  taskIds: string[],
  roomIds: string[],
  extraObjectIds: string[] = [],
): string[] {
  const out: string[] = [];
  for (const id of taskIds) {
    out.push(`${topics.discoveryPrefix}/sensor/${taskObjectId(id)}/config`);
    out.push(`${topics.discoveryPrefix}/sensor/${lastDoneObjectId(id)}/config`);
    out.push(`${topics.discoveryPrefix}/sensor/${addonObjectId(id)}/config`);
    out.push(`${topics.discoveryPrefix}/sensor/${addonLastDoneObjectId(id)}/config`);
    out.push(`${topics.discoveryPrefix}/sensor/${addon2ObjectId(id)}/config`);
    out.push(`${topics.discoveryPrefix}/sensor/${addon2LastDoneObjectId(id)}/config`);
    out.push(`${topics.discoveryPrefix}/device_automation/${completedTriggerId(id)}/config`);
  }
  for (const id of roomIds) {
    out.push(`${topics.discoveryPrefix}/sensor/${roomObjectId(id)}/config`);
  }
  for (const objectId of extraObjectIds) {
    out.push(`${topics.discoveryPrefix}/sensor/${objectId}/config`);
  }
  return out;
}

export function completedEventPayload(opts: {
  task: HaMqttTask;
  completedAt: Date;
  assignedTo: string | null;
  completedBy: string | null;
}) {
  return {
    task_id: opts.task.id,
    name: opts.task.name,
    room: opts.task.roomName,
    room_id: opts.task.roomId,
    assigned_to: opts.assignedTo,
    completed_by: opts.completedBy,
    completed_at: opts.completedAt.toISOString(),
  };
}

export function buildPublishPlan(opts: {
  rooms: HaMqttRoom[];
  unassigned: HaMqttTask[];
  assignments: HaMqttAssignment[];
  asOf: Date;
  today: string;
  topics: HaMqttTopics;
}): { messages: MqttMessage[]; inventory: HaMqttInventory } {
  const { rooms, unassigned, assignments, asOf, today, topics } = opts;
  const nextByTask = new Map<string, HaMqttAssignment>();
  for (const row of assignments) {
    const current = nextByTask.get(row.taskId);
    if (!current || row.date < current.date) nextByTask.set(row.taskId, row);
  }

  const messages: MqttMessage[] = [];
  const taskIds: string[] = [];
  const roomIds: string[] = [];
  const extras: string[] = [];

  function pushDiscovery(component: string, objectId: string, body: object) {
    messages.push({
      topic: `${topics.discoveryPrefix}/${component}/${objectId}/config`,
      payload: JSON.stringify(body),
      retain: true,
    });
  }

  function publishTask(task: HaMqttTask) {
    taskIds.push(task.id);
    const stateTopic = `${topics.base}/task/${task.id}/state`;
    const lastDoneId = lastDoneObjectId(task.id);
    extras.push(lastDoneId);
    pushDiscovery("sensor", taskObjectId(task.id), taskDiscovery(task, topics));
    pushDiscovery("sensor", lastDoneId, lastDoneDiscovery({
      name: `${task.name} last done`,
      objectId: lastDoneId,
      stateTopic,
      task,
      topics,
    }));
    pushDiscovery("device_automation", completedTriggerId(task.id), completedTriggerDiscovery(task, topics));
    messages.push({
      topic: stateTopic,
      payload: JSON.stringify(taskState(task, nextByTask.get(task.id), asOf, today)),
      retain: true,
    });

    if (hasAddon(task)) {
      const addonTopic = `${topics.base}/task/${task.id}/addon/state`;
      const dirtId = addonObjectId(task.id);
      const doneId = addonLastDoneObjectId(task.id);
      extras.push(dirtId, doneId);
      const addonName = task.addonName.trim();
      pushDiscovery("sensor", dirtId, addonDirtDiscovery({
        name: addonName,
        objectId: dirtId,
        stateTopic: addonTopic,
        task,
        topics,
      }));
      pushDiscovery("sensor", doneId, lastDoneDiscovery({
        name: `${addonName} last done`,
        objectId: doneId,
        stateTopic: addonTopic,
        task,
        topics,
      }));
      messages.push({
        topic: addonTopic,
        payload: JSON.stringify(layerDirtState({
          name: addonName,
          lastDoneAt: task.addonLastDoneAt,
          frequencyDays: task.addonFrequencyDays,
          asOf,
          parentId: task.id,
          layer: "addon",
        })),
        retain: true,
      });
    }

    if (hasAddon2(task)) {
      const addonTopic = `${topics.base}/task/${task.id}/addon2/state`;
      const dirtId = addon2ObjectId(task.id);
      const doneId = addon2LastDoneObjectId(task.id);
      extras.push(dirtId, doneId);
      const addonName = task.addon2Name.trim();
      pushDiscovery("sensor", dirtId, addonDirtDiscovery({
        name: addonName,
        objectId: dirtId,
        stateTopic: addonTopic,
        task,
        topics,
      }));
      pushDiscovery("sensor", doneId, lastDoneDiscovery({
        name: `${addonName} last done`,
        objectId: doneId,
        stateTopic: addonTopic,
        task,
        topics,
      }));
      messages.push({
        topic: addonTopic,
        payload: JSON.stringify(layerDirtState({
          name: addonName,
          lastDoneAt: task.addon2LastDoneAt,
          frequencyDays: task.addon2FrequencyDays,
          asOf,
          parentId: task.id,
          layer: "addon2",
        })),
        retain: true,
      });
    }
  }

  function publishRoom(room: HaMqttRoom) {
    if (room.tasks.length === 0 && room.id === UNASSIGNED_ROOM_ID) return;
    roomIds.push(room.id);
    pushDiscovery("sensor", roomObjectId(room.id), roomDiscovery(room, topics));
    messages.push({
      topic: `${topics.base}/room/${room.id}/state`,
      payload: JSON.stringify(roomState(room, asOf)),
      retain: true,
    });
    for (const task of room.tasks) publishTask(task);
  }

  for (const room of rooms) publishRoom(room);
  publishRoom({
    id: UNASSIGNED_ROOM_ID,
    name: "No room",
    icon: "🏠",
    tasks: unassigned,
  });

  messages.push({
    topic: `${topics.base}/inventory`,
    payload: JSON.stringify({ tasks: taskIds, rooms: roomIds, extras }),
    retain: true,
  });

  return { messages, inventory: { tasks: taskIds, rooms: roomIds, extras } };
}
