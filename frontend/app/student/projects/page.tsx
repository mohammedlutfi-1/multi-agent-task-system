"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type ProjectStatus = "planning" | "in_progress" | "on_hold" | "completed";
type ProjectType = "academic" | "personal" | "team" | "research";

type Project = {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  project_type: ProjectType;
  status: ProjectStatus;
  progress: number;
  start_date: string | null;
  due_date: string | null;
  technologies: string[];
  repository_url: string | null;
};

type ProjectForm = {
  title: string;
  description: string;
  project_type: ProjectType;
  status: ProjectStatus;
  progress: number;
  start_date: string;
  due_date: string;
  technologies: string;
  repository_url: string;
};

function emptyForm(): ProjectForm {
  return {
    title: "",
    description: "",
    project_type: "academic",
    status: "planning",
    progress: 0,
    start_date: "",
    due_date: "",
    technologies: "",
    repository_url: "",
  };
}

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";

const buttonClass =
  "rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50";

function formatDate(value: string | null): string {
  if (!value) return "Not set";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString();
}

function safeRepositoryUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export default function StudentProjectsPage() {
  const [supabase] = useState(() => createClient());
  const [userId, setUserId] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [form, setForm] = useState<ProjectForm>(emptyForm);
  const [editing, setEditing] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadProjects = useCallback(async () => {
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
        .from("student_projects")
        .select("*")
        .eq("user_id", auth.user.id)
        .order("created_at", { ascending: false });

      if (dbError) throw dbError;

      setProjects((data ?? []) as Project[]);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to load projects."
      );
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  function updateField<K extends keyof ProjectForm>(
    field: K,
    value: ProjectForm[K]
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

  function startEdit(project: Project) {
    setEditing(project.id);
    setForm({
      title: project.title,
      description: project.description ?? "",
      project_type: project.project_type,
      status: project.status,
      progress: project.progress,
      start_date: project.start_date ?? "",
      due_date: project.due_date ?? "",
      technologies: (project.technologies ?? []).join(", "),
      repository_url: project.repository_url ?? "",
    });
    setShowForm(true);
    setError("");
    setNotice("");
  }

  async function saveProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !userId) return;

    setError("");
    setNotice("");

    if (!form.title.trim()) {
      setError("Project title is required.");
      return;
    }

    if (
      form.start_date &&
      form.due_date &&
      form.due_date < form.start_date
    ) {
      setError("Due date cannot be before the start date.");
      return;
    }

    const repositoryUrl = form.repository_url.trim();
    if (repositoryUrl && !safeRepositoryUrl(repositoryUrl)) {
      setError("Repository URL must be a valid HTTPS link.");
      return;
    }

    const progress = Math.max(
      0,
      Math.min(100, Math.round(Number(form.progress) || 0))
    );

    const payload = {
      user_id: userId,
      title: form.title.trim(),
      description: form.description.trim() || null,
      project_type: form.project_type,
      status: form.status,
      progress: form.status === "completed" ? 100 : progress,
      start_date: form.start_date || null,
      due_date: form.due_date || null,
      technologies: [
        ...new Set(
          form.technologies
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean)
        ),
      ],
      repository_url: repositoryUrl || null,
      updated_at: new Date().toISOString(),
    };

    setBusy(true);

    try {
      const query = editing
        ? supabase
            .from("student_projects")
            .update(payload)
            .eq("id", editing)
            .eq("user_id", userId)
        : supabase
            .from("student_projects")
            .insert(payload);

      const { error: dbError } = await query.select("id").single();

      if (dbError) throw dbError;

      setShowForm(false);
      setEditing(null);
      setForm(emptyForm());
      await loadProjects();
      setNotice("Project saved successfully.");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to save project."
      );
    } finally {
      setBusy(false);
    }
  }

  async function deleteProject(project: Project) {
    if (busy || !userId) return;

    if (!window.confirm(`Delete "${project.title}" permanently?`)) {
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");

    try {
      const { error: dbError } = await supabase
        .from("student_projects")
        .delete()
        .eq("id", project.id)
        .eq("user_id", userId);

      if (dbError) throw dbError;

      await loadProjects();
      setNotice("Project deleted.");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to delete project."
      );
    } finally {
      setBusy(false);
    }
  }

  const completed = projects.filter(
    (project) => project.status === "completed"
  ).length;

  const active = projects.filter(
    (project) => project.status === "in_progress"
  ).length;

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Student Projects
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Manage academic, research, personal, and team projects.
          </p>
        </div>
        <button
          type="button"
          onClick={startNew}
          className={buttonClass}
        >
          + New Project
        </button>
      </header>

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {notice && (
        <div role="status" className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
          {notice}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: "Total Projects", value: projects.length },
          { label: "In Progress", value: active },
          { label: "Completed", value: completed },
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
            {editing ? "Edit Project" : "Create Project"}
          </h2>

          <form onSubmit={saveProject} className="space-y-4">
            <label className="block space-y-1 text-sm">
              <span>Project title *</span>
              <input
                required
                value={form.title}
                onChange={(event) =>
                  updateField("title", event.target.value)
                }
                className={inputClass}
                maxLength={200}
              />
            </label>

            <label className="block space-y-1 text-sm">
              <span>Description</span>
              <textarea
                value={form.description}
                onChange={(event) =>
                  updateField("description", event.target.value)
                }
                rows={3}
                className={inputClass}
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-1 text-sm">
                <span>Project type</span>
                <select
                  value={form.project_type}
                  onChange={(event) =>
                    updateField(
                      "project_type",
                      event.target.value as ProjectType
                    )
                  }
                  className={inputClass}
                >
                  <option value="academic">Academic</option>
                  <option value="personal">Personal</option>
                  <option value="team">Team</option>
                  <option value="research">Research</option>
                </select>
              </label>

              <label className="block space-y-1 text-sm">
                <span>Status</span>
                <select
                  value={form.status}
                  onChange={(event) =>
                    updateField(
                      "status",
                      event.target.value as ProjectStatus
                    )
                  }
                  className={inputClass}
                >
                  <option value="planning">Planning</option>
                  <option value="in_progress">In Progress</option>
                  <option value="on_hold">On Hold</option>
                  <option value="completed">Completed</option>
                </select>
              </label>

              <label className="block space-y-1 text-sm">
                <span>Start date</span>
                <input
                  type="date"
                  value={form.start_date}
                  onChange={(event) =>
                    updateField("start_date", event.target.value)
                  }
                  className={inputClass}
                />
              </label>

              <label className="block space-y-1 text-sm">
                <span>Due date</span>
                <input
                  type="date"
                  value={form.due_date}
                  onChange={(event) =>
                    updateField("due_date", event.target.value)
                  }
                  className={inputClass}
                />
              </label>
            </div>

            <label className="block space-y-1 text-sm">
              <span>Progress: {form.progress}%</span>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={form.progress}
                onChange={(event) =>
                  updateField("progress", Number(event.target.value))
                }
                className="w-full"
              />
            </label>

            <label className="block space-y-1 text-sm">
              <span>Technologies (comma separated)</span>
              <input
                value={form.technologies}
                onChange={(event) =>
                  updateField("technologies", event.target.value)
                }
                placeholder="Python, React, Supabase"
                className={inputClass}
              />
            </label>

            <label className="block space-y-1 text-sm">
              <span>Repository URL (HTTPS)</span>
              <input
                type="url"
                value={form.repository_url}
                onChange={(event) =>
                  updateField("repository_url", event.target.value)
                }
                placeholder="https://github.com/..."
                className={inputClass}
              />
            </label>

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={busy}
                className={buttonClass}
              >
                {busy ? "Saving..." : "Save Project"}
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                disabled={busy}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm"
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading projects...</p>
      ) : projects.length === 0 ? (
        <section className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <p className="font-medium">No projects yet</p>
          <p className="mt-2 text-sm text-slate-500">
            Create your first project to track milestones and deadlines.
          </p>
        </section>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {projects.map((project) => {
            const repository = safeRepositoryUrl(project.repository_url);

            return (
              <article
                key={project.id}
                className="space-y-4 rounded-xl border border-slate-200 bg-white p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900">
                      {project.title}
                    </h2>
                    <p className="text-xs capitalize text-slate-500">
                      {project.project_type} ?{" "}
                      {project.status.replaceAll("_", " ")}
                    </p>
                  </div>
                </div>

                {project.description && (
                  <p className="whitespace-pre-wrap text-sm text-slate-600">
                    {project.description}
                  </p>
                )}

                <div>
                  <div className="mb-2 flex justify-between text-sm">
                    <span>Progress</span>
                    <span className="font-semibold">
                      {project.progress}%
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-indigo-600"
                      style={{ width: `${project.progress}%` }}
                    />
                  </div>
                </div>

                <div className="grid gap-2 text-xs text-slate-500 sm:grid-cols-2">
                  <p>Start: {formatDate(project.start_date)}</p>
                  <p>Due: {formatDate(project.due_date)}</p>
                </div>

                {project.technologies?.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {project.technologies.map((technology) => (
                      <span
                        key={technology}
                        className="rounded-full bg-indigo-50 px-3 py-1 text-xs text-indigo-700"
                      >
                        {technology}
                      </span>
                    ))}
                  </div>
                )}

                {repository && (
                  <a
                    href={repository}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block text-sm text-indigo-700 underline"
                  >
                    View Repository
                  </a>
                )}

                <div className="flex gap-3 border-t border-slate-100 pt-3">
                  <button
                    type="button"
                    onClick={() => startEdit(project)}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteProject(project)}
                    disabled={busy}
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
