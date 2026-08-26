"use client";
import { useEffect, useMemo, useState, type HTMLAttributes, type ReactNode } from "react";
import { addDays, format, parseISO, isToday, isTomorrow } from "date-fns";
import {
  DndContext, DragEndEvent, PointerSensor, useSensor, useSensors, closestCenter,
  DragOverlay, DragStartEvent, useDroppable,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, CheckCircle2, Circle, Pencil, Pin, Plus, Star, UserCheck, X, RefreshCw } from "lucide-react";
import { assignmentDifficulty, assignmentLabel } from "@/lib/addon";
import { dirtDetail, dirtinessRatio } from "@/lib/dirtiness";
import DirtGauge from "@/components/DirtGauge";
import TaskEditModal from "@/components/TaskEditModal";
import AddToDaySheet from "@/components/AddToDaySheet";
import CompleteAsMenu from "@/components/CompleteAsMenu";
import PersonMenu from "@/components/PersonMenu";
import TaskNote from "@/components/TaskNote";
import type { TaskFormRoom, TaskFormTask } from "@/components/TaskFormFields";
import { useHideDone } from "@/lib/hide-done";
import { invalidateLists, loadJson } from "@/lib/api-cache";

type User = { id: string; name: string; color: string };
type Task = TaskFormTask & { room: { id: string; name: string } | null; oneOff?: boolean; roomId?: string | null };
type Assignment = { id: string; userId: string; date: string; order: number; completedAt: string | null; pinned?: boolean; task: Task; user: User };

const DIFF_COLOR = ["", "#a78bfa", "#fb923c", "#f87171"];
const DIFF_LABEL = ["", "quick", "medium", "big job"];

function dayLabel(dateStr: string) {
  const d = parseISO(dateStr);
  if (isToday(d)) return "Today";
  if (isTomorrow(d)) return "Tomorrow";
  return format(d, "EEEE, MMM d");
}


function TaskCard({ assignment, users, meId, onComplete, onUncomplete, onRemove, onEdit, onReassign, onPin, dragHandleProps, isDragOverlay, dirtAsOf }: {
  assignment: Assignment; users: User[]; meId?: string;
  onComplete?: (id: string, by: string | null, date?: string) => void;
  onUncomplete?: (id: string) => void;
  onRemove?: (id: string) => void;
  onEdit?: (task: Task) => void;
  onReassign?: (id: string, userId: string, date: string) => void;
  onPin?: (id: string, pinned: boolean) => void;
  dragHandleProps?: HTMLAttributes<HTMLElement>;
  isDragOverlay?: boolean;
  dirtAsOf?: Date;
}) {
  const [showWho, setShowWho] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const done = !!assignment.completedAt;

  function markMine() {
    if (meId) onComplete?.(assignment.id, meId);
    else { setShowAssign(false); setShowWho(true); }
  }

  return (
    <div
      className="flex items-center gap-2 pl-1.5 pr-3 py-2.5 rounded-xl mb-1.5 relative group"
      style={{
        background: "var(--surface)", border: "1px solid var(--border)", boxShadow: "var(--shadow)",
        opacity: isDragOverlay ? 0.9 : 1,
      }}
    >
      <div
        className="cursor-grab touch-none p-0.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity shrink-0"
        style={{ color: "var(--text3)" }}
        {...dragHandleProps}
      >
        <GripVertical size={14} />
      </div>
      {onComplete && (
        <button type="button" onClick={() => { if (done) { onUncomplete?.(assignment.id); } else { markMine(); } }} aria-label={done ? "Mark incomplete" : "Mark complete"} className="shrink-0 min-h-11 w-9 flex items-center justify-center -ml-1" style={{ color: done ? "var(--green)" : "var(--text3)" }}>
          {done ? <CheckCircle2 size={20} /> : <Circle size={20} />}
        </button>
      )}
      <div className="flex-1 min-w-0">
        <span className="text-sm inline-flex items-center gap-1.5" style={{ opacity: done ? 0.35 : 1, textDecoration: done ? "line-through" : "none" }}>
          {assignment.task.important && (
            <Star size={12} fill="currentColor" className="shrink-0" style={{ color: "var(--accent)", textDecoration: "none" }} />
          )}
          {assignmentLabel(assignment.task, assignment.completedAt)}
        </span>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          {onReassign ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setShowWho(false); setShowAssign((v) => !v); }}
              className="flex items-center gap-1.5 min-h-8 -ml-1 px-1 rounded-lg"
              style={{ color: "var(--text3)" }}
              title="Give to someone else or another day"
              aria-label={`Assigned to ${assignment.user.name}. Give to someone else or another day`}
            >
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: assignment.user.color }} />
              <span className="text-xs">{assignment.user.name}</span>
            </button>
          ) : (
            <>
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: assignment.user.color }} />
              <span className="text-xs" style={{ color: "var(--text3)" }}>{assignment.user.name}</span>
            </>
          )}
          <span className="text-xs" style={{ color: "var(--text3)" }}>
            {assignment.task.oneOff ? "one-off" : assignment.task.room?.name}
          </span>
          <span className="text-xs font-medium px-1.5 py-px rounded-full" style={{ background: DIFF_COLOR[assignmentDifficulty(assignment.task, assignment.completedAt)] + "22", color: DIFF_COLOR[assignmentDifficulty(assignment.task, assignment.completedAt)] }}>
            {DIFF_LABEL[assignmentDifficulty(assignment.task, assignment.completedAt)]}
          </span>
          {!done && !assignment.task.oneOff && (
            <DirtGauge
              size={22}
              ratio={dirtinessRatio(assignment.task.lastDoneAt, assignment.task.frequencyDays, dirtAsOf)}
              title={dirtDetail(assignment.task.lastDoneAt, assignment.task.frequencyDays, dirtAsOf)}
            />
          )}
        </div>
        {!done && <TaskNote notes={assignment.task.notes} />}
      </div>
      <div className="flex items-center shrink-0">
        {onComplete && !done && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setShowAssign(false); setShowWho(true); }}
            className="p-2 rounded-lg opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
            style={{ color: "var(--text3)" }}
            title="Done as someone else"
            aria-label="Mark done as someone else"
          >
            <UserCheck size={16} />
          </button>
        )}
        {onEdit && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onEdit(assignment.task); }}
            className="p-2 rounded-lg opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
            style={{ color: "var(--text3)" }}
            aria-label="Edit task"
          >
            <Pencil size={16} />
          </button>
        )}
        {onRemove && (
          <button onClick={() => onRemove(assignment.id)} className="p-2 rounded-lg opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity" style={{ color: "var(--text3)" }} aria-label="Remove task">
            <X size={16} />
          </button>
        )}
        {onPin && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onPin(assignment.id, !assignment.pinned); }}
            className={`p-2 rounded-lg ${assignment.pinned ? "opacity-100" : "opacity-100 md:opacity-0 md:group-hover:opacity-100"} transition-opacity`}
            style={{ color: assignment.pinned ? "var(--accent)" : "var(--text3)" }}
            title={assignment.pinned ? "Unpin from this day" : "Pin to this day"}
            aria-label={assignment.pinned ? "Unpin from this day" : "Pin to this day"}
          >
            <Pin size={16} fill={assignment.pinned ? "currentColor" : "none"} />
          </button>
        )}
      </div>
      {showWho && (
        <CompleteAsMenu
          users={users}
          defaultDate={assignment.date}
          onPick={(userId, date) => { onComplete?.(assignment.id, userId, date); setShowWho(false); }}
          onClose={() => setShowWho(false)}
        />
      )}
      {showAssign && onReassign && (
        <PersonMenu
          title="Give to"
          users={users}
          selectedId={assignment.userId}
          defaultDate={assignment.date}
          onPick={(id, date) => onReassign(assignment.id, id, date)}
          onClose={() => setShowAssign(false)}
        />
      )}
    </div>
  );
}

function DayBucket({ date, children }: { date: string; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: date });
  return (
    <div
      ref={setNodeRef}
      className="min-h-10 rounded-xl"
      style={{ outline: isOver ? "2px dashed var(--accent)" : undefined, outlineOffset: 4 }}
    >
      {children}
    </div>
  );
}

function SortableTaskCard(props: Parameters<typeof TaskCard>[0]) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.assignment.id });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.3 : 1 }}>
      <TaskCard {...props} dragHandleProps={{ ...attributes, ...listeners }} />
    </div>
  );
}

type WhoFilter = "all" | "me" | string;

function FilterChip({
  label, color, active, onClick,
}: {
  label: string; color?: string; active: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium shrink-0 transition-all"
      style={{
        background: active ? (color ? color + "22" : "var(--accent-dim)") : "var(--surface)",
        color: active ? (color ?? "var(--accent)") : "var(--text2)",
        border: `2px solid ${active ? (color ?? "var(--accent)") : "var(--border)"}`,
        boxShadow: active ? "none" : "var(--shadow)",
      }}
    >
      {color && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />}
      {label}
    </button>
  );
}

export default function UpcomingPage() {
  const days = useMemo(
    () => Array.from({ length: 21 }, (_, i) => format(addDays(new Date(), i), "yyyy-MM-dd")),
    [],
  );
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [me, setMe] = useState<User | null>(null);
  const [who, setWho] = useState<WhoFilter>("all");
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [catalogRooms, setCatalogRooms] = useState<TaskFormRoom[]>([]);
  const [addingDate, setAddingDate] = useState<string | null>(null);
  const [hideDone, setHideDone] = useHideDone();
  const [dirtAsOf, setDirtAsOf] = useState<Date | undefined>();

  async function load() {
    await Promise.all([
      loadJson<{ assignments?: Assignment[] }>(`/api/upcoming?from=${days[0]}`, {}, (upcomingRes) => {
        setAssignments(Array.isArray(upcomingRes.assignments) ? upcomingRes.assignments : []);
      }),
      loadJson<User[]>("/api/users", [], (usersRes) => setUsers(Array.isArray(usersRes) ? usersRes : [])),
      loadJson<{ id: string; name: string; icon: string }[]>("/api/rooms", [], (r) => {
        setCatalogRooms((Array.isArray(r) ? r : []).map((room) => ({ id: room.id, name: room.name, icon: room.icon })));
      }),
      loadJson<{ user?: User }>("/api/auth/me", {}, (meRes) => setMe(meRes.user ?? null)),
      loadJson<{ dirtAsOf?: string } | null>("/api/settings", null, (settings) => {
        setDirtAsOf(typeof settings?.dirtAsOf === "string" ? new Date(`${settings.dirtAsOf}T12:00:00`) : undefined);
      }),
    ]);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function complete(assignmentId: string, completedById: string | null, completedAt?: string) {
    const day = completedAt ?? days[0];
    const stamp = `${day}T12:00:00`;
    setAssignments((prev) =>
      prev.map((a) => (a.id === assignmentId ? { ...a, completedAt: stamp, date: day } : a))
    );
    const res = await fetch("/api/complete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assignmentId, completedById, completedAt: day }) });
    invalidateLists();
    if (!res.ok) load();
  }

  async function uncomplete(assignmentId: string) {
    setAssignments((prev) => prev.map((a) => (a.id === assignmentId ? { ...a, completedAt: null } : a)));
    const res = await fetch("/api/complete", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assignmentId }) });
    invalidateLists();
    if (!res.ok) load();
  }

  async function remove(assignmentId: string) {
    await fetch(`/api/assignments/${assignmentId}`, { method: "DELETE" });
    invalidateLists();
    setAssignments((prev) => prev.filter((a) => a.id !== assignmentId));
  }

  async function pin(assignmentId: string, pinned: boolean) {
    setAssignments((prev) => prev.map((a) => (a.id === assignmentId ? { ...a, pinned } : a)));
    await fetch(`/api/assignments/${assignmentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned }),
    });
  }

  async function reassign(assignmentId: string, userId: string, date: string) {
    const user = users.find((u) => u.id === userId);
    if (!user) return;
    setAssignments((prev) =>
      days.includes(date)
        ? prev.map((a) => (a.id === assignmentId ? { ...a, userId, user, date } : a))
        : prev.filter((a) => a.id !== assignmentId)
    );
    await fetch(`/api/assignments/${assignmentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, date }),
    });
    invalidateLists();
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const activeAssignment = assignments.find((a) => a.id === activeId);

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);
    if (!over || active.id === over.id) return;

    const draggedId = active.id as string;
    const overId = over.id as string;

    // over.id might be a date string (dropped on day container) or another assignment id
    const overAssignment = assignments.find((a) => a.id === overId);
    const targetDate = overAssignment?.date ?? overId;

    if (!days.includes(targetDate)) return; // invalid drop target

    const dragged = assignments.find((a) => a.id === draggedId);
    if (!dragged || dragged.date === targetDate) return;

    // Optimistic update
    setAssignments((prev) => prev.map((a) => a.id === draggedId ? { ...a, date: targetDate } : a));

    await fetch(`/api/assignments/${draggedId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: targetDate }),
    });
    invalidateLists();
    await load();
  }

  const others = users.filter((u) => u.id !== me?.id);
  const byWho = who === "all"
    ? assignments
    : who === "me"
      ? assignments.filter((a) => a.userId === me?.id)
      : assignments.filter((a) => a.userId === who);
  const visible = hideDone ? byWho.filter((a) => !a.completedAt) : byWho;
  const totalDone = byWho.filter((a) => a.completedAt).length;

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Upcoming</h1>
          <p className="text-sm mt-1" style={{ color: "var(--text2)" }}>
            Next 3 weeks · {byWho.length} tasks · {totalDone} done
          </p>
        </div>
        <button onClick={load} disabled={loading} className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-medium" style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text2)", boxShadow: "var(--shadow)" }}>
          <RefreshCw size={13} className={loading ? "spin" : ""} />
          Refresh
        </button>
      </div>

      <div className="flex gap-2 overflow-x-auto mb-3 py-1 -mx-1 px-1">
        <FilterChip label="All" active={who === "all"} onClick={() => setWho("all")} />
        {me && (
          <FilterChip label="Me" color={me.color} active={who === "me"} onClick={() => setWho("me")} />
        )}
        {others.map((u) => (
          <FilterChip
            key={u.id}
            label={u.name}
            color={u.color}
            active={who === u.id}
            onClick={() => setWho(u.id)}
          />
        ))}
        <FilterChip
          label={hideDone ? "Show done" : "Hide done"}
          active={hideDone}
          onClick={() => setHideDone((v) => !v)}
        />
      </div>

      {loading && assignments.length === 0 ? (
        <div className="text-center py-20" style={{ color: "var(--text3)" }}>Loading…</div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={(e: DragStartEvent) => setActiveId(e.active.id as string)}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setActiveId(null)}
        >
          <div className="space-y-6">
            {days.map((date) => {
              const dayAssignments = visible.filter((a) => a.date === date).sort((a, b) => {
                const aImp = !a.completedAt && a.task.important ? 1 : 0;
                const bImp = !b.completedAt && b.task.important ? 1 : 0;
                if (aImp !== bImp) return bImp - aImp;
                return a.order - b.order;
              });
              const donePct = dayAssignments.length > 0 ? (dayAssignments.filter((a) => a.completedAt).length / dayAssignments.length) * 100 : 0;
              const isCurrentDay = isToday(parseISO(date));

              return (
                <div key={date}>
                  <div className="flex items-center gap-3 mb-2">
                    <h2 className="font-semibold text-sm" style={{ color: isCurrentDay ? "var(--accent)" : "var(--text)" }}>
                      {dayLabel(date)}
                    </h2>
                    <span className="text-xs" style={{ color: "var(--text3)" }}>
                      {dayAssignments.length} tasks · {dayAssignments.reduce((s, a) => s + assignmentDifficulty(a.task, a.completedAt), 0)} pts
                    </span>
                    {dayAssignments.length > 0 && (
                      <div className="flex-1 h-0.5 rounded-full overflow-hidden" style={{ background: "var(--surface2)" }}>
                        <div className="h-full rounded-full" style={{ width: `${donePct}%`, background: isCurrentDay ? "var(--accent)" : "var(--green)" }} />
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => setAddingDate(date)}
                      className="p-1.5 rounded-lg shrink-0 ml-auto"
                      style={{ color: "var(--text3)" }}
                      aria-label={`Add to ${dayLabel(date)}`}
                    >
                      <Plus size={16} />
                    </button>
                  </div>

                  <SortableContext items={dayAssignments.map((a) => a.id)} strategy={verticalListSortingStrategy}>
                    <DayBucket date={date}>
                      {dayAssignments.map((a) => (
                        <SortableTaskCard
                          key={a.id}
                          assignment={a}
                          users={users}
                          meId={me?.id}
                          onComplete={complete}
                          onUncomplete={uncomplete}
                          onRemove={remove}
                          onEdit={a.task.oneOff ? undefined : setEditingTask}
                          onReassign={reassign}
                          onPin={pin}
                          dirtAsOf={dirtAsOf}
                        />
                      ))}
                      {dayAssignments.length === 0 && (
                        <div className="text-sm py-4 text-center rounded-xl" style={{ color: "var(--text3)", border: "1px dashed var(--border)" }}>
                          Nothing scheduled — drag tasks here
                        </div>
                      )}
                    </DayBucket>
                  </SortableContext>
                </div>
              );
            })}
          </div>

          <DragOverlay>
            {activeAssignment && (
              <TaskCard assignment={activeAssignment} users={users} isDragOverlay dirtAsOf={dirtAsOf} />
            )}
          </DragOverlay>
        </DndContext>
      )}

      {editingTask && (
        <TaskEditModal
          task={{ ...editingTask, roomId: editingTask.roomId ?? editingTask.room?.id ?? null }}
          users={users}
          rooms={catalogRooms}
          onClose={() => setEditingTask(null)}
          onSaved={() => { setEditingTask(null); load(); }}
        />
      )}

      {addingDate && (
        <AddToDaySheet
          date={addingDate}
          title={`Add to ${dayLabel(addingDate)}`}
          users={users}
          defaultUserId={me?.id}
          onClose={() => setAddingDate(null)}
          onAdded={() => { invalidateLists(); load(); }}
        />
      )}
    </div>
  );
}
