
"use client";

import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useEffect, useState } from "react";

export default function Dashboard() {
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState<string | null>(null);
  const [role, setRole] = useState("");
  const [nameInput, setNameInput] = useState("");
const [savingProfile, setSavingProfile] = useState(false);
const [profileMessage, setProfileMessage] = useState("");
const [isEditingName, setIsEditingName] = useState(false);

  useEffect(() => {
    const supabase = createClient();

    async function loadProfile() {
      const { data, error } = await supabase.auth.getUser();

      if (error || !data.user) {
        window.location.replace("/");
        return;
      }

      setEmail(data.user.email ?? "");

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("full_name, role")
        .eq("id", data.user.id)
        .single();

      if (profileError) {
        console.error("Profile loading failed:", profileError.message);
      } else {
        setFullName(profile.full_name);
        setNameInput(profile.full_name ?? "");
        setRole(profile.role);
      }

      setCheckingAuth(false);
    }

    void loadProfile();
  }, []);

    async function handleSaveProfile() {
  const name = nameInput.trim();

  if (!name || name.length > 100) {
    setProfileMessage("Enter a name between 1 and 100 characters.");
    return;
  }

  setSavingProfile(true);
  setProfileMessage("");

  try {
    const supabase = createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      setProfileMessage("Please sign in again.");
      return;
    }

    const { data, error } = await supabase
      .from("profiles")
      .update({ full_name: name })
      .eq("id", user.id)
      .select("full_name")
      .single();

    if (error) {
      setProfileMessage("Failed to save: " + error.message);
      return;
    }

    setFullName(data.full_name);
    setNameInput(data.full_name ?? "");
    setProfileMessage("Profile saved successfully!");
    setIsEditingName(false);
  } catch {
    setProfileMessage("Something went wrong. Please try again.");
    } finally {
    setSavingProfile(false);
  }
}

async function handleLogout() {
    const supabase = createClient();

    const { error } = await supabase.auth.signOut();

    if (error) {
      alert(error.message);
      return;
    }

    window.location.href = "/";
  }

  if (checkingAuth) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p>Checking authentication...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-50 p-8 text-zinc-900">
      <div className="mx-auto max-w-4xl">
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">
              Multi-Agent AI Platform
            </h1>
            <p className="mt-2 text-zinc-600">
              Choose how you want to use the platform.
            </p>
          </div>

          <button
            onClick={handleLogout}
            className="rounded-lg bg-red-600 px-4 py-2 text-white hover:bg-red-700"
          >
            Logout
          </button>
        </div>

        <section className="mb-8 rounded-2xl border bg-white p-6">
          <h2 className="mb-4 text-xl font-semibold">
            My Profile
          </h2>

          <p className="mb-2">
            <strong>Email:</strong> {email}
          </p>



<div className="mb-4">
  <p className="mb-2 font-semibold">Full Name</p>

  {isEditingName ? (
    <div className="flex flex-wrap items-center gap-3">
      <input
        id="fullName"
        type="text"
        value={nameInput}
        onChange={(e) => setNameInput(e.target.value)}
        maxLength={100}
        placeholder="Enter your full name"
        className="rounded-lg border border-zinc-300 px-4 py-2"
      />

      <button
        type="button"
        onClick={handleSaveProfile}
        disabled={savingProfile}
        className="rounded-lg bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
      >
        {savingProfile ? "Saving..." : "Save Name"}
      </button>

      <button
        type="button"
        disabled={savingProfile}
        onClick={() => {
          setNameInput(fullName ?? "");
          setProfileMessage("");
          setIsEditingName(false);
        }}
        className="rounded-lg border px-4 py-2"
      >
        Cancel
      </button>
    </div>
  ) : (
    <div className="flex flex-wrap items-center gap-3">
      <span>{fullName || "Not set"}</span>

      <button
        type="button"
        onClick={() => {
          setProfileMessage("");
          setIsEditingName(true);
        }}
        className="rounded-lg bg-blue-600 px-4 py-2 text-white"
      >
        Edit Name
      </button>
    </div>
  )}

  {profileMessage && (
    <p className="mt-2 text-sm" role="status">
      {profileMessage}
    </p>
  )}
</div>

        </section>

        <div className="grid gap-6 md:grid-cols-2">
          <div className="rounded-2xl border bg-white p-6">
            <h2 className="mb-2 text-xl font-semibold">
              AI Collaboration Mode
            </h2>
            <p className="mb-4 text-zinc-600">
              Multiple AI models working together.
            </p>
            <Link
              href="/collaboration"
              className="font-medium text-blue-600 hover:underline"
            >
              Explore Mode
            </Link>
          </div>

          <div className="rounded-2xl border bg-white p-6">
            <h2 className="mb-2 text-xl font-semibold">
              Student Mode
            </h2>
            <p className="mb-4 text-zinc-600">
              AI tools for college and studying.
            </p>
            <Link
              href="/student"
              className="font-medium text-blue-600 hover:underline"
            >
              Explore Mode
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
