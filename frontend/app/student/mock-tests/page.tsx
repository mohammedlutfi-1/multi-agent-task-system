"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type Exam = {
  id: string;
  title: string;
  syllabus: string | null;
};

type Question = {
  number: number;
  question: string;
  options: Record<string, string>;
};

type Review = {
  number: number;
  correct_answer: string;
  explanation: string;
  [key: string]: unknown;
};

type TestData = {
  test_id: string;
  exam_id: string;
  topic: string;
  questions: Question[];
  provider?: string;
  model?: string;
};

type ResultData = {
  correct_count: number;
  total_questions: number;
  score_percentage: number;
  passed: boolean;
  review: Review[];
  exam_progress?: {
    updated: boolean;
    reason?: string;
    preparation_status?: string;
  };
};

function syllabusTopics(value: string | null): string[] {
  return (value ?? "")
    .split(/\r?\n/)
    .map((topic) => topic.trim())
    .filter(Boolean);
}

export default function StudentMockTestsPage() {
  const [supabase] = useState(() => createClient());

  const [exams, setExams] = useState<Exam[]>([]);
  const [examId, setExamId] = useState("");
  const [topic, setTopic] = useState("");
  const [questionCount, setQuestionCount] = useState(5);
  const [consent, setConsent] = useState(false);

  const [test, setTest] = useState<TestData | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<ResultData | null>(null);

  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const apiRequest = useCallback(
    async <T,>(
      endpoint: string,
      method: "GET" | "POST",
      body?: unknown
    ): Promise<T> => {
      const { data, error: authError } =
        await supabase.auth.getSession();

      if (authError || !data.session?.access_token) {
        throw new Error("Please sign in again.");
      }

      const baseUrl = (
        process.env.NEXT_PUBLIC_API_URL ||
        "http://localhost:8000"
      ).replace(/\/$/, "");

      const response = await fetch(`${baseUrl}${endpoint}`, {
        method,
        headers: {
          Authorization:
            `Bearer ${data.session.access_token}`,
          ...(body !== undefined
            ? { "Content-Type": "application/json" }
            : {}),
        },
        ...(body !== undefined
          ? { body: JSON.stringify(body) }
          : {}),
      });

      if (!response.ok) {
        let message = `Request failed (${response.status}).`;

        try {
          const payload = await response.json();

          if (typeof payload.detail === "string") {
            message = payload.detail;
          }
        } catch {
          // Retain the HTTP status message.
        }

        throw new Error(message);
      }

      return response.json() as Promise<T>;
    },
    [supabase]
  );

  const loadExams = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const { data: auth, error: authError } =
        await supabase.auth.getUser();

      if (authError || !auth.user) {
        throw new Error("Please sign in again.");
      }

      const { data, error: dbError } = await supabase
        .from("student_exams")
        .select("id,title,syllabus")
        .eq("user_id", auth.user.id)
        .order("exam_date", { ascending: true });

      if (dbError) {
        throw dbError;
      }

      setExams((data ?? []) as Exam[]);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to load exams."
      );
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void loadExams();
  }, [loadExams]);

  const selectedExam = exams.find(
    (exam) => exam.id === examId
  );

  const topics = syllabusTopics(
    selectedExam?.syllabus ?? null
  );

  function resetTest() {
    setTest(null);
    setResult(null);
    setAnswers({});
  }

  function chooseExam(id: string) {
    setExamId(id);
    setTopic("");
    resetTest();
    setError("");
  }

  async function generateTest() {
    if (!examId || !topic || !consent || busy) {
      return;
    }

    setBusy(true);
    setError("");
    resetTest();

    try {
      const generated = await apiRequest<TestData>(
        "/student/ai/mock-tests/generate",
        "POST",
        {
          exam_id: examId,
          topic,
          question_count: questionCount,
          accept_ai_processing: true,
          use_personal_keys: false,
          accept_provider_charges: false,
        }
      );

      setTest(generated);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to generate mock test."
      );
    } finally {
      setBusy(false);
    }
  }

  async function submitTest() {
    if (!test || busy || result) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      const graded = await apiRequest<ResultData>(
        `/student/ai/mock-tests/${test.test_id}/submit`,
        "POST",
        {
          submitted_answers: answers,
        }
      );

      setResult(graded);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to submit mock test."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">
          AI Mock Tests
        </h1>

        <p className="mt-2 text-sm text-slate-600">
          Practice syllabus topics using AI-generated
          multiple-choice questions. Score at least 80%
          to automatically complete a topic in
          Exam Preparation.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-semibold">
          Create a mock test
        </h2>

        {!loading && !error && (exams.length === 0 || (selectedExam && topics.length === 0)) && (
          <p className="text-sm text-slate-600">
            {exams.length === 0 ? "Add an exam with syllabus topics in " : "Add syllabus topics for this exam in "}
            <Link href="/student/exams" className="font-medium text-indigo-700 underline">
              Exam Preparation
            </Link>.
          </p>
        )}

        <label className="block space-y-1 text-sm">
          <span className="font-medium">
            Exam
          </span>

          <select
            value={examId}
            onChange={(event) =>
              chooseExam(event.target.value)
            }
            disabled={busy || loading}
            className="w-full rounded-lg border border-slate-300 p-2"
          >
            <option value="">
              Select an exam
            </option>

            {exams.map((exam) => (
              <option key={exam.id} value={exam.id}>
                {exam.title}
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-1 text-sm">
          <span className="font-medium">
            Syllabus topic
          </span>

          <select
            value={topic}
            onChange={(event) => {
              setTopic(event.target.value);
              resetTest();
            }}
            disabled={!examId || busy}
            className="w-full rounded-lg border border-slate-300 p-2"
          >
            <option value="">
              Select a topic
            </option>

            {topics.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-1 text-sm">
          <span className="font-medium">
            Number of questions
          </span>

          <select
            value={questionCount}
            onChange={(event) =>
              setQuestionCount(Number(event.target.value))
            }
            disabled={busy}
            className="w-full rounded-lg border border-slate-300 p-2"
          >
            {[3, 5, 10].map((count) => (
              <option key={count} value={count}>
                {count} questions
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={consent}
            onChange={(event) =>
              setConsent(event.target.checked)
            }
            className="mt-1"
          />

          <span>
            I agree to send the selected exam topic
            to the configured AI provider to generate
            practice questions.
          </span>
        </label>

        <button
          type="button"
          onClick={generateTest}
          disabled={
            !examId ||
            !topic ||
            !consent ||
            busy ||
            loading
          }
          className="rounded-lg bg-indigo-600 px-5 py-2 font-medium text-white disabled:opacity-50"
        >
          {busy && !test
            ? "Generating..."
            : "Generate mock test"}
        </button>

        {!loading && exams.length === 0 && (
          <p className="text-sm text-slate-500">
            No exams found. Create an exam with
            syllabus topics in Exam Preparation first.
          </p>
        )}
      </section>

      {test && (
        <section className="space-y-5 rounded-xl border border-slate-200 bg-white p-5">
          <div>
            <h2 className="text-lg font-semibold">
              {test.topic}
            </h2>

            <p className="text-sm text-slate-500">
              {test.questions.length} questions
              {test.provider
                ? ` ? ${test.provider}`
                : ""}
            </p>
          </div>

          {test.questions.map((question) => (
            <fieldset
              key={question.number}
              disabled={busy || Boolean(result)}
              className="min-w-0 space-y-3 rounded-lg border border-slate-200 p-4"
            >
              <legend className="sr-only">
                Question {question.number}
              </legend>
              <p className="mb-4 whitespace-normal break-words text-base font-semibold leading-relaxed text-slate-900">
                {question.number}. {question.question}
              </p>

              {Object.entries(question.options).map(
                ([key, value]) => (
                  <label
                    key={key}
                    className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 text-sm"
                  >
                    <input
                      type="radio"
                      name={`question-${question.number}`}
                      value={key}
                      checked={
                        answers[
                          String(question.number)
                        ] === key
                      }
                      onChange={() =>
                        setAnswers((current) => ({
                          ...current,
                          [String(question.number)]: key,
                        }))
                      }
                      className="mt-1"
                    />

                    <span>
                      <strong>{key}.</strong>{" "}
                      {value}
                    </span>
                  </label>
                )
              )}
            </fieldset>
          ))}

          {!result && (
            <button
              type="button"
              onClick={submitTest}
              disabled={busy}
              className="rounded-lg bg-indigo-600 px-5 py-2 font-medium text-white disabled:opacity-50"
            >
              {busy
                ? "Submitting..."
                : "Submit answers"}
            </button>
          )}
        </section>
      )}

      {result && (
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-xl font-semibold">
            Your results
          </h2>

          <p className="text-3xl font-bold text-indigo-700">
            {result.score_percentage}%
          </p>

          <p>
            {result.correct_count} of{" "}
            {result.total_questions} correct.{" "}
            {result.passed
              ? "Passed"
              : "Needs improvement"}
          </p>

          <p className="text-sm text-slate-600">
            {result.exam_progress?.updated
              ? "Exam topic automatically marked complete."
              : result.exam_progress?.reason === "progress_update_unconfirmed"
                ? "Your score was saved. Check Exam Preparation to confirm the topic status."
                : "Exam topic was not automatically marked complete."}
          </p>

          <h3 className="font-semibold">
            Answer review
          </h3>

          {result.review.map((item) => (
            <div
              key={item.number}
              className="rounded-lg border border-slate-200 p-3 text-sm"
            >
              <p className="font-medium">
                Question {item.number}:
                Correct answer{" "}
                {item.correct_answer}
              </p>

              <p className="mt-1 text-slate-600">
                {item.explanation}
              </p>
            </div>
          ))}

          <button
            type="button"
            onClick={resetTest}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm"
          >
            Start another test
          </button>
        </section>
      )}
    </main>
  );
}
