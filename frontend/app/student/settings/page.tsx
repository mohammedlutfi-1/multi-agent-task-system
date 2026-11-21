
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function StudentPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const [college, setCollege] = useState("");
  const [course, setCourse] = useState("");
  const [semester, setSemester] = useState("");
  const [preferences, setPreferences] = useState("");

  useEffect(() => {
    async function loadStudentProfile() {
      const supabase = createClient();

      const { data: auth, error: authError } =
        await supabase.auth.getUser();

      if (authError || !auth.user) {
        window.location.replace("/");
        return;
      }

      const { data, error } = await supabase
        .from("student_profiles")
        .select(
          "college_name, course, semester, study_preferences"
        )
        .eq("user_id", auth.user.id)
        .maybeSingle();

      if (error) {
        setMessage("Could not load student profile: " + error.message);
      } else if (data) {
        setCollege(data.college_name ?? "");
        setCourse(data.course ?? "");
        setSemester(data.semester?.toString() ?? "");
        setPreferences(data.study_preferences ?? "");
      }

      setLoading(false);
    }

    void loadStudentProfile();
  }, []);

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const semesterNumber = semester ? Number(semester) : null;

    if (
      semesterNumber !== null &&
      (!Number.isInteger(semesterNumber) ||
        semesterNumber < 1 ||
        semesterNumber > 8)
    ) {
      setMessage("Semester must be between 1 and 8.");
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      const supabase = createClient();

      const { data: auth, error: authError } =
        await supabase.auth.getUser();

      if (authError || !auth.user) {
        setMessage("Please sign in again.");
        return;
      }

      const { error } = await supabase
        .from("student_profiles")
        .upsert(
          {
            user_id: auth.user.id,
            college_name: college.trim() || null,
            course: course.trim() || null,
            semester: semesterNumber,
            study_preferences: preferences.trim() || null,
          },
          { onConflict: "user_id" }
        );

      if (error) {
        setMessage("Failed to save: " + error.message);
        return;
      }

      setMessage("Student profile saved successfully!");
    } catch {
      setMessage("Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p>Loading student profile...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-50 p-8 text-zinc-900">
      <div className="mx-auto max-w-2xl">
        <Link
          href="/dashboard"
          className="text-blue-600 hover:underline"
        >
          ← Back to Dashboard
        </Link>

        <h1 className="mt-6 text-3xl font-bold">
          Student Mode
        </h1>

        <p className="mt-2 text-zinc-600">
          Manage your academic profile.
        </p>

        <form
          onSubmit={handleSave}
          className="mt-8 space-y-5 rounded-2xl border bg-white p-6"
        >
          <div>
            <label htmlFor="college" className="mb-2 block font-medium">
              College Name
            </label>
            <input
              id="college"
              value={college}
              onChange={(e) => setCollege(e.target.value)}
              maxLength={150}
              className="w-full rounded-lg border p-3"
              placeholder="Enter your college name"
            />
          </div>

          <div>
            <label htmlFor="course" className="mb-2 block font-medium">
              Course
            </label>
            <input
              id="course"
              value={course}
              onChange={(e) => setCourse(e.target.value)}
              maxLength={100}
              className="w-full rounded-lg border p-3"
              placeholder="Example: B.E. Computer Science"
            />
          </div>

          <div>
            <label htmlFor="semester" className="mb-2 block font-medium">
              Semester
            </label>
            <input
              id="semester"
              type="number"
              min="1"
              max="8"
              value={semester}
              onChange={(e) => setSemester(e.target.value)}
              className="w-full rounded-lg border p-3"
              placeholder="Enter semester"
            />
          </div>

          <div>
            <label htmlFor="preferences" className="mb-2 block font-medium">
              Study Preferences
            </label>
            <textarea
              id="preferences"
              value={preferences}
              onChange={(e) => setPreferences(e.target.value)}
              maxLength={2000}
              rows={4}
              className="w-full rounded-lg border p-3"
              placeholder="Example: Prefer simple explanations and practice questions"
            />
          </div>

          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-blue-600 px-5 py-3 text-white disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Student Profile"}
          </button>

          {message && (
            <p role="status" className="text-sm">
              {message}
            </p>
          )}
        </form>
      </div>
    </main>
  );
}
