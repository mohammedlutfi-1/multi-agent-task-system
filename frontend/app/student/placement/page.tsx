"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type ApplicationStatus =
  | "interested"
  | "applied"
  | "assessment"
  | "interview"
  | "offered"
  | "rejected";

type Placement = {
  id: string;
  user_id: string;
  company_name: string;
  role_title: string;
  application_status: ApplicationStatus;
  application_date: string | null;
  interview_date: string | null;
  job_url: string | null;
  notes: string | null;
  aptitude_progress: number;
  technical_progress: number;
  interview_progress: number;
};

type PlacementForm = {
  company_name: string;
  role_title: string;
  application_status: ApplicationStatus;
  application_date: string;
  interview_date: string;
  job_url: string;
  notes: string;
  aptitude_progress: number;
  technical_progress: number;
  interview_progress: number;
};

function emptyForm(): PlacementForm {
  return {
    company_name: "",
    role_title: "",
    application_status: "interested",
    application_date: "",
    interview_date: "",
    job_url: "",
    notes: "",
    aptitude_progress: 0,
    technical_progress: 0,
    interview_progress: 0,
  };
}

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";

const primaryButton =
  "rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50";

const statuses: { value: ApplicationStatus; label: string }[] = [
  { value: "interested", label: "Interested" },
  { value: "applied", label: "Applied" },
  { value: "assessment", label: "Assessment" },
  { value: "interview", label: "Interview" },
  { value: "offered", label: "Offered" },
  { value: "rejected", label: "Rejected" },
];

function formatDate(value: string | null): string {
  if (!value) return "Not set";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString();
}

function safeUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function ProgressBar({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm">
        <span className="text-slate-600">{label}</span>
        <span className="font-medium">{value}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-indigo-600"
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}

export default function StudentPlacementPage() {
  const [supabase] = useState(() => createClient());
  const [userId, setUserId] = useState("");
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [form, setForm] = useState<PlacementForm>(emptyForm);
  const [editing, setEditing] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadPlacements = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const { data: auth, error: authError } =
        await supabase.auth.getUser();

      if (authError || !auth.user) {
        throw new Error("Please sign in again.");
      }

      setUserId(auth.user.id);

      const { data, error: dbError } = await supabase
        .from("student_placements")
        .select("*")
        .eq("user_id", auth.user.id)
        .order("created_at", { ascending: false });

      if (dbError) throw dbError;

      setPlacements((data ?? []) as Placement[]);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to load placements."
      );
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void loadPlacements();
  }, [loadPlacements]);

  function updateField<K extends keyof PlacementForm>(
    field: K,
    value: PlacementForm[K]
  ) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function startNew() {
    setForm(emptyForm());
    setEditing(null);
    setShowForm(true);
    setError("");
    setNotice("");
  }

  function startEdit(placement: Placement) {
    setEditing(placement.id);
    setForm({
      company_name: placement.company_name,
      role_title: placement.role_title,
      application_status: placement.application_status,
      application_date: placement.application_date ?? "",
      interview_date: placement.interview_date ?? "",
      job_url: placement.job_url ?? "",
      notes: placement.notes ?? "",
      aptitude_progress: placement.aptitude_progress,
      technical_progress: placement.technical_progress,
      interview_progress: placement.interview_progress,
    });
    setShowForm(true);
    setError("");
    setNotice("");
  }

  async function savePlacement(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !userId) return;

    setError("");
    setNotice("");

    if (!form.company_name.trim() || !form.role_title.trim()) {
      setError("Company name and job role are required.");
      return;
    }

    const jobUrl = form.job_url.trim();

    if (jobUrl && !safeUrl(jobUrl)) {
      setError("Job URL must be a valid HTTPS link.");
      return;
    }

    const payload = {
      user_id: userId,
      company_name: form.company_name.trim(),
      role_title: form.role_title.trim(),
      application_status: form.application_status,
      application_date: form.application_date || null,
      interview_date: form.interview_date || null,
      job_url: jobUrl || null,
      notes: form.notes.trim() || null,
      aptitude_progress: form.aptitude_progress,
      technical_progress: form.technical_progress,
      interview_progress: form.interview_progress,
      updated_at: new Date().toISOString(),
    };

    setBusy(true);

    try {
      const query = editing
        ? supabase
            .from("student_placements")
            .update(payload)
            .eq("id", editing)
            .eq("user_id", userId)
        : supabase
            .from("student_placements")
            .insert(payload);

      const { error: dbError } = await query.select("id").single();

      if (dbError) throw dbError;

      setShowForm(false);
      setEditing(null);
      setForm(emptyForm());
      await loadPlacements();
      setNotice("Placement record saved successfully.");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to save placement record."
      );
    } finally {
      setBusy(false);
    }
  }

  async function deletePlacement(placement: Placement) {
    if (busy || !userId) return;

    if (
      !window.confirm(
        `Delete the application for "${placement.company_name}"?`
      )
    ) {
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");

    try {
      const { error: dbError } = await supabase
        .from("student_placements")
        .delete()
        .eq("id", placement.id)
        .eq("user_id", userId);

      if (dbError) throw dbError;

      await loadPlacements();
      setNotice("Placement record deleted.");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to delete placement record."
      );
    } finally {
      setBusy(false);
    }
  }

  const applied = placements.filter(
    (item) => item.application_status === "applied"
  ).length;

  const interviews = placements.filter(
    (item) =>
      item.application_status === "interview" ||
      item.application_status === "assessment"
  ).length;

  const offers = placements.filter(
    (item) => item.application_status === "offered"
  ).length;

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6">
      {/* Step 635B.11: Aptitude Preparation */}
      <a
        href="/student/placement/aptitude"
        className="mb-6 block rounded-xl border border-indigo-200 bg-indigo-50 p-5 transition hover:border-indigo-400 hover:bg-indigo-100"
      >
        <h2 className="text-lg font-semibold text-indigo-900">
          Aptitude Preparation
        </h2>
        <p className="mt-2 text-sm text-slate-700">
          Practice quantitative aptitude, logical reasoning and verbal
          ability with timed MCQs, difficulty levels, scores and solutions.
        </p>
        <span className="mt-3 inline-block font-medium text-indigo-700">
          Start Practicing ?
        </span>
      </a>

      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Placement Preparation
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Track applications, interviews, and preparation progress.
          </p>
        </div>
        <button
          type="button"
          onClick={startNew}
          className={primaryButton}
        >
          + Add Application
        </button>
      </header>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {notice && (
        <div
          role="status"
          className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700"
        >
          {notice}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-4">
        {[
          { label: "Total Applications", value: placements.length },
          { label: "Applied", value: applied },
          { label: "Assessment / Interview", value: interviews },
          { label: "Offers", value: offers },
        ].map((item) => (
          <div
            key={item.label}
            className="rounded-xl border border-slate-200 bg-white p-5"
          >
            <p className="text-sm text-slate-500">{item.label}</p>
            <p className="mt-2 text-2xl font-bold">{item.value}</p>
          </div>
        ))}
      </div>

      {showForm && (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-4 text-lg font-semibold">
            {editing ? "Edit Application" : "Add Application"}
          </h2>

          <form onSubmit={savePlacement} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-1 text-sm">
                <span>Company name *</span>
                <input
                  required
                  maxLength={200}
                  value={form.company_name}
                  onChange={(event) =>
                    updateField("company_name", event.target.value)
                  }
                  className={inputClass}
                />
              </label>

              <label className="block space-y-1 text-sm">
                <span>Job role *</span>
                <input
                  required
                  maxLength={200}
                  value={form.role_title}
                  onChange={(event) =>
                    updateField("role_title", event.target.value)
                  }
                  className={inputClass}
                />
              </label>

              <label className="block space-y-1 text-sm">
                <span>Application status</span>
                <select
                  value={form.application_status}
                  onChange={(event) =>
                    updateField(
                      "application_status",
                      event.target.value as ApplicationStatus
                    )
                  }
                  className={inputClass}
                >
                  {statuses.map((status) => (
                    <option key={status.value} value={status.value}>
                      {status.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block space-y-1 text-sm">
                <span>Application date</span>
                <input
                  type="date"
                  value={form.application_date}
                  onChange={(event) =>
                    updateField("application_date", event.target.value)
                  }
                  className={inputClass}
                />
              </label>

              <label className="block space-y-1 text-sm">
                <span>Interview date</span>
                <input
                  type="date"
                  value={form.interview_date}
                  onChange={(event) =>
                    updateField("interview_date", event.target.value)
                  }
                  className={inputClass}
                />
              </label>

              <label className="block space-y-1 text-sm">
                <span>Job URL (HTTPS)</span>
                <input
                  type="url"
                  value={form.job_url}
                  onChange={(event) =>
                    updateField("job_url", event.target.value)
                  }
                  placeholder="https://..."
                  className={inputClass}
                />
              </label>
            </div>

            {(
              [
                ["aptitude_progress", "Aptitude"],
                ["technical_progress", "Technical"],
                ["interview_progress", "Interview"],
              ] as const
            ).map(([field, label]) => (
              <label key={field} className="block space-y-2 text-sm">
                <span>
                  {label} preparation: {form[field]}%
                </span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={form[field]}
                  onChange={(event) =>
                    updateField(field, Number(event.target.value))
                  }
                  className="w-full"
                />
              </label>
            ))}

            <label className="block space-y-1 text-sm">
              <span>Notes</span>
              <textarea
                value={form.notes}
                onChange={(event) =>
                  updateField("notes", event.target.value)
                }
                rows={3}
                className={inputClass}
              />
            </label>

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={busy}
                className={primaryButton}
              >
                {busy ? "Saving..." : "Save Application"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setShowForm(false)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm"
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading applications...</p>
      ) : placements.length === 0 ? (
        <section className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <p className="font-medium">No applications yet</p>
          <p className="mt-2 text-sm text-slate-500">
            Add a company to start tracking placement preparation.
          </p>
        </section>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {placements.map((placement) => {
            const jobUrl = safeUrl(placement.job_url);
            const statusLabel =
              statuses.find(
                (item) => item.value === placement.application_status
              )?.label ?? placement.application_status;

            return (
              <article
                key={placement.id}
                className="space-y-4 rounded-xl border border-slate-200 bg-white p-5"
              >
                <div>
                  <h2 className="text-lg font-semibold">
                    {placement.company_name}
                  </h2>
                  <p className="text-sm text-slate-600">
                    {placement.role_title}
                  </p>
                  <span className="mt-2 inline-block rounded-full bg-indigo-50 px-3 py-1 text-xs text-indigo-700">
                    {statusLabel}
                  </span>
                </div>

                <div className="grid gap-2 text-xs text-slate-500 sm:grid-cols-2">
                  <p>
                    Applied: {formatDate(placement.application_date)}
                  </p>
                  <p>
                    Interview: {formatDate(placement.interview_date)}
                  </p>
                </div>

                <div className="space-y-3">
                  <ProgressBar
                    label="Aptitude"
                    value={placement.aptitude_progress}
                  />
                  <ProgressBar
                    label="Technical"
                    value={placement.technical_progress}
                  />
                  <ProgressBar
                    label="Interview"
                    value={placement.interview_progress}
                  />
                </div>

                {placement.notes && (
                  <p className="whitespace-pre-wrap text-sm text-slate-600">
                    {placement.notes}
                  </p>
                )}

                {jobUrl && (
                  <a
                    href={jobUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block text-sm text-indigo-700 underline"
                  >
                    View Job Posting
                  </a>
                )}

                <div className="flex gap-3 border-t border-slate-100 pt-3">
                  <button
                    type="button"
                    onClick={() => startEdit(placement)}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => deletePlacement(placement)}
                    className="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-700 disabled:opacity-50"
                  >
                    Delete
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </main>
  );
}
