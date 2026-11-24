
"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

const API = (
  process.env.NEXT_PUBLIC_API_URL ||
  "http://localhost:8000"
).replace(/\/$/, "");

const providers = [
  { id: "gemini", name: "Google Gemini", icon: "✦", color: "text-blue-600 bg-blue-50" },
  { id: "groq", name: "Groq", icon: "✦", color: "text-orange-600 bg-orange-50" },
  { id: "openrouter", name: "OpenRouter", icon: "◇", color: "text-indigo-600 bg-indigo-50" },
] as const;

type KeyInfo = {
  provider: string;
  is_active: boolean;
  updated_at: string;
};

async function request(path: string, init: RequestInit = {}) {
  const { data: { session }, error } =
    await createClient().auth.getSession();

  if (error || !session?.access_token) {
    throw new Error("Please sign in again.");
  }

  const response = await fetch(`${API}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    signal: AbortSignal.timeout(30000),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      typeof data.detail === "string"
        ? data.detail
        : "Request failed."
    );
  }

  return data;
}

export default function APISettingsPage() {
  const [keys, setKeys] = useState<KeyInfo[]>([]);
  const [inputs, setInputs] =
    useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadKeys = useCallback(async () => {
    setLoading(true);

    try {
      const data = await request("/ai/api-keys");

      if (!Array.isArray(data.keys)) {
        throw new Error("Invalid settings response.");
      }

      setKeys(data.keys);
    } catch {
      setError("Unable to load API key settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadKeys();
  }, [loadKeys]);

  async function saveKey(provider: string) {
    const value = inputs[provider]?.trim();

    if (!value || busy) return;

    setBusy(provider);
    setError("");
    setMessage("");

    try {
      await request("/ai/api-keys", {
        method: "POST",
        body: JSON.stringify({
          provider,
          api_key: value,
        }),
      });

      setInputs((previous) => ({
        ...previous,
        [provider]: "",
      }));

      setMessage("API key saved successfully.");
      await loadKeys();
    } catch {
      setError("Unable to save API key.");
    } finally {
      setBusy("");
    }
  }

  async function removeKey(provider: string) {
    if (busy) return;

    if (!window.confirm("Remove this personal API key?")) {
      return;
    }

    setBusy(provider);
    setError("");
    setMessage("");

    try {
      await request(`/ai/api-keys/${provider}`, {
        method: "DELETE",
      });

      setInputs((previous) => ({
        ...previous,
        [provider]: "",
      }));

      setMessage("API key removed successfully.");
      await loadKeys();
    } catch {
      setError("Unable to remove API key.");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">

      <aside className="fixed inset-y-0 left-0 hidden w-72 flex-col bg-[#101827] p-5 text-slate-200 lg:flex">

        <div className="mb-10 flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-600 text-xl text-white">
            ✦
          </div>

          <div>
            <h1 className="font-bold text-white">
              MultiAgent AI
            </h1>
            <p className="text-xs text-slate-400">
              Collaboration workspace
            </p>
          </div>
        </div>

        <Link href="/dashboard" className="rounded-lg px-3 py-3 text-sm hover:bg-slate-800">
          ← Main Dashboard
        </Link>

        <Link href="/collaboration" className="rounded-lg px-3 py-3 text-sm hover:bg-slate-800">
          + New Collaboration
        </Link>

        <Link href="/collaboration#ai-models" className="rounded-lg px-3 py-3 text-sm hover:bg-slate-800">
          ◇ AI Models
        </Link>

        <div className="rounded-lg bg-indigo-600 px-3 py-3 text-sm font-medium text-white">
          API Settings
        </div>

        <Link href="/collaboration#usage" className="rounded-lg px-3 py-3 text-sm hover:bg-slate-800">
          Usage &amp; Limits
        </Link>

      </aside>

      <main className="px-5 py-10 lg:ml-72 lg:px-12">

        <div className="mx-auto max-w-4xl">

          <Link href="/collaboration" className="mb-6 inline-block text-sm font-medium text-indigo-600">
            ← Back to Collaboration
          </Link>

          <h1 className="text-3xl font-bold">
            API Settings
          </h1>

          <p className="mt-2 text-slate-500">
            Manage your personal AI provider API keys.
          </p>

          <div className="mt-6 rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-900">
            Personal API keys are optional. Your provider
            may charge you according to your account and
            usage. To use your personal API keys, configure at least two providers and select Personal API keys in the collaboration workspace. Saved keys are not automatically verified.
          </div>

          {error && (
            <div role="alert" className="mt-4 rounded-lg bg-red-50 p-4 text-sm text-red-700">
              {error}
            </div>
          )}

          {message && (
            <div role="status" className="mt-4 rounded-lg bg-green-50 p-4 text-sm text-green-700">
              {message}
            </div>
          )}

          {loading && (
            <p className="mt-6 text-sm text-slate-500">
              Loading API settings...
            </p>
          )}

          <div className="mt-8 space-y-5">

            {providers.map((provider) => {
              const saved = keys.find(
                (key) => key.provider === provider.id
              );

              return (
                <section
                  key={provider.id}
                  className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
                >

                  <div className="flex flex-wrap items-center gap-4">

                    <div className={`grid h-12 w-12 place-items-center rounded-xl text-2xl ${provider.color}`}>
                      {provider.icon}
                    </div>

                    <div className="flex-1">
                      <h2 className="font-semibold">
                        {provider.name}
                      </h2>

                      <p className="mt-1 text-sm text-slate-500">
                        {loading
                          ? "Checking..."
                          : saved?.is_active
                            ? "Personal key saved — not verified"
                            : "No personal key configured"}
                      </p>
                    </div>

                    {saved?.is_active && (
                      <span className="rounded-full bg-green-50 px-3 py-1 text-xs font-medium text-green-700">
                        Saved
                      </span>
                    )}

                  </div>

                  <label
                    htmlFor={`key-${provider.id}`}
                    className="mt-5 block text-sm font-medium"
                  >
                    {saved ? "Replace API key" : "Enter API key"}
                  </label>

                  <input
                    id={`key-${provider.id}`}
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={2048}
                    value={inputs[provider.id] || ""}
                    onChange={(event) =>
                      setInputs((previous) => ({
                        ...previous,
                        [provider.id]: event.target.value,
                      }))
                    }
                    placeholder="Enter your personal API key"
                    className="mt-2 w-full rounded-lg border border-slate-200 px-4 py-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                  />

                  <div className="mt-4 flex flex-wrap gap-3">

                    <button
                      disabled={
                        loading ||
                        !!busy ||
                        !inputs[provider.id]?.trim()
                      }
                      onClick={() => void saveKey(provider.id)}
                      className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {busy === provider.id
                        ? "Processing..."
                        : "Save API key"}
                    </button>

                    {saved && (
                      <button
                        disabled={loading || !!busy}
                        onClick={() => void removeKey(provider.id)}
                        className="rounded-lg border border-red-200 px-5 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                      >
                        Remove key
                      </button>
                    )}

                  </div>

                </section>
              );
            })}

          </div>

          <div className="mt-8 rounded-xl border border-slate-200 bg-white p-5">
            <h3 className="font-semibold">
              Security and privacy
            </h3>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Your API keys are encrypted before database
              storage. Previously saved keys are never
              displayed. Removing a key from this platform
              does not revoke it at the original provider.
            </p>
          </div>

        </div>

      </main>
    </div>
  );
}
