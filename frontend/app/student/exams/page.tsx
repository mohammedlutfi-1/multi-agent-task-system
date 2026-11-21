"use client";

import { useEffect, useState } from "react";
import {
  GraduationCap,
  CalendarDays,
  Clock,
  BookOpen,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  RefreshCw,
  MapPin,
  BrainCircuit,
  ClipboardCheck,
} from "lucide-react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type Subject = {
  id: string;
  name: string;
};

type Exam = {
  id: string;
  subject_id: string | null;
  title: string;
  exam_date: string;
  start_time: string | null;
  duration_minutes: number | null;
  syllabus: string | null;
  completed_topics: string[];
  venue: string | null;
  status: string;
  preparation_status: string;
};

function today() {
  const d = new Date();

  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

function daysRemaining(date: string) {
  return Math.round(
    (
      Date.parse(date + "T00:00:00Z") -
      Date.parse(today() + "T00:00:00Z")
    ) / 86400000
  );
}

function formatDate(date: string) {
  return new Date(
    date + "T00:00:00"
  ).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function emptyForm() {
  return {
    subject_id: "",
    title: "",
    exam_date: today(),
    start_time: "",
    duration_minutes: "",
    syllabus: "",
    venue: "",
    status: "upcoming",
    preparation_status: "not_started",
  };
}

const fieldClass =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100";

export default function ExamPreparationPage() {
  const [supabase] = useState(() => createClient());

  const [userId, setUserId] = useState("");
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [exams, setExams] = useState<Exam[]>([]);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);

  const [filter, setFilter] = useState("all");
  const [savingTopicExamId, setSavingTopicExamId] =
    useState<string | null>(null);

  async function loadData(uid: string) {
    const [subjectResult, examResult] = await Promise.all([
      supabase
        .from("student_subjects")
        .select("id,name")
        .eq("user_id", uid)
        .order("name"),

      supabase
        .from("student_exams")
        .select("*")
        .eq("user_id", uid)
        .order("exam_date", { ascending: true }),
    ]);

    if (subjectResult.error) throw subjectResult.error;
    if (examResult.error) throw examResult.error;

    setSubjects(subjectResult.data ?? []);
    setExams(examResult.data ?? []);
  }

  useEffect(() => {
    async function initialize() {
      try {
        const { data, error } = await supabase.auth.getUser();

        if (error || !data.user) {
          window.location.replace("/");
          return;
        }

        setUserId(data.user.id);
        await loadData(data.user.id);

      } catch {
        setError("Unable to load exam preparation records.");
      } finally {
        setLoading(false);
      }
    }

    void initialize();
  }, []);

  function updateField(
    key: keyof ReturnType<typeof emptyForm>,
    value: string
  ) {
    setForm(previous => ({
      ...previous,
      [key]: value,
    }));
  }

  function resetForm() {
    setEditing(null);
    setForm(emptyForm());
    setShowForm(false);
  }

  function addExam() {
    setEditing(null);
    setForm(emptyForm());
    setError("");
    setSuccess("");
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function editExam(exam: Exam) {
    setEditing(exam.id);

    setForm({
      subject_id: exam.subject_id ?? "",
      title: exam.title,
      exam_date: exam.exam_date,
      start_time: exam.start_time?.slice(0, 5) ?? "",
      duration_minutes:
        exam.duration_minutes?.toString() ?? "",
      syllabus: exam.syllabus ?? "",
      venue: exam.venue ?? "",
      status: exam.status,
      preparation_status: exam.preparation_status,
    });

    setShowForm(true);
    setError("");
    setSuccess("");

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function refresh() {
    if (!userId || busy) return;

    setLoading(true);
    setError("");

    try {
      await loadData(userId);
    } catch {
      setError("Unable to refresh examinations.");
    } finally {
      setLoading(false);
    }
  }

  async function saveExam(event: React.FormEvent) {
    event.preventDefault();

    if (!userId || busy) return;

    setError("");
    setSuccess("");

    if (!form.title.trim() || !form.exam_date) {
      setError("Exam title and date are required.");
      return;
    }

    if (
      form.subject_id &&
      !subjects.some(s => s.id === form.subject_id)
    ) {
      setError("Please select a valid subject.");
      return;
    }

    const duration = form.duration_minutes
      ? Number(form.duration_minutes)
      : null;

    if (
      duration !== null &&
      (!Number.isInteger(duration) || duration <= 0)
    ) {
      setError("Exam duration must be a positive whole number.");
      return;
    }

    const payload = {
      user_id: userId,
      subject_id: form.subject_id || null,
      title: form.title.trim(),
      exam_date: form.exam_date,
      start_time: form.start_time || null,
      duration_minutes: duration,
      syllabus: form.syllabus.trim() || null,
      completed_topics: editing
        ? (
            exams.find(item => item.id === editing)
              ?.completed_topics ?? []
          ).filter(topic =>
            syllabusTopics(form.syllabus).includes(topic)
          )
        : [],
      venue: form.venue.trim() || null,
      status: form.status,
      preparation_status: form.preparation_status,
    };

    setBusy(true);

    try {
      const result = editing
        ? await supabase
            .from("student_exams")
            .update(payload)
            .eq("id", editing)
            .eq("user_id", userId)
            .select("id")
            .single()
        : await supabase
            .from("student_exams")
            .insert(payload)
            .select("id")
            .single();

      if (result.error) throw result.error;

      setSuccess(
        editing
          ? "Examination updated successfully."
          : "Examination added successfully."
      );

      resetForm();
      await loadData(userId);

    } catch (err) {
      setError(
        err && typeof err === "object" && "message" in err
          ? String(err.message)
          : "Unable to save examination."
      );
    } finally {
      setBusy(false);
    }
  }

  function syllabusTopics(syllabus: string | null) {
    return Array.from(
      new Set(
        (syllabus ?? "")
          .split(/\r?\n/)
          .map(topic => topic.trim())
          .filter(Boolean)
      )
    );
  }

  async function toggleTopic(exam: Exam, topic: string) {
    if (!userId || busy || savingTopicExamId) return;

    const topics = syllabusTopics(exam.syllabus);

    if (!topics.includes(topic)) return;

    const current = (exam.completed_topics ?? []).filter(
      item => topics.includes(item)
    );

    const completed = current.includes(topic)
      ? current.filter(item => item !== topic)
      : [...current, topic];

    const nextStatus =
      completed.length === 0
        ? "not_started"
        : completed.length === topics.length
        ? "prepared"
        : "in_progress";

    setSavingTopicExamId(exam.id);
    setError("");
    setSuccess("");

    try {
      const result = await supabase
        .from("student_exams")
        .update({
          completed_topics: completed,
          preparation_status: nextStatus,
        })
        .eq("id", exam.id)
        .eq("user_id", userId)
        .select("id")
        .single();

      if (result.error) throw result.error;

      setExams(previous =>
        previous.map(item =>
          item.id === exam.id
            ? {
                ...item,
                completed_topics: completed,
                preparation_status: nextStatus,
              }
            : item
        )
      );

      setSuccess("Syllabus progress saved.");

    } catch (err) {
      setError(
        err && typeof err === "object" && "message" in err
          ? String(err.message)
          : "Unable to save syllabus progress."
      );
    } finally {
      setSavingTopicExamId(null);
    }
  }

  async function deleteExam(exam: Exam) {
    if (!userId || busy) return;

    if (!window.confirm(`Delete "${exam.title}" permanently?`)) {
      return;
    }

    setBusy(true);
    setError("");
    setSuccess("");

    try {
      const result = await supabase
        .from("student_exams")
        .delete()
        .eq("id", exam.id)
        .eq("user_id", userId)
        .select("id")
        .single();

      if (result.error) throw result.error;

      if (editing === exam.id) resetForm();

      setSuccess("Examination deleted.");
      await loadData(userId);

    } catch {
      setError("Unable to delete examination.");
    } finally {
      setBusy(false);
    }
  }

  const upcoming = exams.filter(
    exam =>
      exam.status === "upcoming" &&
      exam.exam_date >= today()
  );

  const prepared = upcoming.filter(
    exam => exam.preparation_status === "prepared"
  ).length;

  const completed = exams.filter(
    exam => exam.status === "completed"
  ).length;

  const overdue = exams.filter(
    exam =>
      exam.status === "upcoming" &&
      exam.exam_date < today()
  ).length;

  const nextExam = upcoming[0];

  const visibleExams = exams.filter(exam => {
    if (filter === "all") return true;

    if (filter === "upcoming") {
      return (
        exam.status === "upcoming" &&
        exam.exam_date >= today()
      );
    }

    if (filter === "past") {
      return (
        exam.status === "upcoming" &&
        exam.exam_date < today()
      );
    }

    return exam.status === filter;
  });

  function subjectName(id: string | null) {
    return subjects.find(s => s.id === id)?.name
      ?? "General examination";
  }

  const stats = [
    {
      title: "Upcoming exams",
      value: upcoming.length,
      icon: GraduationCap,
    },
    {
      title: "Next examination",
      value: nextExam
        ? daysRemaining(nextExam.exam_date) === 0
          ? "Today"
          : `${daysRemaining(nextExam.exam_date)} days`
        : "None",
      icon: CalendarDays,
    },
    {
      title: "Upcoming exams prepared",
      value: `${prepared}/${upcoming.length}`,
      icon: BookOpen,
    },
    {
      title: "Completed exams",
      value: completed,
      icon: ClipboardCheck,
    },
  ];

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6 p-4 sm:p-6 lg:p-8">

      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-indigo-100 p-3 text-indigo-600">
            <GraduationCap size={27} />
          </div>

          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              Exam Preparation
            </h1>

          <a
            href="/student/mock-tests"
            className="mt-3 inline-flex items-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            Take AI Mock Test
          </a>

            <p className="mt-1 text-sm text-slate-500">
              Plan, prepare and track your examinations.
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={refresh}
            disabled={loading || busy || !userId}
            className="rounded-lg border border-slate-200 bg-white p-3 disabled:opacity-50"
            aria-label="Refresh exams"
          >
            <RefreshCw size={18}
              className={loading ? "animate-spin" : ""}
            />
          </button>

          <button
            onClick={addExam}
            disabled={busy || !userId}
            className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            <Plus size={18} />
            Add Exam
          </button>
        </div>
      </header>

      {error && (
        <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {success && (
        <div role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">
          {success}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map(item => (
          <div key={item.title}
            className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <item.icon size={22}
              className="mb-3 text-indigo-600"
            />
            <p className="text-sm text-slate-500">
              {item.title}
            </p>
            <p className="mt-1 text-2xl font-bold text-slate-900">
              {loading ? "-" : item.value}
            </p>
          </div>
        ))}
      </div>

      {overdue > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          {overdue} examination(s) have passed but
          are still marked upcoming. Review their status.
        </div>
      )}

      {showForm && (
        <form
          onSubmit={saveExam}
          className="space-y-4 rounded-xl border border-indigo-200 bg-white p-5"
        >
          <h2 className="text-lg font-semibold">
            {editing ? "Edit examination" : "Add examination"}
          </h2>

          <div className="grid gap-4 md:grid-cols-2">

            <label className="space-y-1 text-sm">
              <span>Exam title *</span>
              <input required className={fieldClass}
                value={form.title}
                maxLength={200}
                onChange={e => updateField("title", e.target.value)}
                placeholder="Semester examination"
              />
            </label>

            <label className="space-y-1 text-sm">
              <span>Subject</span>
              <select className={fieldClass}
                value={form.subject_id}
                onChange={e => updateField("subject_id", e.target.value)}
              >
                <option value="">General examination</option>
                {subjects.map(subject => (
                  <option key={subject.id} value={subject.id}>
                    {subject.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1 text-sm">
              <span>Exam date *</span>
              <input required type="date" className={fieldClass}
                value={form.exam_date}
                onChange={e => updateField("exam_date", e.target.value)}
              />
            </label>

            <label className="space-y-1 text-sm">
              <span>Start time</span>
              <input type="time" className={fieldClass}
                value={form.start_time}
                onChange={e => updateField("start_time", e.target.value)}
              />
            </label>

            <label className="space-y-1 text-sm">
              <span>Duration (minutes)</span>
              <input type="number" min="1" step="1"
                className={fieldClass}
                value={form.duration_minutes}
                onChange={e => updateField("duration_minutes", e.target.value)}
                placeholder="180"
              />
            </label>

            <label className="space-y-1 text-sm">
              <span>Exam venue</span>
              <input className={fieldClass}
                value={form.venue}
                onChange={e => updateField("venue", e.target.value)}
                placeholder="Room or examination centre"
              />
            </label>

            <label className="space-y-1 text-sm">
              <span>Examination status</span>
              <select className={fieldClass}
                value={form.status}
                onChange={e => updateField("status", e.target.value)}
              >
                <option value="upcoming">Upcoming</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </label>

            <label className="space-y-1 text-sm">
              <span>Preparation status</span>
              <select className={fieldClass}
                value={form.preparation_status}
                onChange={e => updateField("preparation_status", e.target.value)}
              >
                <option value="not_started">Not started</option>
                <option value="in_progress">In progress</option>
                <option value="prepared">Prepared</option>
              </select>
            </label>

          </div>

          <label className="block space-y-1 text-sm">
            <span>Syllabus and topics</span>
            <textarea rows={5} className={fieldClass}
              value={form.syllabus}
              onChange={e => updateField("syllabus", e.target.value)}
              placeholder="Enter syllabus topics, one per line..."
            />
          </label>

          <div className="flex gap-3">
            <button type="submit" disabled={busy}
              className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy ? "Saving..." : "Save Exam"}
            </button>

            <button type="button" disabled={busy}
              onClick={resetForm}
              className="rounded-lg border border-slate-200 px-5 py-2.5 text-sm"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-900">
            Your Examinations
          </h2>

          <select
            aria-label="Filter examinations"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
          >
            <option value="all">All examinations</option>
            <option value="upcoming">Upcoming</option>
            <option value="past">Past date - status pending</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 p-5 text-slate-500">
            <Loader2 className="animate-spin" size={20} />
            Loading examinations...
          </div>
        ) : visibleExams.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
            <GraduationCap size={40}
              className="mx-auto mb-3 text-indigo-400"
            />
            <h3 className="font-semibold">No examinations found</h3>
            <p className="mt-2 text-sm text-slate-500">
              Add your examination schedule to start preparing.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {visibleExams.map(exam => {
              const days = daysRemaining(exam.exam_date);

              return (
                <article key={exam.id}
                  className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="break-words font-bold text-slate-900">
                        {exam.title}
                      </h3>
                      <p className="text-sm text-slate-500">
                        {subjectName(exam.subject_id)}
                      </p>
                    </div>

                    <span className={
                      "shrink-0 rounded-full px-3 py-1 text-xs font-medium " +
                      (exam.status === "completed"
                        ? "bg-emerald-100 text-emerald-700"
                        : exam.status === "cancelled"
                        ? "bg-slate-100 text-slate-600"
                        : days <= 3
                        ? "bg-amber-100 text-amber-800"
                        : "bg-indigo-100 text-indigo-700")
                    }>
                      {exam.status !== "upcoming"
                        ? exam.status
                        : days < 0
                        ? "Past date"
                        : days === 0
                        ? "Today"
                        : `${days} days left`}
                    </span>
                  </div>

                  <div className="space-y-2 text-sm text-slate-600">
                    <p className="flex items-center gap-2">
                      <CalendarDays size={16} />
                      {formatDate(exam.exam_date)}
                    </p>

                    {(exam.start_time || exam.duration_minutes) && (
                      <p className="flex items-center gap-2">
                        <Clock size={16} />
                        {exam.start_time?.slice(0, 5)}
                        {exam.start_time && exam.duration_minutes ? " | " : ""}
                        {exam.duration_minutes
                          ? `${exam.duration_minutes} minutes`
                          : ""}
                      </p>
                    )}

                    {exam.venue && (
                      <p className="flex items-center gap-2">
                        <MapPin size={16} />
                        {exam.venue}
                      </p>
                    )}
                  </div>

                  <div className="rounded-lg bg-slate-50 p-3">
                    <p className="text-xs font-medium text-slate-500">
                      Preparation status
                    </p>

                    <p className="mt-1 font-medium capitalize text-indigo-700">
                      {exam.preparation_status.replaceAll("_", " ")}
                    </p>
                  </div>

                  {exam.syllabus && (() => {
                    const topics = syllabusTopics(exam.syllabus);

                    const completed = (
                      exam.completed_topics ?? []
                    ).filter(topic => topics.includes(topic));

                    const percentage = topics.length
                      ? Math.round(
                          (completed.length / topics.length) * 100
                        )
                      : 0;

                    return (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-semibold">
                            Syllabus completion
                          </p>

                          <span className="font-semibold text-indigo-600">
                            {percentage}%
                          </span>
                        </div>

                        <div className="h-2.5 overflow-hidden rounded-full bg-slate-200">
                          <div
                            className="h-full rounded-full bg-indigo-600 transition-all"
                            style={{ width: `${percentage}%` }}
                          />
                        </div>

                        <p className="text-xs text-slate-500">
                          {completed.length} of {topics.length} topics completed
                        </p>

                        <div className="max-h-72 space-y-2 overflow-y-auto">
                          {topics.map(topic => {
                            const checked = completed.includes(topic);

                            return (
                              <label
                                key={topic}
                                className="flex cursor-pointer items-start gap-3 rounded-lg bg-slate-50 p-3 text-sm"
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={
                                    busy ||
                                    savingTopicExamId !== null
                                  }
                                  onChange={() => {
                                    void toggleTopic(exam, topic);
                                  }}
                                  className="mt-1 h-4 w-4 accent-indigo-600"
                                />

                                <span className={
                                  checked
                                    ? "text-slate-400 line-through"
                                    : "text-slate-700"
                                }>
                                  {topic}
                                </span>
                              </label>
                            );
                          })}
                        </div>

                        {savingTopicExamId === exam.id && (
                          <p className="text-xs text-indigo-600">
                            Saving syllabus progress...
                          </p>
                        )}
                      </div>
                    );
                  })()}

                  <div className="flex gap-2 border-t border-slate-100 pt-3">
                    <button onClick={() => editExam(exam)}
                      disabled={busy}
                      className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50"
                    >
                      <Pencil size={15} />
                      Edit
                    </button>

                    <button onClick={() => deleteExam(exam)}
                      disabled={busy}
                      className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                    >
                      <Trash2 size={15} />
                      Delete
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
          <BrainCircuit size={22} className="text-indigo-600" />
          AI Exam Preparation Tools
        </h2>

        <div className="grid gap-4 md:grid-cols-2">
          <Link href="/student/notes"
            className="rounded-xl border border-indigo-200 bg-white p-5 hover:border-indigo-500"
          >
            <BookOpen className="mb-3 text-indigo-600" />
            <h3 className="font-semibold">Important Questions and Revision</h3>
            <p className="mt-1 text-sm text-slate-500">
              Generate exam questions, model answers, MCQs and
              revision materials from your uploaded documents.
            </p>
          </Link>

          <Link href="/student/ai-tutor"
            className="rounded-xl border border-indigo-200 bg-white p-5 hover:border-indigo-500"
          >
            <BrainCircuit className="mb-3 text-indigo-600" />
            <h3 className="font-semibold">AI Exam Tutor</h3>
            <p className="mt-1 text-sm text-slate-500">
              Understand difficult topics, solve doubts
              and practise exam-oriented questions.
            </p>
          </Link>
        </div>
      </section>

    </div>
  );
}