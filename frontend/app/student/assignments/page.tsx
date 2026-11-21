
"use client";

import { useEffect, useState } from "react";
import {
  Plus, ClipboardList, Clock, CircleCheck,
  AlertCircle, Search, Pencil, Trash2, X, Calendar
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Status = "pending" | "in_progress" | "completed" | "submitted";
type Priority = "low" | "medium" | "high";

type Subject = {
  id: string;
  name: string;
};

type Assignment = {
  id: string;
  subject_id: string | null;
  title: string;
  description: string | null;
  due_date: string | null;
  priority: Priority;
  status: Status;
};

const emptyForm = {
  title: "",
  subject_id: "",
  description: "",
  due_date: "",
  priority: "medium" as Priority,
  status: "pending" as Status,
};

const statusLabels: Record<Status, string> = {
  pending: "Pending",
  in_progress: "In Progress",
  completed: "Completed",
  submitted: "Submitted",
};

const inputClass =
  "w-full rounded-xl border border-slate-200 bg-white px-4 py-3 outline-none focus:border-indigo-500";

function isFinished(a: Assignment) {
  return a.status === "completed" || a.status === "submitted";
}

function isOverdue(a: Assignment) {
  return Boolean(
    !isFinished(a) &&
    a.due_date &&
    new Date(a.due_date).getTime() < Date.now()
  );
}

function toLocalDateTime(value: string | null) {
  if (!value) return "";

  const date = new Date(value);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());

  return date.toISOString().slice(0, 16);
}

export default function AssignmentsPage() {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [userId, setUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [subjectFilter, setSubjectFilter] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);

  async function loadAssignments(uid: string) {
    const supabase = createClient();

    const { data, error } = await supabase
      .from("student_assignments")
      .select("*")
      .eq("user_id", uid)
      .order("due_date", { ascending: true, nullsFirst: false });

    if (error) {
      setError(error.message);
      return false;
    }

    setAssignments(data ?? []);
    return true;
  }

  useEffect(() => {
    async function initialize() {
      try {
        const supabase = createClient();

        const { data, error } = await supabase.auth.getUser();

        if (error || !data.user) {
          window.location.replace("/");
          return;
        }

        const uid = data.user.id;
        setUserId(uid);

        const { data: subjectData, error: subjectError } =
          await supabase
            .from("student_subjects")
            .select("id, name")
            .eq("user_id", uid)
            .order("name");

        if (subjectError) {
          setError(subjectError.message);
        } else {
          setSubjects(subjectData ?? []);
        }

        await loadAssignments(uid);
      } catch {
        setError("Unable to load assignments.");
      } finally {
        setLoading(false);
      }
    }

    void initialize();
  }, []);

  function openAdd() {
    setEditingId(null);
    setForm({ ...emptyForm });
    setMessage("");
    setError("");
    setShowForm(true);
  }

  function openEdit(assignment: Assignment) {
    setEditingId(assignment.id);

    setForm({
      title: assignment.title,
      subject_id: assignment.subject_id ?? "",
      description: assignment.description ?? "",
      due_date: toLocalDateTime(assignment.due_date),
      priority: assignment.priority,
      status: assignment.status,
    });

    setMessage("");
    setError("");
    setShowForm(true);
  }

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!userId || saving) return;

    if (!form.title.trim()) {
      setError("Assignment title is required.");
      return;
    }

    setSaving(true);
    setMessage("");
    setError("");

    try {
      const supabase = createClient();

      const payload = {
        user_id: userId,
        title: form.title.trim(),
        subject_id: form.subject_id || null,
        description: form.description.trim() || null,
        due_date: form.due_date
          ? new Date(form.due_date).toISOString()
          : null,
        priority: form.priority,
        status: form.status,
      };

      const result = editingId
        ? await supabase
            .from("student_assignments")
            .update(payload)
            .eq("id", editingId)
            .eq("user_id", userId)
            .select("id")
            .single()
        : await supabase
            .from("student_assignments")
            .insert(payload)
            .select("id")
            .single();

      if (result.error) {
        throw result.error;
      }

      setShowForm(false);

      setMessage(
        editingId
          ? "Assignment updated successfully."
          : "Assignment added successfully."
      );

      await loadAssignments(userId);
    } catch (err) {
      setError(
        err && typeof err === "object" && "message" in err
          ? String(err.message)
          : "Unable to save assignment."
      );
    } finally {
      setSaving(false);
    }
  }

  async function updateStatus(id: string, status: Status) {
    if (!userId || saving) return;

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const supabase = createClient();

      const { error } = await supabase
        .from("student_assignments")
        .update({ status })
        .eq("id", id)
        .eq("user_id", userId)
        .select("id")
        .single();

      if (error) {
        setError(error.message);
        return;
      }

      setMessage("Assignment status updated.");
      await loadAssignments(userId);
    } catch {
      setError("Unable to update status.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteAssignment(id: string) {
    if (!userId || saving) return;

    if (!window.confirm("Permanently delete this assignment?")) return;

    setSaving(true);
    setMessage("");
    setError("");

    try {
      const supabase = createClient();

      const { error } = await supabase
        .from("student_assignments")
        .delete()
        .eq("id", id)
        .eq("user_id", userId)
        .select("id")
        .single();

      if (error) {
        setError(error.message);
        return;
      }

      setMessage("Assignment deleted successfully.");
      await loadAssignments(userId);
    } catch {
      setError("Unable to delete assignment.");
    } finally {
      setSaving(false);
    }
  }

  const completed = assignments.filter(isFinished).length;
  const pending = assignments.length - completed;
  const overdue = assignments.filter(isOverdue).length;

  const filtered = assignments.filter((assignment) => {
    const subjectName =
      subjects.find((s) => s.id === assignment.subject_id)?.name ?? "";

    const query = search.trim().toLowerCase();

    const matchesSearch =
      assignment.title.toLowerCase().includes(query) ||
      subjectName.toLowerCase().includes(query) ||
      (assignment.description ?? "").toLowerCase().includes(query);

    const matchesStatus =
      filter === "all" ||
      (filter === "overdue"
        ? isOverdue(assignment)
        : assignment.status === filter);

    const matchesSubject =
      subjectFilter === "all" ||
      assignment.subject_id === subjectFilter;

    return matchesSearch && matchesStatus && matchesSubject;
  });

  const stats = [
    {
      label: "Total Assignments",
      value: assignments.length,
      icon: ClipboardList,
      color: "bg-indigo-50 text-indigo-600",
    },
    {
      label: "Pending Assignments",
      value: pending,
      icon: Clock,
      color: "bg-orange-50 text-orange-600",
    },
    {
      label: "Completed / Submitted",
      value: completed,
      icon: CircleCheck,
      color: "bg-emerald-50 text-emerald-600",
    },
    {
      label: "Overdue",
      value: overdue,
      icon: AlertCircle,
      color: "bg-red-50 text-red-600",
    },
  ];

  if (loading) {
    return (
      <div className="p-8 text-slate-500">
        Loading assignments...
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 p-6 text-slate-900 lg:p-8">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Assignments</h1>
          <p className="mt-2 text-slate-500">
            Manage assignments, deadlines and submissions.
          </p>
        </div>

        <button
          onClick={openAdd}
          disabled={!userId || saving}
          className="flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          <Plus size={20} />
          Add Assignment
        </button>
      </header>

      {message && (
        <div className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-700">
          {message}
        </div>
      )}

      {error && !showForm && (
        <div role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
          {error}
        </div>
      )}

      <section className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-slate-500">
                {stat.label}
              </span>

              <div className={`rounded-xl p-3 ${stat.color}`}>
                <stat.icon size={22} />
              </div>
            </div>

            <p className="mt-4 text-3xl font-bold">
              {stat.value}
            </p>
          </div>
        ))}
      </section>

      <section className="mb-6 flex flex-wrap gap-3 rounded-2xl border border-slate-200 bg-white p-4">
        <div className="relative min-w-48 flex-1">
          <Search
            size={20}
            className="absolute left-3 top-3.5 text-slate-400"
          />

          <input
            aria-label="Search assignments"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search assignments..."
            className={`${inputClass} pl-10`}
          />
        </div>

        <select
          aria-label="Filter by status"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="rounded-xl border border-slate-200 px-4 py-3"
        >
          <option value="all">All statuses</option>
          <option value="pending">Pending</option>
          <option value="in_progress">In Progress</option>
          <option value="completed">Completed</option>
          <option value="submitted">Submitted</option>
          <option value="overdue">Overdue</option>
        </select>

        <select
          aria-label="Filter by subject"
          value={subjectFilter}
          onChange={(e) => setSubjectFilter(e.target.value)}
          className="rounded-xl border border-slate-200 px-4 py-3"
        >
          <option value="all">All subjects</option>

          {subjects.map((subject) => (
            <option key={subject.id} value={subject.id}>
              {subject.name}
            </option>
          ))}
        </select>
      </section>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center">
          <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-indigo-50">
            <ClipboardList size={36} className="text-indigo-500" />
          </div>

          <h2 className="text-xl font-semibold">
            {assignments.length === 0
              ? "No assignments added yet"
              : "No matching assignments"}
          </h2>

          <p className="mt-2 text-slate-500">
            {assignments.length === 0
              ? "Add your first assignment to track academic deadlines."
              : "Try changing your search or filters."}
          </p>

          {assignments.length === 0 && (
            <button
              onClick={openAdd}
              disabled={!userId || saving}
              className="mt-6 rounded-xl bg-indigo-600 px-5 py-3 text-white disabled:opacity-50"
            >
              Add Your First Assignment
            </button>
          )}
        </div>
      ) : (
        <section className="grid gap-5 lg:grid-cols-2">
          {filtered.map((assignment) => (
            <article
              key={assignment.id}
              className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <ClipboardList
                  size={27}
                  className="shrink-0 text-indigo-500"
                />

                <div className="min-w-0 flex-1">
                  <h2 className="break-words text-lg font-semibold">
                    {assignment.title}
                  </h2>

                  <p className="mt-1 text-sm text-slate-500">
                    {subjects.find(
                      (s) => s.id === assignment.subject_id
                    )?.name ?? "General Assignment"}
                  </p>
                </div>

                {isOverdue(assignment) && (
                  <span className="rounded-lg bg-red-50 px-3 py-1 text-xs text-red-600">
                    Overdue
                  </span>
                )}
              </div>

              {assignment.description && (
                <p className="mt-4 whitespace-pre-wrap break-words text-sm text-slate-600">
                  {assignment.description}
                </p>
              )}

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <span className="flex items-center gap-2 text-sm text-slate-500">
                  <Calendar size={16} />

                  {assignment.due_date
                    ? new Date(assignment.due_date).toLocaleString()
                    : "No deadline"}
                </span>

                <span className={`rounded-lg px-3 py-1 text-xs capitalize ${
                  assignment.priority === "high"
                    ? "bg-red-50 text-red-600"
                    : assignment.priority === "medium"
                    ? "bg-orange-50 text-orange-600"
                    : "bg-emerald-50 text-emerald-600"
                }`}>
                  {assignment.priority} Priority
                </span>
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
                <select
                  aria-label={`Status of ${assignment.title}`}
                  value={assignment.status}
                  disabled={saving}
                  onChange={(e) =>
                    void updateStatus(
                      assignment.id,
                      e.target.value as Status
                    )
                  }
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                >
                  {Object.entries(statusLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>

                <div className="flex-1" />

                <button
                  disabled={saving}
                  onClick={() => openEdit(assignment)}
                  className="flex items-center gap-2 text-sm text-indigo-600"
                >
                  <Pencil size={16} />
                  Edit
                </button>

                <button
                  disabled={saving}
                  onClick={() => void deleteAssignment(assignment.id)}
                  className="flex items-center gap-2 text-sm text-red-600"
                >
                  <Trash2 size={16} />
                  Delete
                </button>
              </div>
            </article>
          ))}
        </section>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="assignment-form-title"
            className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
          >
            <div className="mb-6 flex items-center justify-between">
              <h2 id="assignment-form-title" className="text-xl font-bold">
                {editingId ? "Edit Assignment" : "Add Assignment"}
              </h2>

              <button
                aria-label="Close form"
                disabled={saving}
                onClick={() => setShowForm(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X size={24} />
              </button>
            </div>

            {error && (
              <div role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-red-600">
                {error}
              </div>
            )}

            <form onSubmit={handleSave} className="space-y-5">
              <label className="block">
                <span className="mb-2 block text-sm font-medium">
                  Assignment Title *
                </span>

                <input
                  required
                  maxLength={250}
                  className={inputClass}
                  placeholder="Example: IoT Module 1 Assignment"
                  value={form.title}
                  onChange={(e) =>
                    setForm({ ...form, title: e.target.value })
                  }
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium">
                  Subject
                </span>

                <select
                  className={inputClass}
                  value={form.subject_id}
                  onChange={(e) =>
                    setForm({ ...form, subject_id: e.target.value })
                  }
                >
                  <option value="">General Assignment</option>

                  {subjects.map((subject) => (
                    <option key={subject.id} value={subject.id}>
                      {subject.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium">
                  Submission Deadline
                </span>

                <input
                  type="datetime-local"
                  className={inputClass}
                  value={form.due_date}
                  onChange={(e) =>
                    setForm({ ...form, due_date: e.target.value })
                  }
                />
              </label>

              <div className="grid grid-cols-2 gap-4">
                <label className="block">
                  <span className="mb-2 block text-sm font-medium">
                    Priority
                  </span>

                  <select
                    className={inputClass}
                    value={form.priority}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        priority: e.target.value as Priority,
                      })
                    }
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-medium">
                    Status
                  </span>

                  <select
                    className={inputClass}
                    value={form.status}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        status: e.target.value as Status,
                      })
                    }
                  >
                    {Object.entries(statusLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="block">
                <span className="mb-2 block text-sm font-medium">
                  Description / Instructions
                </span>

                <textarea
                  rows={5}
                  maxLength={10000}
                  className={inputClass}
                  placeholder="Enter assignment questions or instructions..."
                  value={form.description}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      description: e.target.value,
                    })
                  }
                />
              </label>

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setShowForm(false)}
                  className="rounded-xl border border-slate-200 px-5 py-3"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-xl bg-indigo-600 px-5 py-3 text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {saving ? "Saving..." : "Save Assignment"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
