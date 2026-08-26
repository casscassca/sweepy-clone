"use client";
import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Pencil, Trash2, Plus, ChevronDown, ChevronRight, Check, CheckCircle2, Circle, Search, Star, UserCheck } from "lucide-react";
import TaskFormFields, { formatFrequency, parseTaskForm } from "@/components/TaskFormFields";
import CompleteAsMenu from "@/components/CompleteAsMenu";
import RoomDirtGauge from "@/components/RoomDirtGauge";
import DirtGauge from "@/components/DirtGauge";
import { addonDetail, displayTaskDifficulty, displayTaskName, hasAddon, isCatchUpTask, isDueToday } from "@/lib/addon";
import { formatAllowedDays } from "@/lib/allowed-days";
import { dirtDetail, dirtinessRatio } from "@/lib/dirtiness";
import { invalidateLists, loadJson } from "@/lib/api-cache";

type User = { id: string; name: string; color: string };
type Task = {
  id: string;
  name: string;
  difficulty: number;
  frequencyDays: number;
  lastDoneAt: string | null;
  allowedDays: string | null;
  important?: boolean;
  dueOnly?: boolean;
  notes?: string;
  addonName?: string;
  addonFrequencyDays?: number;
  addonPoints?: number;
  addonLastDoneAt?: string | null;
  addon2Name?: string;
  addon2FrequencyDays?: number;
  addon2Points?: number;
  addon2LastDoneAt?: string | null;
  assignableUsers: { user: User }[];
};
type Room = { id: string; name: string; icon: string; tasks: Task[] };

const DIFF = [
  { value: 1, label: "Quick", color: "#a78bfa" },
  { value: 2, label: "Medium", color: "#fb923c" },
  { value: 3, label: "Big job", color: "#f87171" },
];

function freqLabel(days: number) {
  return formatFrequency(days);
}

function DiffBadge({ n }: { n: number }) {
  const d = DIFF[n - 1];
  return (
    <span
      className="text-xs font-medium px-1.5 py-0.5 rounded-full"
      style={{ background: d.color + "22", color: d.color }}
    >
      {d.label}
    </span>
  );
}

function doneOn(lastDoneAt: string | null, day: string) {
  return !!lastDoneAt && format(new Date(lastDoneAt), "yyyy-MM-dd") === day;
}

function CatalogTaskRow({
  task,
  users,
  meId,
  today,
  onToday,
  adding,
  onAddToday,
  onComplete,
  onUncomplete,
  onEdit,
  onDelete,
  dirtAsOf,
}: {
  task: Task;
  users: User[];
  meId?: string;
  today: string;
  onToday: boolean;
  adding: boolean;
  onAddToday: () => void;
  onComplete: (by: string | null, date?: string) => void;
  onUncomplete: () => void;
  onEdit: () => void;
  onDelete: () => void;
  dirtAsOf?: Date;
}) {
  const [showWho, setShowWho] = useState(false);
  const done = doneOn(task.lastDoneAt, today);
  const ratio = dirtinessRatio(task.lastDoneAt, task.frequencyDays, dirtAsOf);
  const catchUp = isCatchUpTask(task, dirtAsOf);

  function markMine() {
    if (meId) onComplete(meId);
    else setShowWho(true);
  }

  return (
    <div className="flex items-center gap-2 px-3 py-3 group/task relative">
      <button
        type="button"
        onClick={() => { if (done) onUncomplete(); else markMine(); }}
        aria-label={done ? "Mark incomplete" : "Mark complete"}
        className="shrink-0 min-h-11 w-9 flex items-center justify-center"
        style={{ color: done ? "var(--green)" : "var(--text3)" }}
      >
        {done ? <CheckCircle2 size={22} /> : <Circle size={22} />}
      </button>
      <DirtGauge
        ratio={ratio}
        title={dirtDetail(task.lastDoneAt, task.frequencyDays, dirtAsOf)}
      />
      <div className="flex-1 min-w-0">
        <div
          className="text-sm font-medium inline-flex items-center gap-1.5"
          style={{ opacity: done ? 0.35 : 1, textDecoration: done ? "line-through" : "none" }}
        >
          {task.important && (
            <Star size={12} fill="currentColor" className="shrink-0" style={{ color: "var(--accent)", textDecoration: "none" }} />
          )}
          {displayTaskName(task)}
        </div>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <DiffBadge n={displayTaskDifficulty(task)} />
          <span className="text-xs" style={{ color: "var(--text3)" }}>{freqLabel(task.frequencyDays)}</span>
          {catchUp && (
            <span className="text-xs" style={{ color: "var(--red)" }}>
              {task.lastDoneAt ? "past due" : "never done"}
            </span>
          )}
          {hasAddon(task) && (
            <span className="text-xs" style={{ color: "var(--text3)" }}>{addonDetail(task)}</span>
          )}
          {task.notes?.trim() && (
            <span className="text-xs" style={{ color: "var(--text3)" }}>note</span>
          )}
          {task.allowedDays && (
            <span className="text-xs" style={{ color: "var(--text3)" }}>{formatAllowedDays(task.allowedDays)}</span>
          )}
          {task.assignableUsers.length > 0 && (
            <span className="text-xs" style={{ color: "var(--text3)" }}>
              → {task.assignableUsers.map((au) => au.user.name).join(", ")}
            </span>
          )}
        </div>
      </div>
      <div className="flex gap-1 opacity-100 md:opacity-0 md:group-hover/task:opacity-100 transition-opacity">
        {!done && (
          <button
            type="button"
            onClick={() => setShowWho(true)}
            className="p-2 rounded-lg"
            style={{ color: "var(--text3)" }}
            title="Done as someone else"
            aria-label="Mark done as someone else"
          >
            <UserCheck size={16} />
          </button>
        )}
        <button
          onClick={onAddToday}
          disabled={adding}
          className="p-2 rounded-lg"
          style={{ color: onToday ? "var(--green)" : "var(--text3)" }}
          title={onToday ? "On today" : "Add to today"}
          aria-label={onToday ? "Already on today" : "Add to today"}
        >
          {onToday ? <Check size={14} /> : <Plus size={14} />}
        </button>
        <button onClick={onEdit} className="p-2 rounded-lg" style={{ color: "var(--text3)" }} aria-label="Edit task"><Pencil size={13} /></button>
        <button onClick={onDelete} className="p-2 rounded-lg" style={{ color: "var(--red)" }} aria-label="Delete task"><Trash2 size={13} /></button>
      </div>
      {showWho && (
        <CompleteAsMenu
          users={users}
          onPick={(userId, date) => { onComplete(userId, date); setShowWho(false); }}
          onClose={() => setShowWho(false)}
        />
      )}
    </div>
  );
}

function FilterChip({
  label, active, onClick,
}: {
  label: string; active: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-3 py-1.5 rounded-xl text-sm font-medium shrink-0 transition-all"
      style={{
        background: active ? "var(--accent-dim)" : "var(--surface)",
        color: active ? "var(--accent)" : "var(--text2)",
        border: `2px solid ${active ? "var(--accent)" : "var(--border)"}`,
        boxShadow: active ? "none" : "var(--shadow)",
      }}
    >
      {label}
    </button>
  );
}

export default function RoomsPage() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [showRoomForm, setShowRoomForm] = useState(false);
  const [roomName, setRoomName] = useState("");
  const [roomIcon, setRoomIcon] = useState("🏠");
  const [editingRoom, setEditingRoom] = useState<Room | null>(null);
  const [taskForms, setTaskForms] = useState<Record<string, boolean>>({});
  const [editingTask, setEditingTask] = useState<(Task & { roomId: string }) | null>(null);
  const [onToday, setOnToday] = useState<Set<string>>(new Set());
  const [addingId, setAddingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [dueFilter, setDueFilter] = useState<"all" | "overdue" | "due">("all");
  const [meId, setMeId] = useState<string | undefined>();
  const [dirtAsOf, setDirtAsOf] = useState<Date | undefined>();
  const today = format(new Date(), "yyyy-MM-dd");

  async function load() {
    await Promise.all([
      loadJson<Room[]>("/api/rooms", [], (r) => setRooms(Array.isArray(r) ? r : [])),
      loadJson<User[]>("/api/users", [], (u) => setUsers(Array.isArray(u) ? u : [])),
      loadJson<{ task: { id: string } }[]>(`/api/assignments?date=${today}`, [], (a) => {
        setOnToday(new Set((Array.isArray(a) ? a : []).map((x) => x.task.id)));
      }),
      loadJson<{ user?: { id: string } }>("/api/auth/me", {}, (me) => setMeId(me.user?.id)),
      loadJson<{ dirtAsOf?: string } | null>("/api/settings", null, (settings) => {
        setDirtAsOf(typeof settings?.dirtAsOf === "string" ? new Date(`${settings.dirtAsOf}T12:00:00`) : undefined);
      }),
    ]);
  }

  useEffect(() => { load(); }, []);

  async function saveRoom(e: React.FormEvent) {
    e.preventDefault();
    if (editingRoom) {
      await fetch(`/api/rooms/${editingRoom.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: roomName, icon: roomIcon }),
      });
      setEditingRoom(null);
    } else {
      await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: roomName, icon: roomIcon }),
      });
    }
    setRoomName(""); setRoomIcon("🏠"); setShowRoomForm(false);
    invalidateLists();
    load();
  }

  async function deleteRoom(id: string) {
    if (!confirm("Delete this room and all its tasks?")) return;
    await fetch(`/api/rooms/${id}`, { method: "DELETE" });
    invalidateLists();
    load();
  }

  async function saveTask(e: React.FormEvent, roomId: string) {
    e.preventDefault();
    const body = parseTaskForm(e.target as HTMLFormElement);

    if (editingTask) {
      await fetch(`/api/tasks/${editingTask.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setEditingTask(null);
    } else {
      await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, roomId }),
      });
      setTaskForms((f) => ({ ...f, [roomId]: false }));
    }
    invalidateLists();
    load();
  }

  async function deleteTask(id: string) {
    await fetch(`/api/tasks/${id}`, { method: "DELETE" });
    invalidateLists();
    load();
  }

  async function addToToday(taskId: string) {
    if (onToday.has(taskId) || addingId) return;
    setAddingId(taskId);
    const res = await fetch("/api/assignments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId }),
    });
    if (res.ok) setOnToday((prev) => new Set(prev).add(taskId));
    invalidateLists();
    setAddingId(null);
  }

  async function completeTask(taskId: string, completedById: string | null, completedAt?: string) {
    const stamp = completedAt ? `${completedAt}T12:00:00` : new Date().toISOString();
    setRooms((prev) =>
      prev.map((room) => ({
        ...room,
        tasks: room.tasks.map((t) => (t.id === taskId ? { ...t, lastDoneAt: stamp } : t)),
      }))
    );
    const res = await fetch("/api/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId, completedById, completedAt }),
    });
    if (!res.ok) await load();
    else invalidateLists();
  }

  async function uncompleteTask(taskId: string) {
    const res = await fetch("/api/complete", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId }),
    });
    invalidateLists();
    if (res.ok) await load();
  }

  const isRoomFormOpen = showRoomForm;
  const q = query.trim().toLowerCase();
  const browsing = !!q || dueFilter !== "all";
  const filtered = useMemo(() => {
    return rooms
      .map((room) => {
        let tasks = room.tasks;
        if (q) {
          const roomMatch = room.name.toLowerCase().includes(q);
          if (!roomMatch) tasks = tasks.filter((t) => t.name.toLowerCase().includes(q));
        }
        if (dueFilter === "overdue") tasks = tasks.filter((t) => isCatchUpTask(t, dirtAsOf));
        if (dueFilter === "due") tasks = tasks.filter((t) => isDueToday(t, dirtAsOf));
        return { ...room, tasks };
      })
      .filter((room) => {
        if (dueFilter !== "all") return room.tasks.length > 0;
        if (!q) return true;
        return room.name.toLowerCase().includes(q) || room.tasks.length > 0;
      });
  }, [rooms, q, dueFilter, dirtAsOf]);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Rooms & Tasks</h1>
          <p className="text-sm mt-1" style={{ color: "var(--text2)" }}>
            {rooms.length} rooms · {rooms.reduce((s, r) => s + r.tasks.length, 0)} tasks
          </p>
        </div>
        <div className="flex items-center gap-2 flex-1 sm:flex-initial min-w-0 justify-end">
          <label className="relative block flex-1 sm:w-56 min-w-0">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text3)" }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full"
              style={{ paddingLeft: 36 }}
              placeholder="Search rooms or tasks…"
              aria-label="Search rooms or tasks"
            />
          </label>
          <button
            onClick={() => { setShowRoomForm(true); setEditingRoom(null); setRoomName(""); setRoomIcon("🏠"); }}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-medium text-white transition-colors shrink-0"
            style={{ background: "var(--accent)" }}
          >
            <Plus size={14} /> Add Room
          </button>
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto mb-5 py-1 -mx-1 px-1">
        <FilterChip label="All" active={dueFilter === "all"} onClick={() => setDueFilter("all")} />
        <FilterChip label="Overdue" active={dueFilter === "overdue"} onClick={() => setDueFilter("overdue")} />
        <FilterChip label="Due today" active={dueFilter === "due"} onClick={() => setDueFilter("due")} />
      </div>

      {isRoomFormOpen && (
        <form
          onSubmit={saveRoom}
          className="mb-5 p-4 rounded-2xl flex flex-col sm:flex-row gap-3 sm:items-end"
          style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
        >
          <div>
            <label className="block text-xs mb-1.5" style={{ color: "var(--text3)" }}>Icon</label>
            <input
              value={roomIcon}
              onChange={(e) => setRoomIcon(e.target.value)}
              className="w-12 text-xl text-center"
              maxLength={2}
            />
          </div>
          <div className="flex-1">
            <label className="block text-xs mb-1.5" style={{ color: "var(--text3)" }}>Room name</label>
            <input
              autoFocus
              required
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              className="w-full"
              placeholder="e.g. Kitchen"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-2 rounded-xl text-sm font-medium text-white"
            style={{ background: "var(--accent)" }}
          >
            {editingRoom ? "Save" : "Add"}
          </button>
          <button
            type="button"
            onClick={() => { setShowRoomForm(false); setEditingRoom(null); }}
            className="px-3 py-2 rounded-xl text-sm"
            style={{ color: "var(--text3)" }}
          >
            Cancel
          </button>
        </form>
      )}

      <div className="space-y-2">
        {filtered.map((room) => (
          <div
            key={room.id}
            className="rounded-2xl overflow-hidden"
            style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
          >
            {editingRoom?.id === room.id ? (
              <form
                onSubmit={saveRoom}
                className="flex flex-col sm:flex-row gap-3 p-4 sm:items-end"
              >
                <div>
                  <label className="block text-xs mb-1.5" style={{ color: "var(--text3)" }}>Icon</label>
                  <input
                    value={roomIcon}
                    onChange={(e) => setRoomIcon(e.target.value)}
                    className="w-12 text-xl text-center"
                    maxLength={2}
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs mb-1.5" style={{ color: "var(--text3)" }}>Room name</label>
                  <input
                    autoFocus
                    required
                    value={roomName}
                    onChange={(e) => setRoomName(e.target.value)}
                    className="w-full"
                  />
                </div>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl text-sm font-medium text-white"
                  style={{ background: "var(--accent)" }}
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setEditingRoom(null)}
                  className="px-3 py-2 rounded-xl text-sm"
                  style={{ color: "var(--text3)" }}
                >
                  Cancel
                </button>
              </form>
            ) : (
            <div
              className="flex flex-col gap-2 px-4 py-3.5 cursor-pointer select-none group"
              onClick={() => setExpanded((e) => ({ ...e, [room.id]: !e[room.id] }))}
            >
              <div className="flex items-center gap-2">
                <span className="text-xl w-7 shrink-0 text-center">{room.icon}</span>
                <span className="font-medium min-w-0 flex-1 md:flex-none md:max-w-[12rem] truncate">{room.name}</span>
                <span className="hidden md:flex flex-1 min-w-10">
                  <RoomDirtGauge tasks={room.tasks} asOf={dirtAsOf} />
                </span>
                <span className="text-xs hidden sm:block w-14 shrink-0 text-right" style={{ color: "var(--text3)" }}>
                  {room.tasks.length} {room.tasks.length === 1 ? "task" : "tasks"}
                </span>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setEditingRoom(room); setRoomName(room.name); setRoomIcon(room.icon); setShowRoomForm(false); }}
                  className="p-2 rounded-lg shrink-0 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                  style={{ color: "var(--text3)" }}
                  aria-label="Edit room"
                >
                  <Pencil size={13} />
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); deleteRoom(room.id); }}
                  className="p-2 rounded-lg shrink-0 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                  aria-label="Delete room"
                  style={{ color: "var(--red)" }}
                >
                  <Trash2 size={13} />
                </button>
                {expanded[room.id] || browsing
                  ? <ChevronDown size={14} className="shrink-0" style={{ color: "var(--text3)" }} />
                  : <ChevronRight size={14} className="shrink-0" style={{ color: "var(--text3)" }} />
                }
              </div>
              <div className="flex md:hidden pl-9">
                <RoomDirtGauge tasks={room.tasks} asOf={dirtAsOf} />
              </div>
            </div>
            )}

            {(expanded[room.id] || browsing) && (
              <div style={{ borderTop: "1px solid var(--border)" }}>
                {room.tasks.map((task) => (
                  <div key={task.id} style={{ borderBottom: "1px solid var(--border)" }}>
                    {editingTask?.id === task.id ? (
                      <form onSubmit={(e) => saveTask(e, room.id)} className="p-4 space-y-3">
                        <TaskFormFields key={task.id} task={task} users={users} dirtAsOf={dirtAsOf} />
                        <div className="flex gap-2">
                          <button type="submit" className="px-3 py-1.5 rounded-lg text-sm font-medium text-white" style={{ background: "var(--accent)" }}>Save</button>
                          <button type="button" onClick={() => setEditingTask(null)} className="px-3 py-1.5 rounded-lg text-sm" style={{ color: "var(--text3)" }}>Cancel</button>
                        </div>
                      </form>
                    ) : (
                      <CatalogTaskRow
                        task={task}
                        users={users}
                        meId={meId}
                        today={today}
                        onToday={onToday.has(task.id)}
                        adding={addingId === task.id}
                        onAddToday={() => addToToday(task.id)}
                        onComplete={(by, date) => completeTask(task.id, by, date)}
                        onUncomplete={() => uncompleteTask(task.id)}
                        onEdit={() => setEditingTask({ ...task, roomId: room.id })}
                        onDelete={() => deleteTask(task.id)}
                        dirtAsOf={dirtAsOf}
                      />
                    )}
                  </div>
                ))}

                {taskForms[room.id] ? (
                  <form onSubmit={(e) => saveTask(e, room.id)} className="p-4 space-y-3">
                    <TaskFormFields key={`new-${room.id}`} users={users} dirtAsOf={dirtAsOf} />
                    <div className="flex gap-2">
                      <button type="submit" className="px-3 py-1.5 rounded-lg text-sm font-medium text-white" style={{ background: "var(--accent)" }}>Add Task</button>
                      <button type="button" onClick={() => setTaskForms((f) => ({ ...f, [room.id]: false }))} className="px-3 py-1.5 rounded-lg text-sm" style={{ color: "var(--text3)" }}>Cancel</button>
                    </div>
                  </form>
                ) : (
                  <button
                    onClick={() => setTaskForms((f) => ({ ...f, [room.id]: true }))}
                    className="flex items-center gap-2 px-4 py-3 w-full text-sm transition-colors hover:bg-white/3"
                    style={{ color: "var(--text3)" }}
                  >
                    <Plus size={13} /> Add task
                  </button>
                )}
              </div>
            )}
          </div>
        ))}

        {filtered.length === 0 && (
          <div className="text-center py-20" style={{ color: "var(--text2)" }}>
            <p className="text-4xl mb-3">{browsing ? "🔍" : "🏠"}</p>
            <p className="font-medium">
              {dueFilter === "overdue"
                ? "Nothing overdue"
                : dueFilter === "due"
                  ? "Nothing due today"
                  : q
                    ? "No matching rooms or tasks"
                    : "No rooms yet"}
            </p>
            <p className="text-sm mt-1" style={{ color: "var(--text3)" }}>
              {browsing ? "Try a different name or filter" : "Add a room to get started"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
