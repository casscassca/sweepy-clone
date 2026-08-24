"use client";
import { useEffect, useState } from "react";
import { format } from "date-fns";
import {
  DndContext, DragEndEvent, PointerSensor, useSensor, useSensors, closestCenter,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, CheckCircle2, Circle, Eye, EyeOff, Pin, Plus, RefreshCw, Star, UserCheck, Users, X } from "lucide-react";
import AddToDaySheet from "@/components/AddToDaySheet";
import CompleteAsMenu from "@/components/CompleteAsMenu";
import PersonMenu from "@/components/PersonMenu";
import TaskNote from "@/components/TaskNote";
import { assignmentDifficulty, assignmentLabel } from "@/lib/addon";
import { useHideDone } from "@/lib/hide-done";
import { invalidateLists, loadJson } from "@/lib/api-cache";

type User = { id: string; name: string; color: string; dailyCapacity: number; dailyTaskLimit?: number };
type Task = { id: string; name: string; difficulty: number; oneOff?: boolean; important?: boolean; notes?: string; addonName?: string; addonFrequencyDays?: number; addonPoints?: number; addonLastDoneAt?: string | null; lastDoneAt?: string | null; frequencyDays?: number; dueOnly?: boolean; room: { name: string } | null };
type Assignment = { id: string; userId: string; order: number; completedAt: string | null; pinned?: boolean; task: Task; user: User };

const DIFF_COLOR = ["", "#a78bfa", "#fb923c", "#f87171"];
const DIFF_LABEL = ["", "quick", "medium", "big job"];

function SortableItem({ assignment, users, meId, onComplete, onUncomplete, onRemove, onPin, onReassign }: {
  assignment: Assignment; users: User[]; meId?: string;
  onComplete: (id: string, by: string | null, date?: string) => void;
  onUncomplete: (id: string) => void;
  onRemove: (id: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  onReassign: (id: string, userId: string, date: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: assignment.id });
  const [showWho, setShowWho] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const done = !!assignment.completedAt;

  function markMine() {
    if (meId) onComplete(assignment.id, meId);
    else setShowWho(true);
  }

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1, background: "var(--surface)", border: "1px solid var(--border)", boxShadow: "var(--shadow)" }}
      className="flex items-center gap-2 pl-1.5 pr-3 py-2.5 rounded-xl mb-1.5 relative group"
    >
      <button {...attributes} {...listeners} aria-label="Reorder task" className="cursor-grab touch-none p-0.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity shrink-0" style={{ color: "var(--text3)" }}>
        <GripVertical size={14} />
      </button>
      <button type="button" onClick={() => done ? onUncomplete(assignment.id) : markMine()} aria-label={done ? "Mark incomplete" : "Mark complete"} className="shrink-0 transition-colors min-h-11 w-9 flex items-center justify-center -ml-1" style={{ color: done ? "var(--green)" : "var(--text3)" }}>
        {done ? <CheckCircle2 size={22} /> : <Circle size={22} />}
      </button>
      <div className="flex-1 min-w-0">
        <span className="text-sm inline-flex items-center gap-1.5" style={{ opacity: done ? 0.35 : 1, textDecoration: done ? "line-through" : "none" }}>
          {assignment.task.important && (
            <Star size={12} fill="currentColor" className="shrink-0" style={{ color: "var(--accent)", textDecoration: "none" }} />
          )}
          {assignmentLabel(assignment.task, assignment.completedAt)}
        </span>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <span className="text-xs" style={{ color: "var(--text3)" }}>
            {assignment.task.oneOff ? "one-off" : assignment.task.room?.name}
          </span>
          <span className="text-xs font-medium px-1.5 py-px rounded-full" style={{ background: DIFF_COLOR[assignmentDifficulty(assignment.task, assignment.completedAt)] + "22", color: DIFF_COLOR[assignmentDifficulty(assignment.task, assignment.completedAt)] }}>
            {DIFF_LABEL[assignmentDifficulty(assignment.task, assignment.completedAt)]}
          </span>
        </div>
        {!done && <TaskNote notes={assignment.task.notes} />}
      </div>
      <div className="flex items-center shrink-0">
        {!done && (
          <button
            type="button"
            onClick={() => { setShowWho(false); setShowAssign((v) => !v); }}
            className="p-2 rounded-lg opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
            style={{ color: "var(--text3)" }}
            title="Give to someone else or another day"
            aria-label="Give to someone else or another day"
          >
            <Users size={16} />
          </button>
        )}
        {!done && (
          <button
            type="button"
            onClick={() => { setShowAssign(false); setShowWho(true); }}
            className="p-2 rounded-lg opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
            style={{ color: "var(--text3)" }}
            title="Done as someone else"
            aria-label="Mark done as someone else"
          >
            <UserCheck size={16} />
          </button>
        )}
        <button type="button" onClick={() => onRemove(assignment.id)} className="p-2 rounded-lg opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity" style={{ color: "var(--text3)" }} title="Remove from today" aria-label="Remove from today">
          <X size={16} />
        </button>
        <button
          type="button"
          onClick={() => onPin(assignment.id, !assignment.pinned)}
          className={`p-2 rounded-lg ${assignment.pinned ? "opacity-100" : "opacity-100 md:opacity-0 md:group-hover:opacity-100"} transition-opacity`}
          style={{ color: assignment.pinned ? "var(--accent)" : "var(--text3)" }}
          title={assignment.pinned ? "Unpin from this day" : "Pin to this day"}
          aria-label={assignment.pinned ? "Unpin from this day" : "Pin to this day"}
        >
          <Pin size={16} fill={assignment.pinned ? "currentColor" : "none"} />
        </button>
      </div>

      {showWho && (
        <CompleteAsMenu
          users={users}
          onPick={(userId, date) => { onComplete(assignment.id, userId, date); setShowWho(false); }}
          onClose={() => setShowWho(false)}
        />
      )}
      {showAssign && (
        <PersonMenu
          title="Give to"
          users={users}
          selectedId={assignment.userId}
          onPick={(id, date) => onReassign(assignment.id, id, date)}
          onClose={() => setShowAssign(false)}
        />
      )}
    </div>
  );
}

export default function TodayPage() {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [meId, setMeId] = useState<string | undefined>();
  const [running, setRunning] = useState(false);
  const [adding, setAdding] = useState(false);
  const [hideDone, setHideDone] = useHideDone();
  const today = format(new Date(), "yyyy-MM-dd");

  const grouped = users.map((u) => {
    const all = assignments.filter((a) => a.userId === u.id).sort((a, b) => {
      const aImp = !a.completedAt && a.task.important ? 1 : 0;
      const bImp = !b.completedAt && b.task.important ? 1 : 0;
      if (aImp !== bImp) return bImp - aImp;
      return a.order - b.order;
    });
    return {
      user: u,
      all,
      items: hideDone ? all.filter((a) => !a.completedAt) : all,
    };
  });

  const totalDone = assignments.filter((a) => a.completedAt).length;
  const total = assignments.length;
  const pct = total > 0 ? (totalDone / total) * 100 : 0;

  async function load() {
    await Promise.all([
      loadJson<Assignment[]>(`/api/assignments?date=${today}`, [], (a) => setAssignments(Array.isArray(a) ? a : [])),
      loadJson<User[]>("/api/users", [], (u) => setUsers(Array.isArray(u) ? u : [])),
      loadJson<{ user?: { id: string } }>("/api/auth/me", {}, (me) => setMeId(me.user?.id)),
    ]);
  }

  useEffect(() => { load(); }, []);

  async function runAssignment() {
    setRunning(true);
    await fetch(`/api/run-assignments?manual=true&date=${today}`, { method: "POST" });
    invalidateLists();
    await load(); setRunning(false);
  }

  async function complete(assignmentId: string, completedById: string | null, completedAt?: string) {
    const stamp = completedAt ? `${completedAt}T12:00:00` : new Date().toISOString();
    const leftToday = Boolean(completedAt && completedAt !== today);
    setAssignments((prev) =>
      leftToday
        ? prev.filter((a) => a.id !== assignmentId)
        : prev.map((a) => (a.id === assignmentId ? { ...a, completedAt: stamp } : a))
    );
    const res = await fetch("/api/complete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assignmentId, completedById, completedAt }) });
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
    setAssignments((prev) => prev.filter((a) => a.id !== assignmentId));
    const res = await fetch(`/api/assignments/${assignmentId}`, { method: "DELETE" });
    invalidateLists();
    if (!res.ok) load();
  }

  async function reassign(assignmentId: string, userId: string, date: string) {
    const user = users.find((u) => u.id === userId);
    if (!user) return;
    const today = format(new Date(), "yyyy-MM-dd");
    setAssignments((prev) =>
      date !== today
        ? prev.filter((a) => a.id !== assignmentId)
        : prev.map((a) => (a.id === assignmentId ? { ...a, userId, user } : a))
    );
    await fetch(`/api/assignments/${assignmentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, date }),
    });
    invalidateLists();
  }

  async function pin(assignmentId: string, pinned: boolean) {
    setAssignments((prev) => prev.map((a) => (a.id === assignmentId ? { ...a, pinned } : a)));
    await fetch(`/api/assignments/${assignmentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned }),
    });
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const activeA = assignments.find((a) => a.id === active.id);
    const overA = assignments.find((a) => a.id === over.id);
    if (!activeA || !overA) return;

    const targetUserId = overA.userId;
    const updated = assignments.map((a) => a.id === activeA.id ? { ...a, userId: targetUserId } : a);
    const reordered: Array<{ id: string; userId: string; order: number; held?: boolean }> = [];
    const movedPerson = targetUserId !== activeA.userId;
    users.forEach((u) => {
      updated.filter((a) => a.userId === u.id).sort((a, b) => a.order - b.order)
        .forEach((item, idx) => reordered.push({
          id: item.id,
          userId: u.id,
          order: idx,
          ...(movedPerson && item.id === activeA.id ? { held: true } : {}),
        }));
    });
    setAssignments(updated.map((a) => { const r = reordered.find((x) => x.id === a.id); return r ? { ...a, userId: r.userId, order: r.order } : a; }));
    await fetch("/api/assignments", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assignments: reordered }) });
    invalidateLists();
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-6">
        <div>
          <p className="text-sm mb-1" style={{ color: "var(--text3)" }}>{format(new Date(), "EEEE, MMMM d")}</p>
          <h1 className="text-2xl font-semibold tracking-tight">Today</h1>
          {total > 0 && (
            <p className="text-sm mt-1" style={{ color: "var(--text2)" }}>
              {totalDone} of {total} done
              {totalDone === total && <span className="ml-2" style={{ color: "var(--green)" }}>✓ All done!</span>}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setHideDone((v) => !v)}
            className="flex items-center justify-center w-10 h-10 rounded-xl"
            style={{ background: "var(--surface)", border: "1px solid var(--border)", color: hideDone ? "var(--accent)" : "var(--text2)", boxShadow: "var(--shadow)" }}
            aria-pressed={hideDone}
            aria-label={hideDone ? "Show completed" : "Hide completed"}
            title={hideDone ? "Show completed" : "Hide completed"}
          >
            {hideDone ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex items-center justify-center w-10 h-10 rounded-xl"
            style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text2)", boxShadow: "var(--shadow)" }}
            aria-label="Add to today"
          >
            <Plus size={16} />
          </button>
          <button onClick={runAssignment} disabled={running} className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-medium transition-colors" style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text2)", boxShadow: "var(--shadow)" }}>
            <RefreshCw size={13} className={running ? "spin" : ""} />
            {total === 0 ? "Assign Tasks" : "Re-assign"}
          </button>
        </div>
      </div>

      {total > 0 && (
        <div className="mb-6 h-1 rounded-full overflow-hidden" style={{ background: "var(--surface2)" }}>
          <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: pct === 100 ? "var(--green)" : "var(--accent)" }} />
        </div>
      )}

      {total === 0 ? (
        <div className="text-center py-24" style={{ color: "var(--text2)" }}>
          <p className="text-4xl mb-4">🐾</p>
          <p className="font-medium text-lg mb-1">Nothing assigned yet</p>
          <p className="text-sm" style={{ color: "var(--text3)" }}>Hit "Assign Tasks" to generate today's schedule</p>
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <div className="grid gap-6 md:grid-cols-2">
            {grouped.map(({ user, items, all }) => (
              <div key={user.id}>
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0" style={{ background: user.color + "22", color: user.color }}>{user.name[0]}</span>
                  <span className="font-medium">{user.name}</span>
                  <span className="text-xs ml-auto" style={{ color: "var(--text3)" }}>
                    {all.filter((i) => i.completedAt).length}/{all.length} · {all.reduce((s, i) => s + assignmentDifficulty(i.task, i.completedAt), 0)}/{user.dailyCapacity} pts
                  </span>
                </div>
                <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
                  {items.map((a) => (
                    <SortableItem key={a.id} assignment={a} users={users} meId={meId} onComplete={complete} onUncomplete={uncomplete} onRemove={remove} onPin={pin} onReassign={reassign} />
                  ))}
                </SortableContext>
                {all.length === 0 && (
                  <div className="text-sm py-8 text-center rounded-xl" style={{ color: "var(--text3)", border: "1px dashed var(--border)" }}>Drag tasks here</div>
                )}
              </div>
            ))}
          </div>
        </DndContext>
      )}

      {adding && (
        <AddToDaySheet
          date={today}
          title="Add to today"
          users={users}
          defaultUserId={meId}
          onClose={() => setAdding(false)}
          onAdded={() => { invalidateLists(); load(); }}
        />
      )}
    </div>
  );
}
