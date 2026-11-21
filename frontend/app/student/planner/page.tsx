"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

import {
  CalendarDays,
  CalendarClock,
  Clock,
  CircleCheck,
  Plus,
  Pencil,
  Trash2,
  X,
  BookOpen,
  MapPin,
  UserRound,
} from "lucide-react";

type Subject = {
  id: string;
  name: string;
  color: string | null;
};

type StudyPlan = {
  id: string;
  subject_id: string | null;
  title: string;
  description: string | null;
  study_date: string;
  start_time: string | null;
  end_time: string | null;
  priority: string;
  status: string;
};

type TimetableEntry = {
  id: string;
  subject_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  room: string | null;
  instructor: string | null;
};

const days = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

function localDate() {
  const date = new Date();

  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function emptyForm() {
  return {
    subject_id: "",
    title: "",
    description: "",
    study_date: localDate(),
    start_time: "",
    end_time: "",
    priority: "medium",
    status: "pending",
    day_of_week: "1",
    room: "",
    instructor: "",
  };
}

function formatTime(value: string | null) {
  return value ? value.slice(0, 5) : "Not set";
}

const inputClass =
  "mt-2 w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100";

export default function PlannerPage() {
  const [tab, setTab] = useState<"planner" | "timetable">(
    "planner"
  );

  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [plans, setPlans] = useState<StudyPlan[]>([]);
  const [timetable, setTimetable] =
    useState<TimetableEntry[]>([]);

  const [userId, setUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] =
    useState<string | null>(null);

  const [form, setForm] = useState(emptyForm);

  const [dateFilter, setDateFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

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

        const [subjectResult, planResult, timetableResult] =
          await Promise.all([
            supabase
              .from("student_subjects")
              .select("id, name, color")
              .eq("user_id", user.id)
              .order("name"),

            supabase
              .from("student_study_plans")
              .select("*")
              .eq("user_id", user.id)
              .order("study_date")
              .order("start_time"),

            supabase
              .from("student_timetable")
              .select("*")
              .eq("user_id", user.id)
              .order("day_of_week")
              .order("start_time"),
          ]);

        const failed = [
          subjectResult,
          planResult,
          timetableResult,
        ].find((result) => result.error);

        if (failed?.error) {
          throw new Error(failed.error.message);
        }

        setSubjects(subjectResult.data ?? []);
        setPlans(planResult.data ?? []);
        setTimetable(timetableResult.data ?? []);
        setUserId(user.id);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Unable to load study planner."
        );
      } finally {
        setLoading(false);
      }
    }

    void initialize();
  }, []);

  function getSubject(id: string | null) {
    return subjects.find((subject) => subject.id === id);
  }

  function updateField(
    key: keyof ReturnType<typeof emptyForm>,
    value: string
  ) {
    setForm((previous) => ({
      ...previous,
      [key]: value,
    }));
  }

  function openAddForm() {
    setEditingId(null);
    setForm(emptyForm());
    setError("");
    setMessage("");
    setShowForm(true);
  }

  function editPlan(plan: StudyPlan) {
    setEditingId(plan.id);

    setForm({
      ...emptyForm(),
      subject_id: plan.subject_id ?? "",
      title: plan.title,
      description: plan.description ?? "",
      study_date: plan.study_date,
      start_time: plan.start_time?.slice(0, 5) ?? "",
      end_time: plan.end_time?.slice(0, 5) ?? "",
      priority: plan.priority,
      status: plan.status,
    });

    setError("");
    setMessage("");
    setShowForm(true);
  }

  function editClass(entry: TimetableEntry) {
    setEditingId(entry.id);

    setForm({
      ...emptyForm(),
      subject_id: entry.subject_id,
      day_of_week: String(entry.day_of_week),
      start_time: entry.start_time.slice(0, 5),
      end_time: entry.end_time.slice(0, 5),
      room: entry.room ?? "",
      instructor: entry.instructor ?? "",
    });

    setError("");
    setMessage("");
    setShowForm(true);
  }

  function closeForm() {
    if (saving) return;

    setShowForm(false);
    setEditingId(null);
    setError("");
  }

  async function handleSave(
    event: React.FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    if (!userId || saving) return;

    setError("");
    setMessage("");

    if (
      form.start_time &&
      form.end_time &&
      form.end_time <= form.start_time
    ) {
      setError("End time must be after start time.");
      return;
    }

    if (tab === "planner") {
      if (!form.title.trim() || !form.study_date) {
        setError("Title and study date are required.");
        return;
      }
    } else {
      if (
        !form.subject_id ||
        !form.start_time ||
        !form.end_time
      ) {
        setError("Subject, start time and end time are required.");
        return;
      }
    }

    setSaving(true);

    try {
      const supabase = createClient();

      if (tab === "planner") {
        const payload = {
          title: form.title.trim(),
          subject_id: form.subject_id || null,
          description: form.description.trim() || null,
          study_date: form.study_date,
          start_time: form.start_time || null,
          end_time: form.end_time || null,
          priority: form.priority,
          status: form.status,
        };

        const query = editingId
          ? supabase
              .from("student_study_plans")
              .update(payload)
              .eq("id", editingId)
              .eq("user_id", userId)
          : supabase
              .from("student_study_plans")
              .insert({
                ...payload,
                user_id: userId,
              });

        const { data, error } = await query
          .select("*")
          .single();

        if (error) throw new Error(error.message);

        setPlans((previous) =>
          [
            ...previous.filter(
              (plan) => plan.id !== data.id
            ),
            data,
          ].sort((a, b) =>
            `${a.study_date} ${a.start_time ?? ""}`
              .localeCompare(
                `${b.study_date} ${b.start_time ?? ""}`
              )
          )
        );

        setMessage(
          editingId
            ? "Study session updated."
            : "Study session added."
        );
      } else {
        const payload = {
          subject_id: form.subject_id,
          day_of_week: Number(form.day_of_week),
          start_time: form.start_time,
          end_time: form.end_time,
          room: form.room.trim() || null,
          instructor: form.instructor.trim() || null,
        };

        const query = editingId
          ? supabase
              .from("student_timetable")
              .update(payload)
              .eq("id", editingId)
              .eq("user_id", userId)
          : supabase
              .from("student_timetable")
              .insert({
                ...payload,
                user_id: userId,
              });

        const { data, error } = await query
          .select("*")
          .single();

        if (error) throw new Error(error.message);

        setTimetable((previous) =>
          [
            ...previous.filter(
              (entry) => entry.id !== data.id
            ),
            data,
          ].sort(
            (a, b) =>
              a.day_of_week - b.day_of_week ||
              a.start_time.localeCompare(b.start_time)
          )
        );

        setMessage(
          editingId
            ? "Class updated successfully."
            : "Class added successfully."
        );
      }

      setShowForm(false);
      setEditingId(null);
      setForm(emptyForm());
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to save changes."
      );
    } finally {
      setSaving(false);
    }
  }

  async function updateStatus(
    planId: string,
    status: string
  ) {
    if (!userId || saving) return;

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const supabase = createClient();

      const { data, error } = await supabase
        .from("student_study_plans")
        .update({ status })
        .eq("id", planId)
        .eq("user_id", userId)
        .select("*")
        .single();

      if (error) throw new Error(error.message);

      setPlans((previous) =>
        previous.map((plan) =>
          plan.id === planId ? data : plan
        )
      );

      setMessage("Study progress updated.");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to update progress."
      );
    } finally {
      setSaving(false);
    }
  }

  async function deleteItem(
    id: string,
    type: "planner" | "timetable"
  ) {
    if (!userId || saving) return;

    const confirmed = window.confirm(
      type === "planner"
        ? "Delete this study session permanently?"
        : "Delete this scheduled class permanently?"
    );

    if (!confirmed) return;

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const supabase = createClient();

      const table =
        type === "planner"
          ? "student_study_plans"
          : "student_timetable";

      const { error } = await supabase
        .from(table)
        .delete()
        .eq("id", id)
        .eq("user_id", userId)
        .select("id")
        .single();

      if (error) throw new Error(error.message);

      if (type === "planner") {
        setPlans((previous) =>
          previous.filter((plan) => plan.id !== id)
        );
      } else {
        setTimetable((previous) =>
          previous.filter((entry) => entry.id !== id)
        );
      }

      setMessage("Deleted successfully.");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to delete record."
      );
    } finally {
      setSaving(false);
    }
  }

  const completed = plans.filter(
    (plan) => plan.status === "completed"
  ).length;

  const pending = plans.filter(
    (plan) => plan.status !== "completed"
  ).length;

  const filteredPlans = plans.filter(
    (plan) =>
      (!dateFilter || plan.study_date === dateFilter) &&
      (statusFilter === "all" ||
        plan.status === statusFilter)
  );

  const progress =
    plans.length > 0
      ? Math.round((completed / plans.length) * 100)
      : 0;

  const statistics =
    tab === "planner"
      ? [
          {
            title: "Total Sessions",
            value: plans.length,
            icon: CalendarDays,
            color: "bg-indigo-50 text-indigo-600",
          },
          {
            title: "Remaining Sessions",
            value: pending,
            icon: Clock,
            color: "bg-orange-50 text-orange-600",
          },
          {
            title: "Completed",
            value: completed,
            icon: CircleCheck,
            color: "bg-emerald-50 text-emerald-600",
          },
        ]
      : [
          {
            title: "Weekly Classes",
            value: timetable.length,
            icon: CalendarDays,
            color: "bg-indigo-50 text-indigo-600",
          },
          {
            title: "Scheduled Subjects",
            value: new Set(
              timetable.map((entry) => entry.subject_id)
            ).size,
            icon: BookOpen,
            color: "bg-purple-50 text-purple-600",
          },
          {
            title: "Class Days",
            value: new Set(
              timetable.map((entry) => entry.day_of_week)
            ).size,
            icon: CalendarClock,
            color: "bg-emerald-50 text-emerald-600",
          },
        ];

  if (loading) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center">
        <p className="text-sm text-slate-500">
          Loading study planner...
        </p>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 p-4 sm:p-6 xl:p-8">
      <div className="mx-auto max-w-7xl space-y-6">

        {/* Header */}

        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">
              Study Planner
            </h1>

            <p className="mt-2 text-sm text-slate-500">
              Organize your classes and study sessions.
            </p>
          </div>

          <button
            type="button"
            onClick={openAddForm}
            disabled={!userId || saving}
            className="flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-3 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            <Plus size={20} />

            {tab === "planner"
              ? "Add Session"
              : "Add Class"}
          </button>
        </div>

        {/* Navigation tabs */}

        <div className="flex gap-6 border-b border-slate-200">
          {[
            {
              key: "planner" as const,
              label: "Study Planner",
              icon: CalendarDays,
            },
            {
              key: "timetable" as const,
              label: "Class Timetable",
              icon: CalendarClock,
            },
          ].map((item) => {
            const Icon = item.icon;

            return (
              <button
                key={item.key}
                type="button"
                disabled={saving}
                onClick={() => {
                  setTab(item.key);
                  setMessage("");

                  if (userId) setError("");
                }}
                className={`flex items-center gap-2 border-b-2 px-2 py-4 text-sm font-medium ${
                  tab === item.key
                    ? "border-indigo-600 text-indigo-600"
                    : "border-transparent text-slate-500"
                }`}
              >
                <Icon size={18} />
                {item.label}
              </button>
            );
          })}
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

        {error && !showForm && (
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

        {/* Study Planner */}

        {tab === "planner" && (
          <>
            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex justify-between">
                <h2 className="font-semibold">
                  Study Progress
                </h2>

                <span className="font-semibold text-indigo-600">
                  {progress}%
                </span>
              </div>

              <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-indigo-600 transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>

              <p className="mt-3 text-sm text-slate-500">
                {completed} of {plans.length} sessions completed
              </p>
            </section>

            {/* Filters */}

            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
              <input
                type="date"
                aria-label="Filter by study date"
                value={dateFilter}
                onChange={(event) =>
                  setDateFilter(event.target.value)
                }
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />

              <select
                aria-label="Filter by status"
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.target.value)
                }
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                <option value="all">All statuses</option>
                <option value="pending">Pending</option>
                <option value="in_progress">
                  In Progress
                </option>
                <option value="completed">
                  Completed
                </option>
              </select>

              <button
                type="button"
                onClick={() => setDateFilter(localDate())}
                className="rounded-lg bg-indigo-50 px-4 py-2 text-sm text-indigo-600"
              >
                Today
              </button>

              <button
                type="button"
                onClick={() => {
                  setDateFilter("");
                  setStatusFilter("all");
                }}
                className="rounded-lg bg-slate-100 px-4 py-2 text-sm text-slate-600"
              >
                Clear Filters
              </button>
            </div>

            {/* Sessions */}

            {filteredPlans.length === 0 ? (
              <section className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-slate-200 bg-white p-8 text-center">
                <CalendarDays
                  size={42}
                  className="text-indigo-400"
                />

                <h2 className="mt-4 text-lg font-semibold">
                  No study sessions found
                </h2>

                <p className="mt-2 text-sm text-slate-500">
                  Create a session or change your filters.
                </p>
              </section>
            ) : (
              <section className="space-y-4">
                {filteredPlans.map((plan) => {
                  const subject = getSubject(plan.subject_id);

                  return (
                    <article
                      key={plan.id}
                      className="flex flex-wrap items-start gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
                    >
                      <div
                        className="h-16 w-1.5 rounded-full"
                        style={{
                          backgroundColor:
                            subject?.color ?? "#6366f1",
                        }}
                      />

                      <div className="min-w-0 flex-1">
                        <h2 className="break-words font-semibold">
                          {plan.title}
                        </h2>

                        <p className="mt-1 text-sm text-slate-500">
                          {subject?.name ?? "General Study"}
                        </p>

                        <p className="mt-2 text-sm text-slate-500">
                          {plan.study_date} ·{" "}
                          {formatTime(plan.start_time)} –{" "}
                          {formatTime(plan.end_time)}
                        </p>

                        <span
                          className={`mt-3 inline-block rounded-full px-3 py-1 text-xs capitalize ${
                            plan.priority === "high"
                              ? "bg-red-50 text-red-600"
                              : plan.priority === "medium"
                                ? "bg-orange-50 text-orange-600"
                                : "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {plan.priority} priority
                        </span>

                        {plan.description && (
                          <p className="mt-3 whitespace-pre-wrap break-words text-sm text-slate-600">
                            {plan.description}
                          </p>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-3">
                        <select
                          aria-label={`Status for ${plan.title}`}
                          disabled={saving}
                          value={plan.status}
                          onChange={(event) =>
                            void updateStatus(
                              plan.id,
                              event.target.value
                            )
                          }
                          className="rounded-lg border border-slate-200 px-3 py-2 text-xs"
                        >
                          <option value="pending">
                            Pending
                          </option>
                          <option value="in_progress">
                            In Progress
                          </option>
                          <option value="completed">
                            Completed
                          </option>
                        </select>

                        <button
                          type="button"
                          disabled={saving}
                          aria-label={`Edit ${plan.title}`}
                          onClick={() => editPlan(plan)}
                          className="rounded-lg bg-indigo-50 p-2.5 text-indigo-600"
                        >
                          <Pencil size={17} />
                        </button>

                        <button
                          type="button"
                          disabled={saving}
                          aria-label={`Delete ${plan.title}`}
                          onClick={() =>
                            void deleteItem(plan.id, "planner")
                          }
                          className="rounded-lg bg-red-50 p-2.5 text-red-600"
                        >
                          <Trash2 size={17} />
                        </button>
                      </div>
                    </article>
                  );
                })}
              </section>
            )}
          </>
        )}

        {/* Weekly Timetable */}

        {tab === "timetable" && (
          <section className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {days.map((day, index) => {
              const entries = timetable.filter(
                (entry) => entry.day_of_week === index + 1
              );

              return (
                <div
                  key={day}
                  className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
                >
                  <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                    <h2 className="font-semibold">{day}</h2>

                    <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs text-indigo-600">
                      {entries.length} classes
                    </span>
                  </div>

                  {entries.length === 0 ? (
                    <p className="py-8 text-center text-sm text-slate-400">
                      No classes scheduled
                    </p>
                  ) : (
                    <div className="mt-4 space-y-3">
                      {entries.map((entry) => {
                        const subject = getSubject(
                          entry.subject_id
                        );

                        return (
                          <article
                            key={entry.id}
                            className="rounded-lg border-l-4 bg-slate-50 p-4"
                            style={{
                              borderColor:
                                subject?.color ?? "#6366f1",
                            }}
                          >
                            <h3 className="font-medium">
                              {subject?.name ?? "Subject"}
                            </h3>

                            <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                              <Clock size={14} />

                              {formatTime(entry.start_time)} –{" "}
                              {formatTime(entry.end_time)}
                            </div>

                            {entry.room && (
                              <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                                <MapPin size={14} />
                                {entry.room}
                              </div>
                            )}

                            {entry.instructor && (
                              <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                                <UserRound size={14} />
                                {entry.instructor}
                              </div>
                            )}

                            <div className="mt-4 flex justify-end gap-3">
                              <button
                                type="button"
                                disabled={saving}
                                aria-label="Edit class"
                                onClick={() => editClass(entry)}
                                className="text-indigo-600"
                              >
                                <Pencil size={16} />
                              </button>

                              <button
                                type="button"
                                disabled={saving}
                                aria-label="Delete class"
                                onClick={() =>
                                  void deleteItem(
                                    entry.id,
                                    "timetable"
                                  )
                                }
                                className="text-red-600"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        )}
      </div>

      {/* Add / Edit Dialog */}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Schedule editor"
            className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold">
                {editingId ? "Edit" : "Add"}{" "}
                {tab === "planner"
                  ? "Study Session"
                  : "Class"}
              </h2>

              <button
                type="button"
                aria-label="Close form"
                disabled={saving}
                onClick={closeForm}
                className="text-slate-400"
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
              {tab === "planner" && (
                <label className="block text-sm font-medium">
                  Session Title *
                  <input
                    required
                    maxLength={150}
                    value={form.title}
                    onChange={(event) =>
                      updateField("title", event.target.value)
                    }
                    placeholder="Example: Revise IoT Module 1"
                    className={inputClass}
                  />
                </label>
              )}

              <label className="block text-sm font-medium">
                Subject {tab === "timetable" ? "*" : ""}
                <select
                  required={tab === "timetable"}
                  value={form.subject_id}
                  onChange={(event) =>
                    updateField(
                      "subject_id",
                      event.target.value
                    )
                  }
                  className={inputClass}
                >
                  <option value="">
                    {tab === "planner"
                      ? "General Study"
                      : "Select a subject"}
                  </option>

                  {subjects.map((subject) => (
                    <option
                      key={subject.id}
                      value={subject.id}
                    >
                      {subject.name}
                    </option>
                  ))}
                </select>
              </label>

              {tab === "planner" ? (
                <label className="block text-sm font-medium">
                  Study Date *
                  <input
                    required
                    type="date"
                    value={form.study_date}
                    onChange={(event) =>
                      updateField(
                        "study_date",
                        event.target.value
                      )
                    }
                    className={inputClass}
                  />
                </label>
              ) : (
                <label className="block text-sm font-medium">
                  Day of Week *
                  <select
                    value={form.day_of_week}
                    onChange={(event) =>
                      updateField(
                        "day_of_week",
                        event.target.value
                      )
                    }
                    className={inputClass}
                  >
                    {days.map((day, index) => (
                      <option key={day} value={index + 1}>
                        {day}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <div className="grid grid-cols-2 gap-4">
                <label className="block text-sm font-medium">
                  Start Time
                  <input
                    type="time"
                    required={tab === "timetable"}
                    value={form.start_time}
                    onChange={(event) =>
                      updateField(
                        "start_time",
                        event.target.value
                      )
                    }
                    className={inputClass}
                  />
                </label>

                <label className="block text-sm font-medium">
                  End Time
                  <input
                    type="time"
                    required={tab === "timetable"}
                    value={form.end_time}
                    onChange={(event) =>
                      updateField(
                        "end_time",
                        event.target.value
                      )
                    }
                    className={inputClass}
                  />
                </label>
              </div>

              {tab === "planner" ? (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <label className="block text-sm font-medium">
                      Priority
                      <select
                        value={form.priority}
                        onChange={(event) =>
                          updateField(
                            "priority",
                            event.target.value
                          )
                        }
                        className={inputClass}
                      >
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                      </select>
                    </label>

                    <label className="block text-sm font-medium">
                      Status
                      <select
                        value={form.status}
                        onChange={(event) =>
                          updateField(
                            "status",
                            event.target.value
                          )
                        }
                        className={inputClass}
                      >
                        <option value="pending">Pending</option>
                        <option value="in_progress">
                          In Progress
                        </option>
                        <option value="completed">
                          Completed
                        </option>
                      </select>
                    </label>
                  </div>

                  <label className="block text-sm font-medium">
                    Description
                    <textarea
                      rows={3}
                      maxLength={3000}
                      value={form.description}
                      onChange={(event) =>
                        updateField(
                          "description",
                          event.target.value
                        )
                      }
                      placeholder="What do you want to study?"
                      className={inputClass}
                    />
                  </label>
                </>
              ) : (
                <>
                  <label className="block text-sm font-medium">
                    Classroom
                    <input
                      maxLength={100}
                      value={form.room}
                      onChange={(event) =>
                        updateField("room", event.target.value)
                      }
                      placeholder="Example: Room 204"
                      className={inputClass}
                    />
                  </label>

                  <label className="block text-sm font-medium">
                    Instructor
                    <input
                      maxLength={150}
                      value={form.instructor}
                      onChange={(event) =>
                        updateField(
                          "instructor",
                          event.target.value
                        )
                      }
                      placeholder="Faculty name"
                      className={inputClass}
                    />
                  </label>
                </>
              )}

              <div className="flex justify-end gap-3 border-t border-slate-100 pt-5">
                <button
                  type="button"
                  disabled={saving}
                  onClick={closeForm}
                  className="rounded-lg border border-slate-200 px-5 py-3 text-sm"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-indigo-600 px-5 py-3 text-sm font-medium text-white disabled:opacity-50"
                >
                  {saving ? "Saving..." : "Save"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}