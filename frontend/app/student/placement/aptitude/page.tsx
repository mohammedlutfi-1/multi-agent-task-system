"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type Category = "quantitative" | "logical" | "verbal" | "programming" | "cs_fundamentals" | "pseudocode";
type Difficulty = "easy" | "medium" | "hard";
type Answer = "A" | "B" | "C" | "D";

type Question = {
  number: number;
  question: string;
  options: Record<Answer, string>;
};

type Test = {
  test_id: string;
  category: Category;
  topic: string;
  difficulty: Difficulty;
  duration_seconds: number;
  expires_at: string;
  questions: Question[];
};

type Review = {
  number: number;
  question: string;
  selected_answer?: string | null;
  submitted_answer?: string | null;
  correct_answer: string;
  explanation: string;
  is_correct: boolean;
  options?: Record<Answer, string>;
};

type Result = {
  correct_count: number;
  total_questions: number;
  score_percentage: number;
  time_taken_seconds: number;
  review: Review[];
};

type HistoryItem = {
  id: string;
  score_percentage: number;
  correct_count: number;
  total_questions: number;
  created_at: string;
  student_aptitude_tests?: {
    category: string;
    topic: string;
    difficulty: string;
  } | null;
};

const TOPICS: Record<Category, string[]> = {
  quantitative: [
    "Percentages",
    "Profit and Loss",
    "Time and Work",
    "Time, Speed and Distance",
    "Ratio and Proportion",
    "Averages",
    "Simple and Compound Interest",
    "Probability",
    "Permutations and Combinations",
    "Number Systems",
    "Data Interpretation",
  ],
  logical: [
    "Number Series",
    "Coding and Decoding",
    "Blood Relations",
    "Direction Sense",
    "Syllogisms",
    "Seating Arrangement",
    "Logical Puzzles",
    "Data Sufficiency",
  ],
  verbal: [
    "Reading Comprehension",
    "Sentence Correction",
    "Synonyms and Antonyms",
    "Grammar",
    "Para Jumbles",
    "Vocabulary",
  ],
  programming: [
    "C Programming",
    "C++ Programming",
    "Java Programming",
    "Python Programming",
    "JavaScript",
    "Output Prediction",
    "Loops and Functions",
    "Recursion",
  ],
  cs_fundamentals: [
    "DBMS and SQL",
    "SQL Joins",
    "Operating Systems",
    "Computer Networks",
    "Object-Oriented Programming",
    "Data Structures",
    "Algorithms",
    "Time Complexity",
  ],
  pseudocode: [
    "Pseudocode Output",
    "Logic Tracing",
    "Error Identification",
    "Basic Debugging",
    "Conditional Statements",
    "Loops and Arrays",
  ],
};

const OPTIONS: Answer[] = ["A", "B", "C", "D"];

function formatTime(seconds: number) {
  const safe = Math.max(0, seconds);
  return `${Math.floor(safe / 60)
    .toString()
    .padStart(2, "0")}:${(safe % 60)
    .toString()
    .padStart(2, "0")}`;
}

export default function AptitudePracticePage() {
  const [supabase] = useState(() => createClient());
  const [category, setCategory] = useState<Category>("quantitative");
  const [topic, setTopic] = useState("Percentages");
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [count, setCount] = useState<5 | 10 | 20>(5);
  const [consent, setConsent] = useState(false);
  const [test, setTest] = useState<Test | null>(null);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [result, setResult] = useState<Result | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [remaining, setRemaining] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);

  const api = useCallback(async <T,>(
    endpoint: string,
    method = "GET",
    body?: unknown
  ): Promise<T> => {
    const { data, error: authError } =
      await supabase.auth.getSession();

    if (authError || !data.session?.access_token) {
      throw new Error("Please sign in again.");
    }

    const base = (
      process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"
    ).replace(/\/$/, "");

    const response = await fetch(`${base}${endpoint}`, {
      method,
      headers: {
        Authorization: `Bearer ${data.session.access_token}`,
        ...(body === undefined
          ? {}
          : { "Content-Type": "application/json" }),
      },
      ...(body === undefined
        ? {}
        : { body: JSON.stringify(body) }),
    });

    if (!response.ok) {
      let message = `Request failed (${response.status}).`;
      try {
        const payload = await response.json();
        if (typeof payload.detail === "string") {
          message = payload.detail;
        }
      } catch {
        // Keep the HTTP status message.
      }
      throw new Error(message);
    }

    return (await response.json()) as T;
  }, [supabase]);

  const loadHistory = useCallback(async () => {
    try {
      const data = await api<{ attempts: HistoryItem[] }>(
        "/student/aptitude/history"
      );
      setHistory(data.attempts);
    } catch {
      // History failure should not block practice.
    }
  }, [api]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const submit = useCallback(async (
    activeTest: Test,
    selected: Record<string, Answer>
  ) => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");

    try {
      const data = await api<Result>(
        `/student/aptitude/${activeTest.test_id}/submit`,
        "POST",
        { submitted_answers: selected }
      );
      setResult(data);
      await loadHistory();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Submission failed."
      );
    } finally {
      setBusy(false);
      submitting.current = false;
    }
  }, [api, loadHistory]);

  useEffect(() => {
    if (!test || result) return;

    const update = () => {
      const seconds = Math.max(
        0,
        Math.ceil(
          (new Date(test.expires_at).getTime() - Date.now()) / 1000
        )
      );
      setRemaining(seconds);

      // Submit before the server deadline to allow network transit.
      if (seconds <= 3 && !submitting.current) {
        void submit(test, answers);
      }
    };

    update();
    const interval = window.setInterval(update, 1000);
    return () => window.clearInterval(interval);
  }, [test, result, answers, submit]);

  async function generate() {
    if (!consent) {
      setError("Please accept AI processing before generating a test.");
      return;
    }

    setBusy(true);
    setError("");
    setResult(null);
    setTest(null);
    setAnswers({});

    try {
      const generated = await api<Test>(
        "/student/aptitude/generate",
        "POST",
        {
          category,
          topic,
          difficulty,
          question_count: count,
          accept_ai_processing: true,
          use_personal_keys: false,
          accept_provider_charges: false,
        }
      );
      setTest(generated);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Generation failed."
      );
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setTest(null);
    setResult(null);
    setAnswers({});
    setRemaining(0);
    setError("");
  }

  const inputClass =
    "w-full rounded-lg border border-slate-300 bg-white p-3 text-slate-900";
  const buttonClass =
    "rounded-lg bg-indigo-600 px-5 py-3 font-medium text-white disabled:opacity-50";

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-5 text-slate-900">
      <div>
        <Link
          href="/student/placement"
          className="text-sm text-indigo-700 hover:underline"
        >
          ? Placement Preparation
        </Link>
        <h1 className="mt-3 text-3xl font-bold">
          Aptitude Preparation
        </h1>
        <p className="mt-2 text-slate-600">
          Practice timed quantitative, logical and verbal MCQs.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 p-4 text-red-800"
        >
          {error}
        </div>
      )}

      {!test && (
        <section className="space-y-5 rounded-xl border bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold">Configure practice test</h2>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2">
              <span className="block font-medium">Category</span>
              <select
                className={inputClass}
                value={category}
                onChange={(event) => {
                  const next = event.target.value as Category;
                  setCategory(next);
                  setTopic(TOPICS[next][0]);
                }}
              >
                <option value="quantitative">Quantitative Aptitude</option>
                <option value="logical">Logical Reasoning</option>
                <option value="verbal">Verbal Ability</option>
                <option value="programming">Programming MCQs</option>
                <option value="cs_fundamentals">CS Fundamentals</option>
                <option value="pseudocode">Pseudocode &amp; Debugging</option>
              </select>
            </label>

            <label className="space-y-2">
              <span className="block font-medium">Topic</span>
              <select
                className={inputClass}
                value={topic}
                onChange={(event) => setTopic(event.target.value)}
              >
                {TOPICS[category].map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </label>

            <label className="space-y-2">
              <span className="block font-medium">Difficulty</span>
              <select
                className={inputClass}
                value={difficulty}
                onChange={(event) =>
                  setDifficulty(event.target.value as Difficulty)
                }
              >
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>
            </label>

            <label className="space-y-2">
              <span className="block font-medium">Questions</span>
              <select
                className={inputClass}
                value={count}
                onChange={(event) =>
                  setCount(Number(event.target.value) as 5 | 10 | 20)
                }
              >
                <option value={5}>5 ? 7.5 minutes</option>
                <option value={10}>10 ? 15 minutes</option>
                <option value={20}>20 ? 30 minutes</option>
              </select>
            </label>
          </div>

          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
              className="mt-1"
            />
            <span>
              I agree to send my selected topic and difficulty to
              the configured AI provider to generate questions.
            </span>
          </label>

          <button
            className={buttonClass}
            disabled={busy || !consent}
            onClick={() => void generate()}
          >
            {busy ? "Generating questions..." : "Start Practice Test"}
          </button>

          <p className="text-sm text-slate-500">
            AI-generated answers may contain mistakes. Review solutions
            critically, particularly for quantitative questions.
          </p>
        </section>
      )}

      {test && !result && (
        <section className="space-y-5">
          <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-4 shadow-sm">
            <div>
              <p className="font-semibold">{test.topic}</p>
              <p className="text-sm text-slate-500">
                {Object.keys(answers).length}/{test.questions.length}
                {" "}answered
              </p>
            </div>
            <div
              className={`text-2xl font-bold ${
                remaining <= 30 ? "text-red-600" : "text-indigo-700"
              }`}
            >
              {formatTime(remaining)}
            </div>
          </div>

          {test.questions.map((question) => (
            <fieldset
              key={question.number}
              disabled={busy || remaining <= 0}
              className="min-w-0 space-y-3 rounded-xl border bg-white p-5 shadow-sm"
            >
              <legend className="sr-only">
                Question {question.number}
              </legend>
              <p className="break-words font-semibold">
                {question.number}. {question.question}
              </p>
              {OPTIONS.map((option) => (
                <label
                  key={option}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${
                    answers[String(question.number)] === option
                      ? "border-indigo-500 bg-indigo-50"
                      : "border-slate-200"
                  }`}
                >
                  <input
                    type="radio"
                    name={`question-${question.number}`}
                    checked={
                      answers[String(question.number)] === option
                    }
                    onChange={() =>
                      setAnswers((previous) => ({
                        ...previous,
                        [String(question.number)]: option,
                      }))
                    }
                  />
                  <span className="break-words">
                    {option}. {question.options[option]}
                  </span>
                </label>
              ))}
            </fieldset>
          ))}

          <button
            className={buttonClass}
            disabled={busy || remaining <= 0}
            onClick={() => void submit(test, answers)}
          >
            {busy ? "Submitting..." : "Submit Test"}
          </button>
        </section>
      )}

      {test && result && (
        <section className="space-y-5">
          <div className="rounded-xl border bg-white p-6 shadow-sm">
            <h2 className="text-2xl font-bold">Test Result</h2>
            <p className="mt-3 text-4xl font-bold text-indigo-700">
              {result.score_percentage}%
            </p>
            <p className="mt-2">
              {result.correct_count} of {result.total_questions} correct
            </p>
            <p className="text-sm text-slate-500">
              Time: {formatTime(result.time_taken_seconds)}
            </p>
          </div>

          <h2 className="text-xl font-semibold">
            Answers and explanations
          </h2>

          {result.review.map((item) => (
            <article
              key={item.number}
              className="space-y-2 rounded-xl border bg-white p-5 shadow-sm"
            >
              <p className="font-semibold">
                Question {item.number}: {item.question}
              </p>
              <p className={
                item.is_correct ? "text-green-700" : "text-red-700"
              }>
                {item.is_correct ? "Correct" : "Incorrect"}
              </p>
              <p>
                Your answer: {
                  item.selected_answer ??
                  item.submitted_answer ??
                  "Not answered"
                }
              </p>
              <p>Correct answer: {item.correct_answer}</p>
              <p className="text-slate-600">
                <strong>Explanation:</strong> {item.explanation}
              </p>
            </article>
          ))}

          <button className={buttonClass} onClick={reset}>
            Start Another Test
          </button>
        </section>
      )}

      <section className="rounded-xl border bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-xl font-semibold">Recent Attempts</h2>
        {history.length === 0 ? (
          <p className="text-slate-500">No completed attempts yet.</p>
        ) : (
          <div className="space-y-3">
            {history.map((item) => (
              <div
                key={item.id}
                className="flex flex-wrap justify-between gap-2 border-b pb-3"
              >
                <div>
                  <p className="font-medium">
                    {item.student_aptitude_tests?.topic ?? "Aptitude"}
                  </p>
                  <p className="text-sm text-slate-500">
                    {item.student_aptitude_tests?.difficulty ?? ""}
                    {" ? "}
                    {new Date(item.created_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-semibold">
                    {item.score_percentage}%
                  </p>
                  <p className="text-sm text-slate-500">
                    {item.correct_count}/{item.total_questions}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
