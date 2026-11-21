
"use client";

import { useEffect, useState } from "react";
import {
  Plus,
  NotebookPen,
  FolderOpen,
  Files,
  Pin,
  Search,
  Pencil,
  Trash2,
  X,
  Upload,
  FileText,
  Download,
  Sparkles,
  Loader2,
  Copy,
  BrainCircuit,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import AIResponse from "@/components/AIResponse";


type Subject = {
  id: string;
  name: string;
};

type Note = {
  id: string;
  subject_id: string | null;
  title: string;
  content: string;
  is_pinned: boolean;
  created_at: string;
  updated_at: string;
};

type AcademicDocument = {
  id: string;
  subject_id: string | null;
  title: string;
  file_name: string;
  storage_path: string;
  file_type: string | null;
  file_size: number;
  description: string | null;
  created_at: string;
};

type StudentAIUsage = {
  daily_limit: number;
  calls_used: number;
  calls_remaining: number;
  usage_date: string;
};

type GenerationType =
  | "summary"
  | "study_notes"
  | "important_qa"
  | "exam_answers"
  | "revision"
  | "mcq";

const GENERATION_OPTIONS: {
  value: GenerationType;
  label: string;
  description: string;
}[] = [
  {
    value: "summary",
    label: "Document Summary",
    description: "Structured overview and key concepts",
  },
  {
    value: "study_notes",
    label: "Detailed Study Notes",
    description: "Topic-wise explanations and definitions",
  },
  {
    value: "important_qa",
    label: "Important Questions & Answers",
    description: "Exam-oriented practice questions and answers",
  },
  {
    value: "exam_answers",
    label: "Mark-based Answers",
    description: "2, 5 and 10-mark questions with answers",
  },
  {
    value: "revision",
    label: "Quick Revision",
    description: "Important concepts, formulas and revision points",
  },
  {
    value: "mcq",
    label: "Practice MCQs",
    description: "Multiple-choice questions with answer key",
  },
];


type AISummaryResult = {
  status: string;
  document_id: string;
  title: string;
  generation_type: GenerationType;
  summary: string;
  chunks_processed: number;
  ai_calls: number;
  providers_used: string[];
  models_used: string[];
  calls_remaining: number;
  daily_limit: number;
};

const emptyForm = {
  title: "",
  subject_id: "",
  content: "",
  is_pinned: false,
};

const inputClass =
  "w-full rounded-xl border border-slate-200 bg-white px-4 py-3 outline-none focus:border-indigo-500";

export default function NotesPage() {
  const [tab, setTab] = useState<"notes" | "documents">("notes");
  const [notes, setNotes] = useState<Note[]>([]);
  const [documents, setDocuments] = useState<AcademicDocument[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [userId, setUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [subjectFilter, setSubjectFilter] = useState("all");
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [notePreview, setNotePreview] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [aiUsage, setAiUsage] =
    useState<StudentAIUsage | null>(null);

  const [showSummaryModal, setShowSummaryModal] =
    useState(false);

  const [generationType, setGenerationType] =
     useState<GenerationType>("summary");


  const [summaryDocument, setSummaryDocument] =
    useState<AcademicDocument | null>(null);

  const [summaryResult, setSummaryResult] =
    useState<AISummaryResult | null>(null);

  const [generatingSummary, setGeneratingSummary] =
    useState(false);

  const [summaryError, setSummaryError] = useState("");

  const [acceptDocumentProcessing, setAcceptDocumentProcessing] =
    useState(false);

  const [usePersonalKeys, setUsePersonalKeys] =
    useState(false);

  const [acceptProviderCharges, setAcceptProviderCharges] =
    useState(false);


const [selectedFile, setSelectedFile] = useState<File | null>(null);

const [documentForm, setDocumentForm] = useState({
  title: "",
  subject_id: "",
  description: "",
});

  async function loadData(uid: string) {
    const supabase = createClient();

    const [notesResult, documentsResult, subjectsResult] =
      await Promise.all([
        supabase
          .from("student_notes")
          .select("*")
          .eq("user_id", uid)
          .order("is_pinned", { ascending: false })
          .order("updated_at", { ascending: false }),

        supabase
          .from("student_documents")
          .select("*")
          .eq("user_id", uid)
          .order("created_at", { ascending: false }),

        supabase
          .from("student_subjects")
          .select("id, name")
          .eq("user_id", uid)
          .order("name"),
      ]);

    if (notesResult.error) {
      setError(notesResult.error.message);
    } else {
      setNotes(notesResult.data ?? []);
    }

    if (documentsResult.error) {
      setError(documentsResult.error.message);
    } else {
      setDocuments(documentsResult.data ?? []);
    }

    if (subjectsResult.error) {
      setError(subjectsResult.error.message);
    } else {
      setSubjects(subjectsResult.data ?? []);
    }
  }

  useEffect(() => {
    async function initialize() {
      try {
        const supabase = createClient();

        const { data, error } = await supabase.auth.getUser();

        if (error || !data.user) {
          window.location.replace("/");
          return;
        }

        setUserId(data.user.id);

await Promise.all([
  loadData(data.user.id),
  loadAIUsage(),
]);
      } catch {
        setError("Unable to load academic materials.");
      } finally {
        setLoading(false);
      }
    }

    void initialize();
  }, []);

  function subjectName(id: string | null) {
    return subjects.find((subject) => subject.id === id)?.name
      ?? "General";
  }

  function openAdd() {
    setEditingId(null);
    setForm({ ...emptyForm });
    setMessage("");
    setError("");
    setShowForm(true);
  }

  function openEdit(note: Note) {
    setEditingId(note.id);

    setForm({
      title: note.title,
      subject_id: note.subject_id ?? "",
      content: note.content,
      is_pinned: note.is_pinned,
    });

    setMessage("");
    setError("");
    setShowForm(true);
  }

  async function handleSave(
    event: React.FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    if (!userId || saving) return;

    if (!form.title.trim()) {
      setError("Note title is required.");
      return;
    }

    setSaving(true);
    setMessage("");
    setError("");

    try {
      const supabase = createClient();

      const payload = {
        user_id: userId,
        title: form.title.trim(),
        subject_id: form.subject_id || null,
        content: form.content.trim(),
        is_pinned: form.is_pinned,
      };

      const result = editingId
        ? await supabase
            .from("student_notes")
            .update(payload)
            .eq("id", editingId)
            .eq("user_id", userId)
            .select("id")
            .single()
        : await supabase
            .from("student_notes")
            .insert(payload)
            .select("id")
            .single();

      if (result.error) {
        throw result.error;
      }

      setShowForm(false);

      setMessage(
        editingId
          ? "Note updated successfully."
          : "Note created successfully."
      );

      await loadData(userId);
    } catch (err) {
      setError(
        err && typeof err === "object" && "message" in err
          ? String(err.message)
          : "Unable to save note."
      );
    } finally {
      setSaving(false);
    }
  }

  async function togglePin(note: Note) {
    if (!userId || saving) return;

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const supabase = createClient();

      const { error } = await supabase
        .from("student_notes")
        .update({ is_pinned: !note.is_pinned })
        .eq("id", note.id)
        .eq("user_id", userId)
        .select("id")
        .single();

      if (error) throw error;

      setMessage(
        note.is_pinned
          ? "Note unpinned."
          : "Note pinned successfully."
      );

      await loadData(userId);
    } catch {
      setError("Unable to update pinned status.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteNote(id: string) {
    if (!userId || saving) return;

    if (!window.confirm("Permanently delete this note?")) {
      return;
    }

    setSaving(true);
    setMessage("");
    setError("");

    try {
      const supabase = createClient();

      const { error } = await supabase
        .from("student_notes")
        .delete()
        .eq("id", id)
        .eq("user_id", userId)
        .select("id")
        .single();

      if (error) throw error;

      setMessage("Note deleted successfully.");
      await loadData(userId);
    } catch {
      setError("Unable to delete note.");
    } finally {
      setSaving(false);
    }
  }


  async function documentRequest(
  path: string,
  method = "GET",
  body?: FormData | string,
  timeout = 120000
) {
    const supabase = createClient();

    const { data, error } = await supabase.auth.getSession();

    if (error || !data.session) {
      throw new Error("Please sign in again.");
    }

    const apiUrl = (
      process.env.NEXT_PUBLIC_API_URL ||
      "http://localhost:8000"
    ).replace(/\/+$/, "");

    const response = await fetch(`${apiUrl}${path}`, {
      method,
      headers: {
  Authorization: `Bearer ${data.session.access_token}`,
  ...(typeof body === "string"
    ? { "Content-Type": "application/json" }
    : {}),
},
body,
cache: "no-store",
signal: AbortSignal.timeout(timeout),
    });

    if (!response.ok) {
      const result = await response.json().catch(() => null);

      throw new Error(
        typeof result?.detail === "string"
          ? result.detail
          : "Document operation failed."
      );
    }

    return response;
  }

  async function loadAIUsage() {
    try {
      const response = await documentRequest(
        "/student/ai/usage"
      );

      const result: StudentAIUsage = await response.json();

      setAiUsage(result);
    } catch {
      setAiUsage(null);
    }
  }

  function openSummaryModal(doc: AcademicDocument) {
    if (saving || generatingSummary) return;

    setSummaryDocument(doc);
    setGenerationType("summary");
    setSummaryResult(null);
    setSummaryError("");
    setAcceptDocumentProcessing(false);
    setUsePersonalKeys(false);
    setAcceptProviderCharges(false);
    setShowSummaryModal(true);

    void loadAIUsage();
  }

  async function generateSummary() {
    if (!summaryDocument || generatingSummary || saving) {
      return;
    }

    if (!acceptDocumentProcessing) {
      setSummaryError(
        "Please accept external AI document processing."
      );
      return;
    }

    if (usePersonalKeys && !acceptProviderCharges) {
      setSummaryError(
        "Please accept potential provider charges."
      );
      return;
    }

    if (aiUsage && aiUsage.calls_remaining < 2) {
      setSummaryError(
        "Insufficient daily Student AI quota."
      );
      return;
    }

    setGeneratingSummary(true);
    setSaving(true);
    setSummaryError("");
    setSummaryResult(null);

    try {
      const response = await documentRequest(
        `/student/ai/documents/${summaryDocument.id}/summarize`,
        "POST",

            JSON.stringify({
                generation_type: generationType,
                accept_document_processing: acceptDocumentProcessing,
                use_personal_keys: usePersonalKeys,
                accept_provider_charges:
                usePersonalKeys && acceptProviderCharges,
        }),

        360000
      );

      const result: AISummaryResult =
        await response.json();

      setSummaryResult(result);

    } catch (err) {
      setSummaryError(
        err instanceof Error
          ? err.message
          : "Unable to generate document summary."
      );
    } finally {
      await loadAIUsage();
      setGeneratingSummary(false);
      setSaving(false);
    }
  }

  async function copySummary() {
    if (!summaryResult) return;

    try {
      await navigator.clipboard.writeText(
        summaryResult.summary
      );

      setSummaryError("");
      setMessage("Academic material copied successfully.");
      window.alert("Academic material copied to clipboard.");
    } catch {
      setSummaryError("Unable to copy summary.");
    }
  }

  async function saveSummaryAsNote() {
    if (
      !summaryResult ||
      !summaryDocument ||
      !userId ||
      saving
    ) return;

    setSaving(true);
    setSummaryError("");

    try {
      const supabase = createClient();

      const { error } = await supabase
        .from("student_notes")
        .insert({
          user_id: userId,
          subject_id: summaryDocument.subject_id,
          title: `${
  GENERATION_OPTIONS.find(
    (option) =>
      option.value === summaryResult.generation_type
  )?.label || "AI Summary"
} - ${summaryDocument.title}`.slice(0, 250),
          content: summaryResult.summary,
          is_pinned: false,
        })
        .select("id")
        .single();

      if (error) throw error;

      setShowSummaryModal(false);
      setTab("notes");
      setSearch("");
      setSubjectFilter("all");
      setPinnedOnly(false);

      setMessage("AI academic material saved as a note successfully.");

      await loadData(userId);

    } catch {
      setSummaryError(
        "Unable to save summary as a note."
      );
    } finally {
      setSaving(false);
    }
  }

  function openUploadForm() {
    setDocumentForm({
      title: "",
      subject_id: "",
      description: "",
    });

    setSelectedFile(null);
    setError("");
    setMessage("");
    setShowUploadForm(true);
  }

  async function handleUpload(
    event: React.FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    if (!userId || saving) return;

    if (!selectedFile) {
      setError("Please select a document.");
      return;
    }

    if (selectedFile.size > 10 * 1024 * 1024) {
      setError("Maximum file size is 10 MB.");
      return;
    }

    if (!documentForm.title.trim()) {
      setError("Document title is required.");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const body = new FormData();

      body.append("file", selectedFile);
      body.append("title", documentForm.title.trim());
      body.append("subject_id", documentForm.subject_id);
      body.append("description", documentForm.description.trim());

      await documentRequest(
        "/student/documents/upload",
        "POST",
        body
      );

      setShowUploadForm(false);
      setSelectedFile(null);
      setSearch("");
      setSubjectFilter("all");

      setMessage("Document uploaded successfully.");

      await loadData(userId);

    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to upload document."
      );
    } finally {
      setSaving(false);
    }
  }

  async function deleteDocument(doc: AcademicDocument) {
    if (!userId || saving) return;

    if (!window.confirm(`Permanently delete "${doc.title}"?`)) {
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

    try {
      await documentRequest(
        `/student/documents/${doc.id}`,
        "DELETE"
      );

      setMessage("Document deleted successfully.");

      await loadData(userId);

    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to delete document."
      );
    } finally {
      setSaving(false);
    }
  }

  async function downloadDocument(doc: AcademicDocument) {
    if (saving) return;

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const response = await documentRequest(
        `/student/documents/${doc.id}/download`
      );

      const data = await response.blob();

      const url = URL.createObjectURL(data);
      const link = document.createElement("a");

      link.href = url;
      link.download = doc.file_name;

      document.body.appendChild(link);
      link.click();
      link.remove();

      setTimeout(() => URL.revokeObjectURL(url), 1000);

      setMessage("Document download started.");

    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to download document."
      );
    } finally {
      setSaving(false);
    }
  }

  function formatFileSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;

    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }

    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  const query = search.trim().toLowerCase();

  const filteredNotes = notes.filter((note) => {
    const matchesSearch =
      note.title.toLowerCase().includes(query) ||
      note.content.toLowerCase().includes(query) ||
      subjectName(note.subject_id).toLowerCase().includes(query);

    const matchesSubject =
      subjectFilter === "all" ||
      note.subject_id === subjectFilter;

    return (
      matchesSearch &&
      matchesSubject &&
      (!pinnedOnly || note.is_pinned)
    );
  });

  const filteredDocuments = documents.filter((doc) => {
    const matchesSearch =
      doc.title.toLowerCase().includes(query) ||
      doc.file_name.toLowerCase().includes(query) ||
      (doc.description ?? "").toLowerCase().includes(query) ||
      subjectName(doc.subject_id).toLowerCase().includes(query);

    return (
      matchesSearch &&
      (subjectFilter === "all" ||
        doc.subject_id === subjectFilter)
    );
  });

  const stats = [
    {
      label: "Total Notes",
      value: notes.length,
      icon: NotebookPen,
      color: "bg-indigo-50 text-indigo-600",
    },
    {
      label: "Total Documents",
      value: documents.length,
      icon: Files,
      color: "bg-emerald-50 text-emerald-600",
    },
    {
      label: "Pinned Notes",
      value: notes.filter((note) => note.is_pinned).length,
      icon: Pin,
      color: "bg-orange-50 text-orange-600",
    },
  ];

  if (loading) {
    return (
      <div className="p-8 text-slate-500">
        Loading academic materials...
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 p-6 text-slate-900 lg:p-8">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">
            Notes &amp; Documents
          </h1>

          <p className="mt-2 text-slate-500">
            Organize your learning materials and academic resources.
          </p>
        </div>

        {tab === "notes" ? (
          <button
            onClick={openAdd}
            disabled={!userId || saving}
            className="flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            <Plus size={20} />
            Create Note
          </button>
        ) : (
          <button
  onClick={openUploadForm}
  disabled={!userId || saving}
  className="flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-white hover:bg-indigo-700 disabled:opacity-50"
>
  <Upload size={20} />
  Upload Document
</button>
        )}
      </header>

      <div className="mb-6 flex gap-6 border-b border-slate-200">
        <button
          onClick={() => {
            setTab("notes");
            setSearch("");
          }}
          className={`flex items-center gap-2 px-3 pb-4 ${
            tab === "notes"
              ? "border-b-2 border-indigo-600 text-indigo-600"
              : "text-slate-500"
          }`}
        >
          <NotebookPen size={20} />
          My Notes
        </button>

        <button
          onClick={() => {
            setTab("documents");
            setSearch("");
          }}
          className={`flex items-center gap-2 px-3 pb-4 ${
            tab === "documents"
              ? "border-b-2 border-indigo-600 text-indigo-600"
              : "text-slate-500"
          }`}
        >
          <FolderOpen size={20} />
          My Documents
        </button>
      </div>


      {tab === "documents" && (
        <section className="mb-6 rounded-2xl border border-indigo-100 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-indigo-50 p-3">
                <BrainCircuit
                  size={25}
                  className="text-indigo-600"
                />
              </div>

              <div>
                <h2 className="font-semibold">
                  Student AI Usage
                </h2>

                <p className="mt-1 text-sm text-slate-500">
                  Daily AI processing allowance
                </p>
              </div>
            </div>

            {aiUsage && (
              <div className="text-right">
                <p className="text-xl font-bold text-indigo-600">
                  {aiUsage.calls_remaining} / {aiUsage.daily_limit}
                </p>
                <p className="text-xs text-slate-500">
                  AI calls remaining
                </p>
              </div>
            )}
          </div>

          {aiUsage ? (
            <>
              <div
                role="progressbar"
                aria-label="Daily AI usage"
                aria-valuemin={0}
                aria-valuemax={aiUsage.daily_limit}
                aria-valuenow={aiUsage.calls_used}
                className="mt-5 h-2 overflow-hidden rounded-full bg-slate-100"
              >
                <div
                  className={`h-full rounded-full transition-all ${
                    aiUsage.calls_remaining === 0
                      ? "bg-red-500"
                      : aiUsage.calls_remaining <= 5
                        ? "bg-amber-500"
                        : "bg-indigo-600"
                  }`}
                  style={{
                    width: `${Math.min(
                      100,
                      (aiUsage.calls_used /
                        Math.max(1, aiUsage.daily_limit)) *
                        100
                    )}%`,
                  }}
                />
              </div>

              <div className="mt-3 flex flex-wrap justify-between gap-2 text-xs text-slate-500">
                <span>
                  {aiUsage.calls_used} AI calls used today
                </span>

                <span>
                  Resets daily at 00:00 UTC
                </span>
              </div>

              {aiUsage.calls_remaining === 0 && (
                <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-600">
                  Daily Student AI limit reached.
                  Try again after the quota resets.
                </p>
              )}
            </>
          ) : (
            <p className="mt-4 text-sm text-slate-500">
              AI usage information is currently unavailable.
            </p>
          )}

          <button
            onClick={() => void loadAIUsage()}
            disabled={generatingSummary}
            className="mt-4 text-sm font-medium text-indigo-600 hover:text-indigo-800 disabled:opacity-50"
          >
            Refresh Usage
          </button>
        </section>
      )}

      {message && (
        <div className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-700">
          {message}
        </div>
      )}

      {error && !showForm && (
        <div role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
          {error}
        </div>
      )}

      <section className="mb-8 grid gap-4 md:grid-cols-3">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-500">
                {stat.label}
              </span>

              <div className={`rounded-xl p-3 ${stat.color}`}>
                <stat.icon size={23} />
              </div>
            </div>

            <p className="mt-4 text-3xl font-bold">
              {stat.value}
            </p>
          </div>
        ))}
      </section>

      <section className="mb-6 flex flex-wrap gap-3 rounded-2xl border border-slate-200 bg-white p-4">
        <div className="relative min-w-48 flex-1">
          <Search
            size={20}
            className="absolute left-3 top-3.5 text-slate-400"
          />

          <input
            aria-label="Search academic materials"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={
              tab === "notes"
                ? "Search notes..."
                : "Search documents..."
            }
            className={`${inputClass} pl-10`}
          />
        </div>

        <select
          aria-label="Filter by subject"
          value={subjectFilter}
          onChange={(e) => setSubjectFilter(e.target.value)}
          className="rounded-xl border border-slate-200 px-4 py-3"
        >
          <option value="all">All subjects</option>

          {subjects.map((subject) => (
            <option key={subject.id} value={subject.id}>
              {subject.name}
            </option>
          ))}
        </select>

        {tab === "notes" && (
          <button
            onClick={() => setPinnedOnly(!pinnedOnly)}
            className={`flex items-center gap-2 rounded-xl px-4 py-3 ${
              pinnedOnly
                ? "bg-indigo-100 text-indigo-700"
                : "bg-slate-100 text-slate-600"
            }`}
          >
            <Pin size={17} />
            Pinned Only
          </button>
        )}
      </section>

      {tab === "notes" ? (
        filteredNotes.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center">
            <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-indigo-50">
              <NotebookPen
                size={36}
                className="text-indigo-500"
              />
            </div>

            <h2 className="text-xl font-semibold">
              {notes.length === 0
                ? "No notes created yet"
                : "No matching notes"}
            </h2>

            <p className="mt-2 text-slate-500">
              {notes.length === 0
                ? "Create and organize your academic notes."
                : "Try changing your search or filters."}
            </p>

            {notes.length === 0 && (
              <button
                onClick={openAdd}
                disabled={!userId || saving}
                className="mt-6 rounded-xl bg-indigo-600 px-5 py-3 text-white disabled:opacity-50"
              >
                Create Your First Note
              </button>
            )}
          </div>
        ) : (
          <section className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
            {filteredNotes.map((note) => (
              <article
                key={note.id}
                className="flex flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <NotebookPen
                    size={25}
                    className="shrink-0 text-indigo-500"
                  />

                  <div className="min-w-0 flex-1">
                    <h2 className="break-words text-lg font-semibold">
                      {note.title}
                    </h2>

                    <p className="mt-1 text-sm text-slate-500">
                      {subjectName(note.subject_id)}
                    </p>
                  </div>

                  <button
                    aria-label={
                      note.is_pinned ? "Unpin note" : "Pin note"
                    }
                    title={
                      note.is_pinned ? "Unpin note" : "Pin note"
                    }
                    disabled={saving}
                    onClick={() => void togglePin(note)}
                    className={`rounded-lg p-2 ${
                      note.is_pinned
                        ? "bg-orange-50 text-orange-600"
                        : "text-slate-400 hover:bg-slate-100"
                    }`}
                  >
                    <Pin
                      size={19}
                      fill={note.is_pinned ? "currentColor" : "none"}
                    />
                  </button>
                </div>

                <p className="mt-5 line-clamp-5 flex-1 whitespace-pre-wrap break-words text-sm leading-6 text-slate-600">
                  {note.content || "No content"}
                </p>

                <p className="mt-5 text-xs text-slate-400">
                  Updated:{" "}
                  {new Date(note.updated_at).toLocaleDateString()}
                </p>

                <div className="mt-4 flex justify-between border-t border-slate-100 pt-4">
                  <button
                    disabled={saving}
                    onClick={() => openEdit(note)}
                    className="flex items-center gap-2 text-sm text-indigo-600"
                  >
                    <Pencil size={16} />
                    View / Edit
                  </button>

                  <button
                    disabled={saving}
                    onClick={() => void deleteNote(note.id)}
                    className="flex items-center gap-2 text-sm text-red-600"
                  >
                    <Trash2 size={16} />
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </section>
        )
      ) : (
        <>
          <div className="mb-5 rounded-xl border border-indigo-100 bg-indigo-50 p-4 text-sm text-indigo-700">
            Upload PDFs, Word documents, text files and images.
            Maximum file size: 10 MB per document.
        </div>

          {filteredDocuments.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center">
              <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-indigo-50">
                <FolderOpen
                  size={36}
                  className="text-indigo-500"
                />
              </div>

              <h2 className="text-xl font-semibold">
                {documents.length === 0
                  ? "No documents uploaded yet"
                  : "No matching documents"}
              </h2>

              <p className="mt-2 text-slate-500">
                Your academic PDFs, Word files and learning
                materials will appear here.
              </p>
            </div>
          ) : (
            <section className="grid gap-5 lg:grid-cols-2">
              {filteredDocuments.map((doc) => (
                <article
                  key={doc.id}
                  className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
                >
                  <div className="flex items-start gap-3">
                    <div className="rounded-xl bg-indigo-50 p-3">
                      <FileText className="text-indigo-600" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <h2 className="break-words font-semibold">
                        {doc.title}
                      </h2>

                      <p className="mt-1 break-all text-sm text-slate-500">
                        {doc.file_name}
                      </p>

                      <p className="mt-2 text-xs text-slate-400">
                        {formatFileSize(doc.file_size)}
                        {" · "}
                        {subjectName(doc.subject_id)}
                      </p>
                    </div>
                  </div>

                  {doc.description && (
                    <p className="mt-4 whitespace-pre-wrap break-words text-sm text-slate-600">
                      {doc.description}
                    </p>
                  )}


<div className="mt-5 space-y-4 border-t border-slate-100 pt-4">

  <button
    disabled={
      saving ||
      generatingSummary ||
      !/\.(pdf|docx|txt)$/i.test(doc.file_name) ||
      (aiUsage !== null && aiUsage.calls_remaining < 2)
    }
    onClick={() => openSummaryModal(doc)}
    className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
  >
    <Sparkles size={18} />
    Generate Academic Material
  </button>

  {!/\.(pdf|docx|txt)$/i.test(doc.file_name) && (
    <p className="text-xs text-slate-500">
      AI summarization currently supports PDF, DOCX
      and TXT documents.
    </p>
  )}

  <div className="flex items-center justify-between">

    <button
      disabled={saving}
      onClick={() => void downloadDocument(doc)}
      className="flex items-center gap-2 text-sm text-indigo-600 hover:text-indigo-800 disabled:opacity-50"
    >
      <Download size={17} />
      Download
    </button>

    <button
      disabled={saving}
      onClick={() => void deleteDocument(doc)}
      className="flex items-center gap-2 text-sm text-red-600 hover:text-red-800 disabled:opacity-50"
    >
      <Trash2 size={17} />
      Delete
    </button>

  </div>
</div>
                </article>
              ))}
            </section>
          )}
        </>
      )}

      {showSummaryModal && summaryDocument && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="summary-dialog-title"
            className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
          >
            <div className="mb-6 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-indigo-50 p-3">
                  <Sparkles
                    size={26}
                    className="text-indigo-600"
                  />
                </div>

                <div>
                  <h2
                    id="summary-dialog-title"
                    className="text-xl font-bold"
                  >
                    AI Academic Assistant
                  </h2>

                  <p className="mt-1 break-words text-sm text-slate-500">
                    {summaryDocument.title}
                  </p>
                </div>
              </div>

              <button
                aria-label="Close summary dialog"
                disabled={generatingSummary}
                onClick={() => setShowSummaryModal(false)}
                className="text-slate-400 hover:text-slate-700 disabled:opacity-50"
              >
                <X size={24} />
              </button>
            </div>

            {aiUsage && (
              <div className="mb-5 flex flex-wrap justify-between gap-2 rounded-xl bg-indigo-50 p-4 text-sm text-indigo-700">
                <span>Daily AI allowance</span>
                <strong>
                  {aiUsage.calls_remaining} / {aiUsage.daily_limit} calls remaining
                </strong>
              </div>
            )}

            {summaryError && (
              <div
                role="alert"
                className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-600"
              >
                {summaryError}
              </div>
            )}

            {!summaryResult && !generatingSummary && (
              <div className="space-y-5">
                <div className="space-y-3">
  <h3 className="text-sm font-semibold text-slate-900">
    What would you like to generate?
  </h3>

  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
    {GENERATION_OPTIONS.map((option) => (
      <button
        key={option.value}
        type="button"
        aria-pressed={generationType === option.value}
        disabled={generatingSummary || saving}
        onClick={() => {
          setGenerationType(option.value);
          setSummaryError("");
        }}
        className={`rounded-xl border p-4 text-left transition ${
          generationType === option.value
            ? "border-indigo-600 bg-indigo-50 ring-1 ring-indigo-600"
            : "border-slate-200 bg-white hover:border-indigo-300"
        } disabled:cursor-not-allowed disabled:opacity-50`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-slate-900">
            {option.label}
          </span>

          <span
            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
              generationType === option.value
                ? "border-indigo-600 bg-indigo-600"
                : "border-slate-300"
            }`}
          >
            {generationType === option.value && (
              <span className="h-1.5 w-1.5 rounded-full bg-white" />
            )}
          </span>
        </div>

        <p className="mt-2 text-xs leading-5 text-slate-500">
          {option.description}
        </p>
      </button>
    ))}
  </div>

  <p className="text-xs leading-5 text-slate-500">
    AI-generated academic material is based on extracted
    document content. Practice questions are not guaranteed
    examination questions.
  </p>
</div>

                <div className="rounded-xl border border-slate-200 p-5">
                  <h3 className="mb-4 font-semibold">
                    AI Provider Settings
                  </h3>

                  <label className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={usePersonalKeys}
                      onChange={(e) => {
                        setUsePersonalKeys(e.target.checked);
                        setAcceptProviderCharges(false);
                      }}
                      className="mt-1 h-4 w-4 accent-indigo-600"
                    />

                    <div>
                      <p className="text-sm font-medium">
                        Use my personal API keys
                      </p>

                      <p className="mt-1 text-xs text-slate-500">
                        Otherwise, configured platform AI providers
                        will be used.
                      </p>
                    </div>
                  </label>

                  {usePersonalKeys && (
                    <label className="mt-4 flex items-start gap-3 rounded-lg bg-amber-50 p-3">
                      <input
                        type="checkbox"
                        checked={acceptProviderCharges}
                        onChange={(e) =>
                          setAcceptProviderCharges(e.target.checked)
                        }
                        className="mt-1 h-4 w-4 accent-indigo-600"
                      />

                      <span className="text-sm text-amber-800">
                        I understand that my API provider may
                        charge me for processing this request.
                      </span>
                    </label>
                  )}
                </div>

                <label className="flex items-start gap-3 rounded-xl border border-indigo-100 bg-indigo-50 p-4">
                  <input
                    type="checkbox"
                    checked={acceptDocumentProcessing}
                    onChange={(e) =>
                      setAcceptDocumentProcessing(e.target.checked)
                    }
                    className="mt-1 h-4 w-4 accent-indigo-600"
                  />

                  <span className="text-sm leading-6 text-slate-700">
                    I consent to sending the extracted document
                    content to external AI providers for
                    academic material generation.
                  </span>
                </label>

                <p className="text-xs leading-5 text-slate-500">
                  Larger documents require multiple AI calls.
                  Reserved calls count toward your daily allowance,
                  even if processing fails.
                  AI-generated content may contain errors.
                </p>

                <div className="flex justify-end gap-3">
                  <button
                    onClick={() =>
                      setShowSummaryModal(false)
                    }
                    className="rounded-xl border border-slate-200 px-5 py-3"
                  >
                    Cancel
                  </button>

                  <button
                    disabled={
                      !acceptDocumentProcessing ||
                      (usePersonalKeys && !acceptProviderCharges) ||
                      (aiUsage !== null &&
                        aiUsage.calls_remaining < 2)
                    }
                    onClick={() => void generateSummary()}
                    className="flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Sparkles size={18} />
                    Generate Material
                  </button>
                </div>
              </div>
            )}

            {generatingSummary && (
              <div
                role="status"
                className="py-16 text-center"
              >
                <Loader2
                  size={48}
                  className="mx-auto mb-5 animate-spin text-indigo-600"
                />

                <h3 className="text-xl font-semibold">
                  Generating academic material...
                </h3>

                <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-slate-500">
                  AI is analyzing your document, identifying
                  important academic concepts and preparing
                  structured revision material.
                </p>

                <p className="mt-4 text-xs text-slate-400">
                  Large documents may take several minutes.
                  Please keep this page open.
                </p>
              </div>
            )}

            {summaryResult && !generatingSummary && (
              <div className="space-y-5">
                <div className="grid grid-cols-2 gap-3 rounded-xl bg-emerald-50 p-4 md:grid-cols-3">
                  <div>
                    <p className="text-xs text-slate-500">
                      Sections processed
                    </p>
                    <p className="text-xl font-bold text-emerald-700">
                      {summaryResult.chunks_processed}
                    </p>
                  </div>

                  <div>
                    <p className="text-xs text-slate-500">
                      AI calls used
                    </p>
                    <p className="text-xl font-bold text-emerald-700">
                      {summaryResult.ai_calls}
                    </p>
                  </div>

                  <div>
                    <p className="text-xs text-slate-500">
                      Calls remaining
                    </p>
                    <p className="text-xl font-bold text-emerald-700">
                      {summaryResult.calls_remaining}
                    </p>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 p-5">
                  <h3 className="mb-4 text-lg font-semibold">
                    Generated Academic Material
                  </h3>

                  <div className="whitespace-pre-wrap break-words text-sm leading-7 text-slate-700">
                    <AIResponse content={summaryResult.summary} />
                  </div>
                </div>

                <div className="text-xs text-slate-500">
                  AI providers:{" "}
                  {summaryResult.providers_used.join(", ")}
                </div>


<div className="flex flex-wrap justify-end gap-3">

  <button
    disabled={saving}
    onClick={() => void copySummary()}
    className="flex items-center gap-2 rounded-xl border border-slate-200 px-5 py-3 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
  >
    <Copy size={18} />
    Copy Content
  </button>

  <button
    disabled={saving}
    onClick={() => void saveSummaryAsNote()}
    className="flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-white hover:bg-indigo-700 disabled:opacity-50"
  >
    <NotebookPen size={18} />
    {saving ? "Saving..." : "Save as Note"}
  </button>

  <button
    disabled={saving}
    onClick={() => setShowSummaryModal(false)}
    className="rounded-xl border border-slate-200 px-5 py-3 text-slate-700"
  >
    Close
  </button>

</div>

              </div>
            )}
          </div>
        </div>
      )}

      {showUploadForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="upload-form-title"
            className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
          >
            <div className="mb-6 flex items-center justify-between">
              <h2 id="upload-form-title" className="text-xl font-bold">
                Upload Document
              </h2>

              <button
                aria-label="Close upload form"
                disabled={saving}
                onClick={() => setShowUploadForm(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X size={24} />
              </button>
            </div>

            {error && (
              <div
                role="alert"
                className="mb-4 rounded-lg bg-red-50 p-3 text-red-600"
              >
                {error}
              </div>
            )}

            <form onSubmit={handleUpload} className="space-y-5">
              <label className="block">
                <span className="mb-2 block text-sm font-medium">
                  Select Document *
                </span>

                <div className="rounded-xl border-2 border-dashed border-indigo-200 bg-indigo-50/50 p-6 text-center">
                  <Upload
                    size={32}
                    className="mx-auto mb-3 text-indigo-500"
                  />

                  <input
                    type="file"
                    required
                    disabled={saving}
                    accept=".pdf,.docx,.txt,.jpg,.jpeg,.png"
                    onChange={(e) => {
                      const file = e.target.files?.[0] ?? null;

                      setSelectedFile(file);

                      if (file) {
                        setDocumentForm((previous) => ({
                          ...previous,
                          title: previous.title ||
                            file.name.replace(/\.[^.]+$/, "").slice(0, 200),
                        }));
                      }
                    }}
                    className="w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-100 file:px-4 file:py-2 file:text-indigo-700"
                  />

                  <p className="mt-3 text-xs text-slate-500">
                    PDF, DOCX, TXT, JPG and PNG. Maximum 10 MB.
                  </p>

                  {selectedFile && (
                    <p className="mt-3 break-all text-sm font-medium text-indigo-700">
                      {selectedFile.name} — {formatFileSize(selectedFile.size)}
                    </p>
                  )}
                </div>
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium">
                  Document Title *
                </span>

                <input
                  required
                  disabled={saving}
                  maxLength={200}
                  value={documentForm.title}
                  onChange={(e) =>
                    setDocumentForm({
                      ...documentForm,
                      title: e.target.value,
                    })
                  }
                  placeholder="Example: IoT Module 1 Notes"
                  className={inputClass}
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium">
                  Subject
                </span>

                <select
                  disabled={saving}
                  value={documentForm.subject_id}
                  onChange={(e) =>
                    setDocumentForm({
                      ...documentForm,
                      subject_id: e.target.value,
                    })
                  }
                  className={inputClass}
                >
                  <option value="">General Document</option>

                  {subjects.map((subject) => (
                    <option key={subject.id} value={subject.id}>
                      {subject.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium">
                  Description (Optional)
                </span>

                <textarea
                  rows={4}
                  disabled={saving}
                  maxLength={2000}
                  value={documentForm.description}
                  onChange={(e) =>
                    setDocumentForm({
                      ...documentForm,
                      description: e.target.value,
                    })
                  }
                  placeholder="Add details about this document..."
                  className={inputClass}
                />
              </label>

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setShowUploadForm(false)}
                  className="rounded-xl border border-slate-200 px-5 py-3"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={saving || !selectedFile}
                  className="flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  <Upload size={18} />
                  {saving ? "Uploading..." : "Upload Document"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="note-form-title"
            className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
          >
            <div className="mb-6 flex items-center justify-between">
              <h2
                id="note-form-title"
                className="text-xl font-bold"
              >
                {editingId ? "View / Edit Note" : "Create Note"}
              </h2>

              <button
                aria-label="Close note editor"
                disabled={saving}
                onClick={() => setShowForm(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X size={24} />
              </button>
            </div>

            {error && (
              <div role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-red-600">
                {error}
              </div>
            )}

            <form onSubmit={handleSave} className="space-y-5">
              <label className="block">
                <span className="mb-2 block text-sm font-medium">
                  Note Title *
                </span>

                <input
                  required
                  maxLength={250}
                  value={form.title}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      title: e.target.value,
                    })
                  }
                  placeholder="Example: IoT Architecture"
                  className={inputClass}
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium">
                  Subject
                </span>

                <select
                  value={form.subject_id}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      subject_id: e.target.value,
                    })
                  }
                  className={inputClass}
                >
                  <option value="">General Note</option>

                  {subjects.map((subject) => (
                    <option key={subject.id} value={subject.id}>
                      {subject.name}
                    </option>
                  ))}
                </select>
              </label>


<div className="space-y-3">
  <div className="flex flex-wrap items-center justify-between gap-3">
    <span className="text-sm font-medium">
      Note Content
    </span>

    <div className="flex rounded-xl bg-slate-100 p-1">
      <button
        type="button"
        onClick={() => setNotePreview(false)}
        className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
          !notePreview
            ? "bg-white text-indigo-600 shadow-sm"
            : "text-slate-600 hover:text-indigo-600"
        }`}
      >
        Edit Note
      </button>

      <button
        type="button"
        onClick={() => setNotePreview(true)}
        className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
          notePreview
            ? "bg-white text-indigo-600 shadow-sm"
            : "text-slate-600 hover:text-indigo-600"
        }`}
      >
        Formatted Preview
      </button>
    </div>
  </div>

  {notePreview ? (
    <div className="min-h-[300px] max-h-[500px] overflow-y-auto rounded-xl border border-slate-200 bg-white p-5">
      {form.content.trim() ? (
        <AIResponse content={form.content} />
      ) : (
        <p className="text-sm text-slate-400">
          No note content to preview.
        </p>
      )}
    </div>
  ) : (
    <textarea
      aria-label="Note Content"
      rows={12}
      maxLength={50000}
      value={form.content}
      onChange={(e) =>
        setForm({
          ...form,
          content: e.target.value,
        })
      }
      className={inputClass}
      placeholder="Write or paste your academic notes here..."
    />
  )}
</div>

              <div className="text-right text-xs text-slate-400">
                {form.content.length.toLocaleString()} / 50,000 characters
              </div>

              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={form.is_pinned}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      is_pinned: e.target.checked,
                    })
                  }
                  className="h-4 w-4 accent-indigo-600"
                />

                <span className="text-sm">
                  Pin this note
                </span>
              </label>

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setShowForm(false)}
                  className="rounded-xl border border-slate-200 px-5 py-3"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-xl bg-indigo-600 px-5 py-3 text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {saving ? "Saving..." : "Save Note"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
