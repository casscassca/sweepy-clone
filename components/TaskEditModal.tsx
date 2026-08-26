"use client";
import TaskFormFields, { parseTaskForm, type TaskFormRoom, type TaskFormTask, type TaskFormUser } from "@/components/TaskFormFields";

export default function TaskEditModal({
  task,
  users,
  rooms,
  onClose,
  onSaved,
}: {
  task: TaskFormTask;
  users: TaskFormUser[];
  rooms?: TaskFormRoom[];
  onClose: () => void;
  onSaved: () => void;
}) {
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const body = parseTaskForm(e.target as HTMLFormElement);
    await fetch(`/api/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    onSaved();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: "rgba(0,0,0,0.4)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl p-5"
        style={{ background: "var(--surface)", boxShadow: "var(--shadow)" }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="edit-task-title"
      >
        <h2 id="edit-task-title" className="font-semibold text-lg mb-4">Edit task</h2>
        <form onSubmit={save} className="space-y-3">
          <TaskFormFields key={task.id} task={task} users={users} rooms={rooms} />
          <div className="flex gap-2 pt-2">
            <button type="submit" className="px-4 py-2 rounded-xl text-sm font-medium text-white" style={{ background: "var(--accent)" }}>
              Save
            </button>
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl text-sm" style={{ color: "var(--text3)" }}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
