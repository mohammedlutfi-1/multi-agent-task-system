"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

import {
  BookOpen,
  Plus,
  Search,
  Pencil,
  Trash2,
  X,
  GraduationCap,
  Layers,
  AlertTriangle,
} from "lucide-react";

type Subject = {
  id: string;
  name: string;
  subject_code: string | null;
  semester: number | null;
  credits: number | null;
  description: string | null;
  color: string | null;
};

const emptyForm = {
  name: "",
  subject_code: "",
  semester: "",
  credits: "",
  description: "",
  color: "#6366f1",
};

const colors = [
  "#6366f1",
  "#2563eb",
  "#059669",
  "#dc2626",
  "#ea580c",
  "#9333ea",
  "#0891b2",
  "#db2777",
];

export default function SubjectsPage() {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [userId, setUserId] = useState("");
  const [currentSemester, setCurrentSemester] =
    useState<number | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] =
    useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] =
    useState<Subject | null>(null);

  const [form, setForm] = useState(emptyForm);

  useEffect(() => {
    async function initialize() {
      try {
        const supabase = createClient();

        const {
          data: { user },
          error: authError,
        } = await supabase.auth.getUser();

        if (authError || !user) {
          window.location.replace("/");
          return;
        }

        setUserId(user.id);

        const [subjectResult, profileResult] =
          await Promise.all([
            supabase
              .from("student_subjects")
              .select(
                "id, name, subject_code, semester, credits, description, color"
              )
              .eq("user_id", user.id)
              .order("created_at", {
                ascending: false,
              }),

            supabase
              .from("student_profiles")
              .select("semester")
              .eq("user_id", user.id)
              .maybeSingle(),
          ]);

        if (subjectResult.error) {
          throw new Error(subjectResult.error.message);
        }

        if (profileResult.error) {
          throw new Error(profileResult.error.message);
        }

        setSubjects(subjectResult.data ?? []);
        setCurrentSemester(
          profileResult.data?.semester ?? null
        );
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Unable to load subjects."
        );
      } finally {
        setLoading(false);
      }
    }

    void initialize();
  }, []);

  function openAddForm() {
    setEditingId(null);

    setForm({
      ...emptyForm,
      semester: currentSemester?.toString() ?? "",
    });

    setError("");
    setMessage("");
    setShowForm(true);
  }

  function openEditForm(subject: Subject) {
    setEditingId(subject.id);

    setForm({
      name: subject.name,
      subject_code: subject.subject_code ?? "",
      semester: subject.semester?.toString() ?? "",
      credits: subject.credits?.toString() ?? "",
      description: subject.description ?? "",
      color: subject.color ?? "#6366f1",
    });

    setError("");
    setMessage("");
    setShowForm(true);
  }

  function closeForm() {
    if (saving) return;

    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm);
    setError("");
  }

  async function handleSave(
    event: React.FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setError("");
    setMessage("");

    if (!form.name.trim()) {
      setError("Subject name is required.");
      return;
    }

    if (!userId) {
      setError("Please sign in again.");
      return;
    }

    const semester = form.semester
      ? Number(form.semester)
      : null;

    const credits = form.credits
      ? Number(form.credits)
      : null;

    if (
      semester !== null &&
      (!Number.isInteger(semester) ||
        semester < 1 ||
        semester > 20)
    ) {
      setError("Semester must be between 1 and 20.");
      return;
    }

    if (
      credits !== null &&
      (!Number.isFinite(credits) ||
        credits < 0 ||
        credits > 999.9)
    ) {
      setError("Enter valid subject credits.");
      return;
    }

    setSaving(true);

    try {
      const supabase = createClient();

      const payload = {
        name: form.name.trim(),
        subject_code: form.subject_code.trim() || null,
        semester,
        credits,
        description: form.description.trim() || null,
        color: form.color,
      };

      const query = editingId
        ? supabase
            .from("student_subjects")
            .update(payload)
            .eq("id", editingId)
            .eq("user_id", userId)
        : supabase
            .from("student_subjects")
            .insert({
              ...payload,
              user_id: userId,
            });

      const { data, error } = await query
        .select(
          "id, name, subject_code, semester, credits, description, color"
        )
        .single();

      if (error) {
        throw new Error(error.message);
      }

      if (editingId) {
        setSubjects((previous) =>
          previous.map((subject) =>
            subject.id === editingId ? data : subject
          )
        );

        setMessage("Subject updated successfully.");
      } else {
        setSubjects((previous) => [data, ...previous]);

        setMessage("Subject added successfully.");
      }

      setShowForm(false);
      setEditingId(null);
      setForm(emptyForm);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to save subject."
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget || !userId || saving) return;

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const supabase = createClient();

      const { error } = await supabase
        .from("student_subjects")
        .delete()
        .eq("id", deleteTarget.id)
        .eq("user_id", userId)
        .select("id")
        .single();

      if (error) {
        throw new Error(error.message);
      }

      setSubjects((previous) =>
        previous.filter(
          (subject) => subject.id !== deleteTarget.id
        )
      );

      setDeleteTarget(null);
      setMessage("Subject deleted successfully.");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to delete subject."
      );
    } finally {
      setSaving(false);
    }
  }

  const searchValue = search.trim().toLowerCase();

  const filteredSubjects = subjects.filter(
    (subject) =>
      subject.name.toLowerCase().includes(searchValue) ||
      (subject.subject_code ?? "")
        .toLowerCase()
        .includes(searchValue)
  );

  const totalCredits = subjects.reduce(
    (total, subject) =>
      total + Number(subject.credits ?? 0),
    0
  );

  const statistics = [
    {
      title: "Total Subjects",
      value: subjects.length,
      icon: BookOpen,
      color: "bg-indigo-50 text-indigo-600",
    },
    {
      title: "Total Credits",
      value: Number(totalCredits.toFixed(1)),
      icon: Layers,
      color: "bg-emerald-50 text-emerald-600",
    },
    {
      title: "Current Semester",
      value: currentSemester ?? "—",
      icon: GraduationCap,
      color: "bg-purple-50 text-purple-600",
    },
  ];

  const inputClass =
    "mt-2 w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100";

  if (loading) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center">
        <p className="text-sm text-slate-500">
          Loading subjects...
        </p>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 p-4 sm:p-6 xl:p-8">
      <div className="mx-auto max-w-7xl space-y-6">

        {/* Page heading */}

        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">
              Subjects
            </h1>

            <p className="mt-2 text-sm text-slate-500">
              Manage your academic subjects and courses.
            </p>
          </div>

          <button
            type="button"
            onClick={openAddForm}
            disabled={!userId}
            className="flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-3 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            <Plus size={19} />
            Add Subject
          </button>
        </div>

        {/* Messages */}

        {message && (
          <div
            role="status"
            className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700"
          >
            {message}
          </div>
        )}

        {error && !showForm && !deleteTarget && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700"
          >
            {error}
          </div>
        )}

        {/* Statistics */}

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {statistics.map((stat) => {
            const Icon = stat.icon;

            return (
              <div
                key={stat.title}
                className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <p className="text-sm text-slate-500">
                    {stat.title}
                  </p>

                  <div className={`rounded-lg p-3 ${stat.color}`}>
                    <Icon size={22} />
                  </div>
                </div>

                <p className="mt-3 text-3xl font-bold">
                  {stat.value}
                </p>
              </div>
            );
          })}
        </section>

        {/* Search */}

        <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
          <Search size={20} className="text-slate-400" />

          <input
            type="search"
            aria-label="Search subjects"
            value={search}
            onChange={(event) =>
              setSearch(event.target.value)
            }
            placeholder="Search by subject name or code..."
            className="w-full bg-transparent text-sm outline-none"
          />
        </div>

        {/* Subject cards */}

        {filteredSubjects.length === 0 ? (
          <section className="flex min-h-72 flex-col items-center justify-center rounded-xl border border-slate-200 bg-white p-8 text-center">
            <div className="rounded-full bg-indigo-50 p-5">
              <BookOpen
                size={38}
                className="text-indigo-500"
              />
            </div>

            <h2 className="mt-5 text-lg font-semibold">
              {searchValue
                ? "No matching subjects"
                : "No subjects added yet"}
            </h2>

            <p className="mt-2 text-sm text-slate-500">
              {searchValue
                ? "Try another subject name or code."
                : "Add your first subject to organize your academic workspace."}
            </p>

            {!searchValue && (
              <button
                type="button"
                onClick={openAddForm}
                disabled={!userId}
                className="mt-5 flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-3 text-sm font-medium text-white disabled:opacity-50"
              >
                <Plus size={18} />
                Add Your First Subject
              </button>
            )}
          </section>
        ) : (
          <section className="grid grid-cols-1 gap-5 md:grid-cols-2 2xl:grid-cols-3">
            {filteredSubjects.map((subject) => (
              <article
                key={subject.id}
                className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
              >
                <div
                  className="h-1.5"
                  style={{
                    backgroundColor:
                      subject.color ?? "#6366f1",
                  }}
                />

                <div className="p-5">
                  <BookOpen
                    size={26}
                    style={{
                      color: subject.color ?? "#6366f1",
                    }}
                  />

                  <h2 className="mt-4 break-words text-lg font-semibold text-slate-900">
                    {subject.name}
                  </h2>

                  <p className="mt-1 text-sm text-slate-500">
                    {subject.subject_code ||
                      "No subject code"}
                  </p>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <span className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600">
                      Semester {subject.semester ?? "—"}
                    </span>

                    <span className="rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-700">
                      {subject.credits ?? "—"} Credits
                    </span>
                  </div>

                  {subject.description && (
                    <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-500">
                      {subject.description}
                    </p>
                  )}

                  <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4">
                    <button
                      type="button"
                      onClick={() => openEditForm(subject)}
                      className="flex items-center gap-2 text-sm font-medium text-indigo-600"
                    >
                      <Pencil size={16} />
                      Edit
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setError("");
                        setMessage("");
                        setDeleteTarget(subject);
                      }}
                      className="flex items-center gap-2 text-sm font-medium text-red-600"
                    >
                      <Trash2 size={16} />
                      Delete
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </section>
        )}
      </div>

      {/* Add and edit form */}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <section
            role="dialog"
            aria-modal="true"
            aria-label={editingId ? "Edit subject" : "Add subject"}
            className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold">
                {editingId ? "Edit Subject" : "Add Subject"}
              </h2>

              <button
                type="button"
                aria-label="Close form"
                onClick={closeForm}
                disabled={saving}
                className="text-slate-400 hover:text-slate-700"
              >
                <X size={23} />
              </button>
            </div>

            {error && (
              <p
                role="alert"
                className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-600"
              >
                {error}
              </p>
            )}

            <form
              onSubmit={handleSave}
              className="mt-6 space-y-4"
            >
              <label className="block text-sm font-medium">
                Subject Name *
                <input
                  required
                  maxLength={150}
                  value={form.name}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      name: event.target.value,
                    })
                  }
                  placeholder="Example: Internet of Things"
                  className={inputClass}
                />
              </label>

              <label className="block text-sm font-medium">
                Subject Code
                <input
                  maxLength={50}
                  value={form.subject_code}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      subject_code: event.target.value,
                    })
                  }
                  placeholder="Example: BCS701"
                  className={inputClass}
                />
              </label>

              <div className="grid grid-cols-2 gap-4">
                <label className="block text-sm font-medium">
                  Semester
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={form.semester}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        semester: event.target.value,
                      })
                    }
                    className={inputClass}
                  />
                </label>

                <label className="block text-sm font-medium">
                  Credits
                  <input
                    type="number"
                    min="0"
                    max="999.9"
                    step="0.1"
                    value={form.credits}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        credits: event.target.value,
                      })
                    }
                    className={inputClass}
                  />
                </label>
              </div>

              <div>
                <p className="text-sm font-medium">
                  Subject Colour
                </p>

                <div className="mt-3 flex flex-wrap gap-3">
                  {colors.map((color) => (
                    <button
                      key={color}
                      type="button"
                      aria-label={`Select colour ${color}`}
                      aria-pressed={form.color === color}
                      onClick={() =>
                        setForm({ ...form, color })
                      }
                      style={{
                        backgroundColor: color,
                      }}
                      className={`h-8 w-8 rounded-full ${
                        form.color === color
                          ? "ring-2 ring-slate-500 ring-offset-2"
                          : ""
                      }`}
                    />
                  ))}
                </div>
              </div>

              <label className="block text-sm font-medium">
                Description
                <textarea
                  rows={4}
                  maxLength={3000}
                  value={form.description}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      description: event.target.value,
                    })
                  }
                  placeholder="Additional subject information..."
                  className={inputClass}
                />
              </label>

              <div className="flex justify-end gap-3 border-t border-slate-100 pt-5">
                <button
                  type="button"
                  onClick={closeForm}
                  disabled={saving}
                  className="rounded-lg border border-slate-200 px-5 py-3 text-sm"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-indigo-600 px-5 py-3 text-sm font-medium text-white disabled:opacity-50"
                >
                  {saving
                    ? "Saving..."
                    : editingId
                      ? "Save Changes"
                      : "Add Subject"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {/* Delete confirmation */}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <section
            role="alertdialog"
            aria-modal="true"
            aria-label="Delete subject confirmation"
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50">
              <AlertTriangle
                size={25}
                className="text-red-600"
              />
            </div>

            <h2 className="mt-4 text-xl font-bold">
              Delete Subject?
            </h2>

            <p className="mt-3 text-sm leading-relaxed text-slate-600">
              Are you sure you want to delete{" "}
              <strong>{deleteTarget.name}</strong>?
            </p>

            <div className="mt-4 rounded-lg bg-red-50 p-4 text-sm leading-relaxed text-red-700">
              Associated attendance, marks and timetable
              records will also be permanently deleted.
              Other linked academic records will lose
              their subject association. This action
              cannot be undone.
            </div>

            {error && (
              <p role="alert" className="mt-3 text-sm text-red-600">
                {error}
              </p>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  setDeleteTarget(null);
                  setError("");
                }}
                className="rounded-lg border border-slate-200 px-4 py-3 text-sm"
              >
                Cancel
              </button>

              <button
                type="button"
                disabled={saving}
                onClick={handleDelete}
                className="rounded-lg bg-red-600 px-4 py-3 text-sm font-medium text-white disabled:opacity-50"
              >
                {saving ? "Deleting..." : "Delete Subject"}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}