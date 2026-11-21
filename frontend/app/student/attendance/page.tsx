"use client";

import { useEffect, useState } from "react";
import {
  BarChart3, CalendarCheck, GraduationCap,
  Plus, Trash2, Pencil, Loader2, AlertTriangle,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { createClient } from "@/lib/supabase/client";

type Subject = {
  id: string;
  name: string;
};

type Attendance = {
  id: string;
  subject_id: string;
  attendance_date: string;
  total_classes: number;
  attended_classes: number;
  remarks: string | null;
};

type Mark = {
  id: string;
  subject_id: string;
  exam_name: string;
  exam_type: string;
  marks_obtained: number;
  maximum_marks: number;
  exam_date: string;
  remarks: string | null;
};

const field =
  "w-full rounded-lg border border-slate-200 bg-white p-2.5 text-sm";

const primary =
  "rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50";

function today() {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

function percentage(a: number, b: number) {
  return b > 0 ? (a / b) * 100 : null;
}

function display(value: number | null) {
  return value === null ? "No data" : `${value.toFixed(1)}%`;
}

function requiredClasses(
  attended: number,
  total: number,
  target: number
) {
  return Math.max(
    0,
    Math.ceil(
      (target * total - 100 * attended) / (100 - target)
    )
  );
}

function safeAbsences(
  attended: number,
  total: number,
  target: number
) {
  return Math.max(
    0,
    Math.floor((100 * attended - target * total) / target)
  );
}

export default function AttendanceMarksPage() {
  const [supabase] = useState(() => createClient());

  const [userId, setUserId] = useState("");
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [marks, setMarks] = useState<Mark[]>([]);

  const [tab, setTab] =
    useState<"attendance" | "marks">("attendance");

  const [target, setTarget] = useState(75);
  const [filter, setFilter] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [date, setDate] = useState(today);
  const [total, setTotal] = useState("1");
  const [attended, setAttended] = useState("1");
  const [examName, setExamName] = useState("");
  const [examType, setExamType] = useState("internal");
  const [obtained, setObtained] = useState("");
  const [maximum, setMaximum] = useState("50");
  const [remarks, setRemarks] = useState("");
  const [editing, setEditing] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  function errorText(err: unknown) {
    if (err && typeof err === "object" && "message" in err) {
      return String(err.message);
    }
    return "Unable to complete the request.";
  }

  async function loadData(uid: string) {
    const [s, a, m] = await Promise.all([
      supabase.from("student_subjects")
        .select("id,name").eq("user_id", uid).order("name"),

      supabase.from("student_attendance")
        .select("*").eq("user_id", uid)
        .order("attendance_date", { ascending: false }),

      supabase.from("student_marks")
        .select("*").eq("user_id", uid)
        .order("exam_date", { ascending: false }),
    ]);

    if (s.error) throw s.error;
    if (a.error) throw a.error;
    if (m.error) throw m.error;

    setSubjects(s.data || []);
    setAttendance(a.data || []);
    setMarks(m.data || []);
  }

  useEffect(() => {
    async function initialize() {
      try {
        const { data, error } = await supabase.auth.getUser();

        if (error || !data.user) {
          window.location.href = "/";
          return;
        }

        setUserId(data.user.id);

        const saved = Number(
          localStorage.getItem(
            `attendance-target-${data.user.id}`
          ) || "75"
        );

        if (saved >= 50 && saved <= 95) {
          setTarget(saved);
        }

        await loadData(data.user.id);
      } catch (err) {
        setError(errorText(err));
      } finally {
        setLoading(false);
      }
    }

    void initialize();
  }, [supabase]);

  function changeTarget(value: number) {
    setTarget(value);

    if (userId) {
      localStorage.setItem(
        `attendance-target-${userId}`,
        String(value)
      );
    }
  }

  function subjectName(id: string) {
    return subjects.find(s => s.id === id)?.name || "Unknown subject";
  }

  function resetForm() {
    setEditing(null);
    setSubjectId("");
    setDate(today());
    setTotal("1");
    setAttended("1");
    setExamName("");
    setExamType("internal");
    setObtained("");
    setMaximum("50");
    setRemarks("");
  }

  function changeTab(value: "attendance" | "marks") {
    setTab(value);
    setError("");
    setSuccess("");
    resetForm();
  }

  async function saveRecord() {
    if (busy || !userId) return;

    setError("");
    setSuccess("");

    if (!subjectId || !date) {
      setError("Select a subject and date.");
      return;
    }

    let payload: Record<string, unknown>;
    let table: string;

    if (tab === "attendance") {
      const t = Number(total);
      const a = Number(attended);

      if (
        total.trim() === "" ||
        attended.trim() === "" ||
        !Number.isInteger(t) ||
        !Number.isInteger(a) ||
        t <= 0 || a < 0 || a > t
      ) {
        setError("Enter valid total and attended class counts.");
        return;
      }

      if (date > today()) {
        setError("Attendance cannot be recorded for a future date.");
        return;
      }

      table = "student_attendance";

      payload = {
        user_id: userId,
        subject_id: subjectId,
        attendance_date: date,
        total_classes: t,
        attended_classes: a,
        remarks: remarks.trim() || null,
      };

    } else {
      const o = Number(obtained);
      const m = Number(maximum);

      if (
        !examName.trim() ||
        obtained.trim() === "" ||
        maximum.trim() === "" ||
        !Number.isFinite(o) ||
        !Number.isFinite(m) ||
        o < 0 || m <= 0 || o > m
      ) {
        setError("Enter a valid exam name and marks.");
        return;
      }

      table = "student_marks";

      payload = {
        user_id: userId,
        subject_id: subjectId,
        exam_name: examName.trim(),
        exam_type: examType,
        exam_date: date,
        marks_obtained: o,
        maximum_marks: m,
        remarks: remarks.trim() || null,
      };
    }

    setBusy(true);

    try {
      const result = editing
        ? await supabase.from(table)
            .update(payload)
            .eq("id", editing)
            .eq("user_id", userId)
            .select("id")
            .single()
        : await supabase.from(table)
            .insert(payload)
            .select("id")
            .single();

      if (result.error) {
        if (result.error.code === "23505") {
          throw new Error(
            "Attendance already exists for this subject and date. Edit the existing record."
          );
        }

        throw result.error;
      }

      setSuccess(editing ? "Record updated." : "Record added.");
      resetForm();
      await loadData(userId);

    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function deleteRecord(
    table: "student_attendance" | "student_marks",
    id: string
  ) {
    if (busy || !window.confirm("Permanently delete this record?")) {
      return;
    }

    setBusy(true);
    setError("");
    setSuccess("");

    try {
      const result = await supabase.from(table)
        .delete()
        .eq("id", id)
        .eq("user_id", userId)
        .select("id")
        .single();

      if (result.error) throw result.error;

      if (editing === id) resetForm();

      setSuccess("Record deleted.");
      await loadData(userId);

    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  function editAttendance(record: Attendance) {
    setEditing(record.id);
    setSubjectId(record.subject_id);
    setDate(record.attendance_date);
    setTotal(String(record.total_classes));
    setAttended(String(record.attended_classes));
    setRemarks(record.remarks || "");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function editMark(record: Mark) {
    setEditing(record.id);
    setSubjectId(record.subject_id);
    setDate(record.exam_date);
    setExamName(record.exam_name);
    setExamType(record.exam_type);
    setObtained(String(record.marks_obtained));
    setMaximum(String(record.maximum_marks));
    setRemarks(record.remarks || "");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const totalClasses = attendance.reduce(
    (sum, row) => sum + Number(row.total_classes), 0
  );

  const attendedClasses = attendance.reduce(
    (sum, row) => sum + Number(row.attended_classes), 0
  );

  const totalMarks = marks.reduce(
    (sum, row) => sum + Number(row.marks_obtained), 0
  );

  const maximumMarks = marks.reduce(
    (sum, row) => sum + Number(row.maximum_marks), 0
  );

  const stats = subjects.map(subject => {
    const a = attendance.filter(
      row => row.subject_id === subject.id
    );

    const m = marks.filter(
      row => row.subject_id === subject.id
    );

    const t = a.reduce(
      (sum, row) => sum + Number(row.total_classes), 0
    );

    const p = a.reduce(
      (sum, row) => sum + Number(row.attended_classes), 0
    );

    const scored = m.reduce(
      (sum, row) => sum + Number(row.marks_obtained), 0
    );

    const max = m.reduce(
      (sum, row) => sum + Number(row.maximum_marks), 0
    );

    return {
      id: subject.id,
      name: subject.name,
      total: t,
      attended: p,
      attendance: percentage(p, t),
      marks: percentage(scored, max),
      required: requiredClasses(p, t, target),
      safe: safeAbsences(p, t, target),
    };
  });

  const shortage = stats.filter(
    s => s.attendance !== null && s.attendance < target
  );

  const chartData = stats.filter(
    s => s.attendance !== null || s.marks !== null
  );

  const filteredAttendance = attendance.filter(
    row => !filter || row.subject_id === filter
  );

  const filteredMarks = marks.filter(
    row => !filter || row.subject_id === filter
  );

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="mr-2 h-6 w-6 animate-spin text-indigo-600" />
        Loading academic records...
      </div>
    );
  }

  return (
    <div className="space-y-5 p-4 text-slate-800 md:p-6">

      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-bold">
            <BarChart3 className="h-8 w-8 text-indigo-600" />
            Attendance & Marks
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Track attendance and monitor academic performance.
          </p>
        </div>

        <label className="flex items-center gap-3 text-sm">
          Attendance target
          <select
            className={field}
            value={target}
            onChange={e => changeTarget(Number(e.target.value))}
          >
            {Array.from({ length: 46 }, (_, i) => i + 50).map(n => (
              <option key={n} value={n}>{n}%</option>
            ))}
          </select>
        </label>
      </header>

      {error && (
        <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {success && (
        <div role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-700">
          {success}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: "Overall attendance",
            value: display(percentage(attendedClasses, totalClasses)),
          },
          {
            label: "Overall marks",
            value: display(percentage(totalMarks, maximumMarks)),
          },
          {
            label: "Classes attended",
            value: `${attendedClasses} / ${totalClasses}`,
          },
          {
            label: "Subjects below target",
            value: String(shortage.length),
          },
        ].map(card => (
          <div key={card.label} className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-sm text-slate-500">{card.label}</p>
            <p className="mt-2 text-2xl font-bold text-indigo-600">
              {card.value}
            </p>
          </div>
        ))}
      </div>

      {shortage.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <h2 className="flex items-center gap-2 font-semibold text-amber-800">
            <AlertTriangle className="h-5 w-5" />
            Attendance shortage
          </h2>
          {shortage.map(s => (
            <p key={s.id} className="mt-2 text-sm text-amber-800">
              {s.name}: {display(s.attendance)}.
              Attend the next {s.required} consecutive classes
              to reach {target}%.
            </p>
          ))}
        </div>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-4 font-semibold">
          Subject-wise academic performance
        </h2>

        {chartData.length > 0 ? (
          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 100]} unit="%" />
                <Tooltip />
                <Legend />
                <Bar dataKey="attendance" name="Attendance %" fill="#4f46e5" radius={[5, 5, 0, 0]} />
                <Bar dataKey="marks" name="Marks %" fill="#14b8a6" radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="py-10 text-center text-sm text-slate-400">
            Add attendance or marks to view performance charts.
          </p>
        )}
      </section>

      <div className="flex gap-2">
        <button
          disabled={busy}
          onClick={() => changeTab("attendance")}
          className={`flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold ${
            tab === "attendance"
              ? "bg-indigo-600 text-white"
              : "border bg-white"
          }`}
        >
          <CalendarCheck className="h-4 w-4" />
          Attendance
        </button>

        <button
          disabled={busy}
          onClick={() => changeTab("marks")}
          className={`flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold ${
            tab === "marks"
              ? "bg-indigo-600 text-white"
              : "border bg-white"
          }`}
        >
          <GraduationCap className="h-4 w-4" />
          Marks
        </button>
      </div>

      <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">

        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">
            {editing ? "Edit" : "Add"} {tab === "attendance" ? "attendance" : "marks"}
          </h2>

          {subjects.length === 0 && (
            <p className="text-sm text-amber-700">
              Add subjects in the Subjects module first.
            </p>
          )}

          <label className="block space-y-1 text-sm">
            <span>Subject</span>
            <select
              className={field}
              value={subjectId}
              onChange={e => setSubjectId(e.target.value)}
            >
              <option value="">Select subject</option>
              {subjects.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>

          <label className="block space-y-1 text-sm">
            <span>Date</span>
            <input
              type="date"
              className={field}
              value={date}
              onChange={e => setDate(e.target.value)}
            />
          </label>

          {tab === "attendance" ? (
            <>
              <label className="block space-y-1 text-sm">
                <span>Total classes</span>
                <input type="number" min="1" className={field}
                  value={total} onChange={e => setTotal(e.target.value)} />
              </label>

              <label className="block space-y-1 text-sm">
                <span>Attended classes</span>
                <input type="number" min="0" max={total} className={field}
                  value={attended} onChange={e => setAttended(e.target.value)} />
              </label>
            </>
          ) : (
            <>
              <label className="block space-y-1 text-sm">
                <span>Exam name</span>
                <input className={field} value={examName}
                  maxLength={150}
                  onChange={e => setExamName(e.target.value)}
                  placeholder="Internal Assessment 1" />
              </label>

              <label className="block space-y-1 text-sm">
                <span>Exam type</span>
                <select className={field} value={examType}
                  onChange={e => setExamType(e.target.value)}>
                  {["internal", "external", "assignment", "practical", "quiz", "other"].map(type => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              </label>

              <label className="block space-y-1 text-sm">
                <span>Marks obtained</span>
                <input type="number" min="0" step="0.01"
                  className={field} value={obtained}
                  onChange={e => setObtained(e.target.value)} />
              </label>

              <label className="block space-y-1 text-sm">
                <span>Maximum marks</span>
                <input type="number" min="0.01" step="0.01"
                  className={field} value={maximum}
                  onChange={e => setMaximum(e.target.value)} />
              </label>
            </>
          )}

          <label className="block space-y-1 text-sm">
            <span>Remarks (optional)</span>
            <textarea className={field} rows={3}
              maxLength={1000} value={remarks}
              onChange={e => setRemarks(e.target.value)} />
          </label>

          <button
            disabled={busy || subjects.length === 0}
            onClick={() => void saveRecord()}
            className={`${primary} flex w-full items-center justify-center gap-2`}
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            {editing ? "Update record" : "Save record"}
          </button>

          {editing && (
            <button disabled={busy} onClick={resetForm}
              className="w-full rounded-lg border p-2 text-sm">
              Cancel editing
            </button>
          )}
        </section>

        <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold">
              {tab === "attendance" ? "Attendance history" : "Marks history"}
            </h2>

            <select className="rounded-lg border border-slate-200 p-2 text-sm"
              value={filter} onChange={e => setFilter(e.target.value)}>
              <option value="">All subjects</option>
              {subjects.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full whitespace-nowrap text-left text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="p-3">Subject</th>
                  <th className="p-3">Date</th>
                  {tab === "marks" && <th className="p-3">Exam</th>}
                  <th className="p-3">Score</th>
                  <th className="p-3">Percentage</th>
                  <th className="p-3">Actions</th>
                </tr>
              </thead>

              <tbody>
                {tab === "attendance" ? (
                  filteredAttendance.map(row => (
                    <tr key={row.id} className="border-b border-slate-100">
                      <td className="p-3">{subjectName(row.subject_id)}</td>
                      <td className="p-3">{row.attendance_date}</td>
                      <td className="p-3">
                        {row.attended_classes}/{row.total_classes}
                      </td>
                      <td className="p-3 font-semibold">
                        {display(percentage(row.attended_classes, row.total_classes))}
                      </td>
                      <td className="p-3">
                        <div className="flex gap-3">
                          <button title="Edit attendance" disabled={busy}
                            onClick={() => editAttendance(row)}>
                            <Pencil className="h-4 w-4 text-indigo-600" />
                          </button>
                          <button title="Delete attendance" disabled={busy}
                            onClick={() => void deleteRecord("student_attendance", row.id)}>
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  filteredMarks.map(row => (
                    <tr key={row.id} className="border-b border-slate-100">
                      <td className="p-3">{subjectName(row.subject_id)}</td>
                      <td className="p-3">{row.exam_date}</td>
                      <td className="p-3">{row.exam_name}</td>
                      <td className="p-3">{row.marks_obtained}/{row.maximum_marks}</td>
                      <td className="p-3 font-semibold">
                        {display(percentage(row.marks_obtained, row.maximum_marks))}
                      </td>
                      <td className="p-3">
                        <div className="flex gap-3">
                          <button title="Edit marks" disabled={busy}
                            onClick={() => editMark(row)}>
                            <Pencil className="h-4 w-4 text-indigo-600" />
                          </button>
                          <button title="Delete marks" disabled={busy}
                            onClick={() => void deleteRecord("student_marks", row.id)}>
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            {(tab === "attendance"
              ? filteredAttendance.length
              : filteredMarks.length) === 0 && (
              <p className="py-10 text-center text-sm text-slate-400">
                No records available.
              </p>
            )}
          </div>
        </section>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-4 font-semibold">
          Subject-wise attendance planning
        </h2>

        <div className="overflow-x-auto">
          <table className="w-full whitespace-nowrap text-left text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                {["Subject", "Attended", "Attendance", "Marks", "Classes required", "Safe absences"].map(h => (
                  <th key={h} className="p-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stats.map(s => (
                <tr key={s.id} className="border-b border-slate-100">
                  <td className="p-3 font-medium">{s.name}</td>
                  <td className="p-3">{s.attended}/{s.total}</td>
                  <td className={`p-3 font-semibold ${
                    s.attendance === null
                      ? "text-slate-400"
                      : s.attendance >= target
                        ? "text-green-600"
                        : "text-red-600"
                  }`}>
                    {display(s.attendance)}
                  </td>
                  <td className="p-3">{display(s.marks)}</td>
                  <td className="p-3">{s.total ? s.required : "-"}</td>
                  <td className="p-3">{s.total ? s.safe : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-3 text-xs text-slate-500">
          Required classes assume consecutive attendance.
          Safe absences are mathematical estimates, not permission
          to miss classes. Overall marks use total obtained marks
          divided by total maximum marks.
        </p>
      </section>
    </div>
  );
}