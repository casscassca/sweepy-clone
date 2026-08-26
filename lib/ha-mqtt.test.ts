import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildPublishPlan,
  idsToRemove,
  parseInventory,
  roomObjectId,
  taskObjectId,
  taskState,
  tombstoneTopics,
} from "./ha-mqtt-payload";

const asOf = new Date("2026-08-19T12:00:00-05:00");
const today = "2026-08-19";
const topics = { discoveryPrefix: "homeassistant", base: "sweepy" };

const feeder = {
  id: "task1",
  name: "Pet feeder",
  difficulty: 1,
  frequencyDays: 7,
  lastDoneAt: new Date("2026-08-12T12:00:00-05:00"),
  allowedDays: null,
  important: false,
  dueOnly: false,
  notes: "Wipe the tray",
  addonName: "",
  addonFrequencyDays: 0,
  addonPoints: 1,
  addonLastDoneAt: null,
  assignable: ["Cass"],
  roomId: "room1",
  roomName: "Kitchen",
};

describe("ha mqtt payloads", () => {
  it("keeps object ids stable from the task cuid", () => {
    assert.equal(taskObjectId("clxyz"), "sweepy_task_clxyz");
    assert.equal(roomObjectId("room1"), "sweepy_room_room1");
  });

  it("puts dirt, due day, and assigned day on the task state", () => {
    const state = taskState(
      feeder,
      { taskId: "task1", date: "2026-08-19", userId: "u1", userName: "Cass" },
      asOf,
      today,
    );
    assert.equal(state.dirt, 1);
    assert.equal(state.dirt_word, "due");
    assert.equal(state.due_date, "2026-08-19");
    assert.equal(state.assigned_date, "2026-08-19");
    assert.equal(state.assigned_to, "Cass");
    assert.equal(state.notes, "Wipe the tray");
    assert.equal(state.due_today, true);
    assert.equal(state.overdue, false);
  });

  it("publishes a room cleanliness sensor and a task under that room device", () => {
    const { messages, inventory } = buildPublishPlan({
      rooms: [{ id: "room1", name: "Kitchen", icon: "🍳", tasks: [feeder] }],
      unassigned: [],
      assignments: [{ taskId: "task1", date: "2026-08-19", userId: "u1", userName: "Cass" }],
      asOf,
      today,
      topics,
    });
    const topicsOut = messages.map((m) => m.topic);
    assert.ok(topicsOut.includes("homeassistant/sensor/sweepy_room_room1/config"));
    assert.ok(topicsOut.includes("homeassistant/sensor/sweepy_task_task1/config"));
    assert.ok(topicsOut.includes("homeassistant/device_automation/sweepy_task_task1_completed/config"));
    assert.deepEqual(inventory, { tasks: ["task1"], rooms: ["room1"] });

    const roomStateMsg = messages.find((m) => m.topic === "sweepy/room/room1/state");
    assert.ok(roomStateMsg);
    const roomJson: unknown = JSON.parse(roomStateMsg.payload);
    assert.ok(roomJson && typeof roomJson === "object" && "cleanliness_pct" in roomJson);
    assert.equal(roomJson.cleanliness_pct, 88);

    const taskDisc = messages.find((m) => m.topic === "homeassistant/sensor/sweepy_task_task1/config");
    assert.ok(taskDisc);
    const disc: unknown = JSON.parse(taskDisc.payload);
    assert.ok(disc && typeof disc === "object" && "device" in disc);
    const device = disc.device;
    assert.ok(device && typeof device === "object" && "name" in device);
    assert.equal(device.name, "Kitchen");
  });

  it("skips the unassigned room when every chore has a room", () => {
    const { inventory } = buildPublishPlan({
      rooms: [{ id: "room1", name: "Kitchen", icon: "🍳", tasks: [feeder] }],
      unassigned: [],
      assignments: [],
      asOf,
      today,
      topics,
    });
    assert.equal(inventory.rooms.includes("unassigned"), false);
  });

  it("tombstones removed tasks and rooms", () => {
    assert.deepEqual(idsToRemove(["a", "b"], ["b"]), ["a"]);
    const topicsOut = tombstoneTopics(topics, ["gone"], ["oldroom"]);
    assert.ok(topicsOut.includes("homeassistant/sensor/sweepy_task_gone/config"));
    assert.ok(topicsOut.includes("homeassistant/device_automation/sweepy_task_gone_completed/config"));
    assert.ok(topicsOut.includes("homeassistant/sensor/sweepy_room_oldroom/config"));
  });

  it("reads a retained inventory payload", () => {
    assert.deepEqual(parseInventory({ tasks: ["t1"], rooms: ["r1"] }), { tasks: ["t1"], rooms: ["r1"] });
    assert.deepEqual(parseInventory("nope"), { tasks: [], rooms: [] });
  });
});
