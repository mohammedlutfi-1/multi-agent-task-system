"use client";

import { useEffect, useState } from "react";
import {
  BrainCircuit,
  RefreshCw,
  Loader2,
  AlertTriangle,
  TrendingUp,
  BookOpen,
  ClipboardList,
  CalendarCheck,
  MessageSquare,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import AIResponse from "@/components/AIResponse";

type Activity = {
  total: number;
  statuses: Record<string, number>;
  overdue: number;
};

type SubjectProgress = {
  subject: string;
  study_sessions_completed: number;
  tutor_questions: number;
  assignments_completed: number;
  assignments_total: number;
  notes_count: number;
  documents_count: number;
};

type Progress = {
  subjects_count: number;
  subject_performance: SubjectProgress[];
  study_planner: Activity;
  assignments: Activity;
  ai_tutor: {
    conversations: number;
    questions_asked: number;
  };
  resources: {
    notes: number;
    documents: number;
  };
  exams: {
    upcoming: unknown[];
  };
  projects: Record<string, number>;
  placement: Record<string, number>;
  has_activity: boolean;
};

type AnalysisResult = {
  analysis: string;
  provider: string;
  model: string;
  calls_remaining: number;
  daily_limit: number;
  progress: Progress;
};

function localDate() {
  const d = new Date();

  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}


export default function StudentProgressTracker() {
  const [supabase] = useState(() => createClient());

  const [progress, setProgress] =
    useState<Progress | null>(null);

  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [consent, setConsent] = useState(false);

  const [report, setReport] =
    useState<AnalysisResult | null>(null);

  async function request(
    path: string,
    body?: Record<string, unknown>
  ) {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      throw new Error("Please sign in again.");
    }

    const base = (
      process.env.NEXT_PUBLIC_API_URL ||
      "http://localhost:8000"
    ).replace(/\/+$/, "");

    const response = await fetch(`${base}${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        ...(body
          ? { "Content-Type": "application/json" }
          : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(
        body ? 240000 : 60000
      ),
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(
        typeof result.detail === "string"
          ? result.detail
          : "Unable to retrieve student progress."
      );
    }

    return result;
  }

  async function loadProgress() {
    setLoading(true);
    setError("");
    setReport(null);
    setProgress(null);

    try {
      const result = await request(
        `/student/ai/progress?local_date=${localDate()}`
      );

      setProgress(result);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to load academic progress."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadProgress();
  }, []);

  async function generateAnalysis() {
    if (
      !consent ||
      generating ||
      !progress?.has_activity
    ) {
      return;
    }

    setGenerating(true);
    setError("");
    setReport(null);

    try {
      const result = await request(
        "/student/ai/progress/analyze",
        {
          local_date: localDate(),
          accept_ai_processing: true,
          use_personal_keys: false,
          accept_provider_charges: false,
        }
      );

      setReport(result);
      setProgress(result.progress);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to generate AI recommendations."
      );
    } finally {
      setGenerating(false);
    }
  }

  const stats = progress
    ? [
        {
          title: "Completed study sessions",
          value: `${progress.study_planner.statuses.completed ?? 0}/${progress.study_planner.total}`,
          icon: BookOpen,
        },
        {
          title: "Assignments completed",
          value: `${(progress.assignments.statuses.completed ?? 0) + (progress.assignments.statuses.submitted ?? 0)}/${progress.assignments.total}`,
          icon: ClipboardList,
        },
        {
          title: "AI Tutor questions",
          value: progress.ai_tutor.questions_asked,
          icon: MessageSquare,
        },
        {
          title: "Study resources",
          value: progress.resources.notes + progress.resources.documents,
          icon: BookOpen,
        },
        {
          title: "Upcoming exams",
          value: progress.exams.upcoming.length,
          icon: CalendarCheck,
        },
        {
          title: "Active projects",
          value: (progress.projects.planning ?? 0) +
                 (progress.projects.in_progress ?? 0),
          icon: TrendingUp,
        },
      ]
    : [];

  return (
    <section className="space-y-5 rounded-2xl border border-indigo-200 bg-white p-5 shadow-sm">

      <div className="flex flex-wrap items-start justify-between gap-3">

        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-indigo-100 p-3 text-indigo-600">
            <BrainCircuit size={25} />
          </div>

          <div>
            <h2 className="text-xl font-bold text-slate-900">
              AI Student Progress Tracker
            </h2>

            <p className="mt-1 text-sm text-slate-500">
              Understand your academic progress and
              discover personalised improvement priorities.
            </p>
          </div>
        </div>

        <button
          type="button"
          disabled={loading || generating}
          onClick={() => loadProgress()}
          className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw
            size={15}
            className={loading ? "animate-spin" : ""}
          />
          Refresh progress
        </button>
      </div>

      {error && (
        <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 py-5 text-sm text-slate-500">
          <Loader2 size={18} className="animate-spin" />
          Collecting your academic progress...
        </div>
      )}

      {progress && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">

            {stats.map((item) => (
              <div
                key={item.title}
                className="rounded-xl border border-slate-200 bg-slate-50 p-4"
              >
                <item.icon
                  size={19}
                  className="mb-2 text-indigo-600"
                />

                <p className="text-sm text-slate-500">
                  {item.title}
                </p>

                <p className="mt-1 text-2xl font-bold text-slate-900">
                  {item.value}
                </p>
              </div>
            ))}

          </div>

          {(
            progress.assignments.overdue > 0 ||
            progress.study_planner.overdue > 0
          ) && (
            <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-4">

              <h3 className="flex items-center gap-2 font-semibold text-amber-800">
                <AlertTriangle size={18} />
                Academic priorities
              </h3>



              {progress.assignments.overdue > 0 && (
                <p className="text-sm text-amber-800">
                  {progress.assignments.overdue}
                  {" "}overdue assignment(s) require attention.
                </p>
              )}

              {progress.study_planner.overdue > 0 && (
                <p className="text-sm text-amber-800">
                  {progress.study_planner.overdue}
                  {" "}overdue study session(s) remain incomplete.
                </p>
              )}
            </div>
          )}

          {progress.subject_performance.length > 0 && (
            <div className="overflow-x-auto">

              <h3 className="mb-3 font-semibold text-slate-900">
                Subject-wise progress
              </h3>

              <table className="w-full text-left text-sm">

                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="p-3">Subject</th>
                    <th className="p-3">Assignments</th>
                    <th className="p-3">Study resources</th>
                    <th className="p-3">Study sessions</th>
                    <th className="p-3">Tutor questions</th>
                  </tr>
                </thead>

                <tbody>
                  {progress.subject_performance.map(
                    (subject, index) => (
                      <tr
                        key={index}
                        className="border-b border-slate-100"
                      >
                        <td className="p-3 font-medium">
                          {subject.subject}
                        </td>

                        <td className="p-3">
                          {subject.assignments_completed}/{subject.assignments_total}
                        </td>

                        <td className="p-3">
                          {subject.notes_count + subject.documents_count}
                        </td>

                        <td className="p-3">
                          {subject.study_sessions_completed}
                        </td>

                        <td className="p-3">
                          {subject.tutor_questions}
                        </td>
                      </tr>
                    )
                  )}
                </tbody>

              </table>
            </div>
          )}

          <div className="space-y-3 rounded-xl border border-indigo-100 bg-indigo-50 p-4">

            <h3 className="font-semibold text-indigo-900">
              Personalised AI Recommendations
            </h3>

            <p className="text-sm text-slate-600">
              Analyse your recorded academic activity,
              identify priorities and receive a suggested
              seven-day improvement plan.
            </p>

            {!progress.has_activity && (
              <p className="text-sm text-slate-500">
                Add academic activity before requesting
                an AI progress report.
              </p>
            )}

            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={consent}
                disabled={generating}
                onChange={(event) =>
                  setConsent(event.target.checked)
                }
                className="mt-1"
              />

              <span>
                I agree to send summarised academic
                statistics and subject names to external
                AI providers for analysis.
              </span>
            </label>

            <button
              type="button"
              onClick={generateAnalysis}
              disabled={
                !consent ||
                generating ||
                loading ||
                !progress.has_activity
              }
              className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {generating ? (
                <Loader2
                  size={18}
                  className="animate-spin"
                />
              ) : (
                <BrainCircuit size={18} />
              )}

              {generating
                ? "Analysing your progress..."
                : "Analyse My Academic Progress"}
            </button>

            <p className="text-xs text-slate-500">
              Uses one logical Student AI call.
              Recommendations are advisory and depend
              on available academic records.
            </p>
          </div>
        </>
      )}

      {report && (
        <div className="space-y-4 rounded-xl border border-indigo-200 p-5">

          <div className="flex flex-wrap items-center justify-between gap-2">

            <h3 className="font-bold text-slate-900">
              Your AI Academic Progress Report
            </h3>

            <span className="text-xs text-slate-500">
              {report.calls_remaining}/{report.daily_limit}
              {" "}AI calls remaining
            </span>
          </div>

          <AIResponse content={report.analysis} />

          <p className="text-xs text-slate-500">
            Generated using {report.provider}.
            Verify recommendations against your
            actual academic requirements.
          </p>

          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(
                  report.analysis
                );
              } catch {
                setError("Unable to copy the report.");
              }
            }}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50"
          >
            Copy report
          </button>
        </div>
      )}

      <p className="text-xs text-slate-400">
        Measures recorded academic activity, not grades or learning proficiency. Based on recorded activity, not continuous
        monitoring or measured study duration.
      </p>

    </section>
  );
}