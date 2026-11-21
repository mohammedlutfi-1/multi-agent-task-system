"use client";

import { useEffect, useRef, useState } from "react";
import {
  BrainCircuit,
  Plus,
  MessageSquare,
  Trash2,
  Send,
  Loader2,
  Copy,
  BookOpen,
  FileText,
  Sparkles,
  AlertCircle,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import AIResponse from "@/components/AIResponse";

type Subject = {
  id: string;
  name: string;
};

type DocumentItem = {
  id: string;
  title: string;
};

type Chat = {
  id: string;
  title: string;
  subject_id: string | null;
  updated_at: string;
};

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  provider?: string | null;
  model_id?: string | null;
};

type Usage = {
  daily_limit: number;
  calls_remaining: number;
  calls_used: number;
};

const BASE = "/student/ai/chats";

const SUGGESTIONS = [
  "Explain a difficult concept with examples",
  "Help me prepare a 10-mark exam answer",
  "Solve a numerical problem step by step",
  "Quiz me on my selected subject",
];

export default function AITutorPage() {
  const [supabase] = useState(() => createClient());

  const [chats, setChats] = useState<Chat[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [activeChat, setActiveChat] = useState<Chat | null>(null);
  const [subjectId, setSubjectId] = useState("");
  const [documentId, setDocumentId] = useState("");
  const [question, setQuestion] = useState("");
  const [usage, setUsage] = useState<Usage | null>(null);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [acceptAI, setAcceptAI] = useState(false);
  const [personalKeys, setPersonalKeys] = useState(false);
  const [acceptCharges, setAcceptCharges] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const [pendingQuestion, setPendingQuestion] = useState("");

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const operationLock = useRef(false);

  async function request(
    path: string,
    method = "GET",
    body?: unknown,
    timeout = 30000
  ) {
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
        ...(body !== undefined
          ? { "Content-Type": "application/json" }
          : {}),
      },
      body: body !== undefined
        ? JSON.stringify(body)
        : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(timeout),
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        typeof result.detail === "string"
          ? result.detail
          : `Request failed (${response.status}).`
      );
    }

    return result;
  }

  function errorText(err: unknown) {
    return err instanceof Error
      ? err.message
      : "Something went wrong.";
  }

  async function refreshChats() {
    const data = await request(BASE);
    setChats(data.chats || []);
  }

  async function refreshUsage() {
    try {
      const data = await request("/student/ai/usage");
      setUsage(data);
    } catch {
      setUsage(null);
    }
  }

  useEffect(() => {
    async function initialize() {
      try {
        const { data, error } = await supabase.auth.getUser();

        if (error || !data.user) {
          window.location.href = "/";
          return;
        }

        const [subjectResult, documentResult] =
          await Promise.all([
            supabase
              .from("student_subjects")
              .select("id,name")
              .eq("user_id", data.user.id)
              .order("name"),

            supabase
              .from("student_documents")
              .select("id,title")
              .eq("user_id", data.user.id)
              .order("created_at", { ascending: false }),
          ]);

        if (subjectResult.error) throw subjectResult.error;
        if (documentResult.error) throw documentResult.error;

        setSubjects(subjectResult.data || []);
        setDocuments(documentResult.data || []);

        await Promise.all([
          refreshChats(),
          refreshUsage(),
        ]);

      } catch (err) {
        setError(errorText(err));
      } finally {
        setLoading(false);
      }
    }

    void initialize();
  }, [supabase]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({
      behavior: "auto",
      block: "nearest",
    });
  }, [messages, sending]);

  function newConversation() {
    if (operationLock.current) return;

    setActiveChat(null);
    setMessages([]);
    setSubjectId("");
    setDocumentId("");
    setQuestion("");
    setError("");
    inputRef.current?.focus();
  }

  async function openConversation(chat: Chat) {
    if (operationLock.current) return;

    operationLock.current = true;
    setBusy(true);
    setError("");

    try {
      const data = await request(`${BASE}/${chat.id}`);

      setActiveChat(data.chat);
      setMessages(data.messages || []);
      setSubjectId(data.chat.subject_id || "");
      setDocumentId("");
      setQuestion("");

    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
      operationLock.current = false;
    }
  }

  async function deleteConversation(chat: Chat) {
    if (operationLock.current) return;

    if (!window.confirm("Delete this conversation permanently?")) {
      return;
    }

    operationLock.current = true;
    setBusy(true);
    setError("");

    try {
      await request(`${BASE}/${chat.id}`, "DELETE");

      setChats(previous =>
        previous.filter(item => item.id !== chat.id)
      );

      if (activeChat?.id === chat.id) {
        setActiveChat(null);
        setMessages([]);
        setQuestion("");
        setSubjectId("");
        setDocumentId("");
      }

    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
      operationLock.current = false;
    }
  }

  async function sendQuestion() {
    const text = question.trim();

    if (!text || operationLock.current) return;

    if (!acceptAI) {
      setError("Accept external AI processing before continuing.");
      return;
    }

    if (personalKeys && !acceptCharges) {
      setError("Accept potential provider charges first.");
      return;
    }

    if (usage && usage.calls_remaining <= 0) {
      setError("Daily Student AI allowance exhausted.");
      return;
    }

    operationLock.current = true;
    setSending(true);
    setPendingQuestion(text);
    setError("");

    let chat = activeChat;

    try {
      if (!chat) {
        const created = await request(BASE, "POST", {
          title: "New conversation",
          subject_id: subjectId || null,
        });

        chat = created.chat as Chat;
        setActiveChat(chat);
        setChats(previous => [chat!, ...previous]);
      }

      const result = await request(
        `${BASE}/${chat.id}/messages`,
        "POST",
        {
          question: text,
          document_id: documentId || null,
          accept_ai_processing: acceptAI,
          use_personal_keys: personalKeys,
          accept_provider_charges:
            personalKeys && acceptCharges,
        },
        240000
      );

      setMessages(previous => [
        ...previous,
        ...(result.messages || []),
      ]);

      setActiveChat(result.chat || chat);
      setQuestion("");

      setUsage({
        daily_limit: result.daily_limit,
        calls_remaining: result.calls_remaining,
        calls_used:
          result.daily_limit - result.calls_remaining,
      });

      await refreshChats().catch(() => {
        setError("Answer saved. Conversation list could not refresh.");
      });

    } catch (err) {
      setError(
        `${errorText(err)} Check conversation history before retrying.`
      );

      if (chat) {
        try {
          const data = await request(`${BASE}/${chat.id}`);
          setMessages(data.messages || []);
          setActiveChat(data.chat);
        } catch {
          // Preserve the existing conversation on refresh failure.
        }
      }

      await refreshUsage();

    } finally {
      setPendingQuestion("");
      setSending(false);
      operationLock.current = false;
    }
  }

  async function copyMessage(message: Message) {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(message.id);

      window.setTimeout(() => {
        setCopied(current =>
          current === message.id ? "" : current
        );
      }, 2000);

    } catch {
      setError("Unable to copy the answer.");
    }
  }

  const locked = busy || sending;

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="mr-3 h-6 w-6 animate-spin text-indigo-600" />
        Loading AI Tutor...
      </div>
    );
  }

  return (
    <div className="space-y-5 p-4 text-slate-800 md:p-6">

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <BrainCircuit className="h-8 w-8 text-indigo-600" />
            <h1 className="text-2xl font-bold">AI Tutor</h1>
          </div>
          <p className="mt-2 text-sm text-slate-500">
            Your personalised academic learning assistant.
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <p className="text-xs font-medium text-slate-500">
            Daily AI allowance
          </p>
          <p className="text-lg font-bold text-indigo-600">
            {usage
              ? `${usage.calls_remaining} / ${usage.daily_limit}`
              : "Unavailable"}
          </p>
          <p className="text-xs text-slate-500">Calls remaining</p>
        </div>
      </div>

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError("")}>Dismiss</button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">

        <aside className="rounded-xl border border-slate-200 bg-white p-4">

          <button
            disabled={locked}
            onClick={newConversation}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            New conversation
          </button>

          <h2 className="mb-3 mt-6 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Conversation history
          </h2>

          <div className="max-h-[320px] space-y-2 overflow-y-auto lg:max-h-[600px]">

            {chats.length === 0 && (
              <p className="py-4 text-center text-sm text-slate-400">
                No conversations yet.
              </p>
            )}

            {chats.map(chat => (
              <div
                key={chat.id}
                className={`flex items-center rounded-lg border ${
                  activeChat?.id === chat.id
                    ? "border-indigo-200 bg-indigo-50"
                    : "border-transparent hover:bg-slate-50"
                }`}
              >
                <button
                  disabled={locked}
                  onClick={() => void openConversation(chat)}
                  className="flex min-w-0 flex-1 items-center gap-2 p-3 text-left text-sm"
                >
                  <MessageSquare className="h-4 w-4 shrink-0 text-indigo-500" />
                  <span className="truncate">{chat.title}</span>
                </button>

                <button
                  title="Delete conversation"
                  aria-label={`Delete ${chat.title}`}
                  disabled={locked}
                  onClick={() => void deleteConversation(chat)}
                  className="p-3 text-slate-400 hover:text-red-600 disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </aside>

        <section className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white">

          <div className="border-b border-slate-200 p-4">

            <h2 className="mb-4 truncate font-semibold">
              {activeChat?.title || "New conversation"}
            </h2>

            <div className="grid gap-3 sm:grid-cols-2">

              <label className="space-y-2 text-sm">
                <span className="flex items-center gap-2 font-medium">
                  <BookOpen className="h-4 w-4 text-indigo-600" />
                  Subject
                </span>
                <select
                  value={subjectId}
                  disabled={locked || !!activeChat}
                  onChange={e => setSubjectId(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white p-2.5 disabled:bg-slate-100"
                >
                  <option value="">General academic help</option>
                  {subjects.map(subject => (
                    <option key={subject.id} value={subject.id}>
                      {subject.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-2 text-sm">
                <span className="flex items-center gap-2 font-medium">
                  <FileText className="h-4 w-4 text-indigo-600" />
                  Reference document
                </span>
                <select
                  value={documentId}
                  disabled={locked}
                  onChange={e => setDocumentId(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white p-2.5"
                >
                  <option value="">No document selected</option>
                  {documents.map(document => (
                    <option key={document.id} value={document.id}>
                      {document.title}
                    </option>
                  ))}
                </select>
              </label>

            </div>
          </div>

          <div className="h-[480px] space-y-5 overflow-y-auto p-4 md:p-6">

            {messages.length === 0 && !sending && (
              <div className="mx-auto max-w-lg py-12 text-center">

                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-50">
                  <BrainCircuit className="h-9 w-9 text-indigo-600" />
                </div>

                <h2 className="text-xl font-bold">
                  What would you like to learn?
                </h2>

                <p className="mt-2 text-sm text-slate-500">
                  Ask questions, understand concepts and
                  prepare for your examinations.
                </p>

                <div className="mt-6 grid gap-3 sm:grid-cols-2">
                  {SUGGESTIONS.map(suggestion => (
                    <button
                      key={suggestion}
                      disabled={locked}
                      onClick={() => {
                        setQuestion(suggestion);
                        inputRef.current?.focus();
                      }}
                      className="rounded-xl border border-slate-200 p-3 text-left text-sm hover:border-indigo-300 hover:bg-indigo-50"
                    >
                      <Sparkles className="mb-2 h-4 w-4 text-indigo-500" />
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((message, index) => (
              <div
                key={message.id || index}
                className={`flex ${
                  message.role === "user"
                    ? "justify-end"
                    : "justify-start"
                }`}
              >
                {message.role === "user" ? (
                  <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-indigo-600 px-4 py-3 text-sm text-white">
                    {message.content}
                  </div>
                ) : (
                  <div className="w-full min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-4">

                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <span className="flex items-center gap-2 text-sm font-semibold text-indigo-700">
                        <BrainCircuit className="h-4 w-4" />
                        AI Tutor
                      </span>

                      <button
                        onClick={() => void copyMessage(message)}
                        className="flex items-center gap-1 text-xs text-slate-500 hover:text-indigo-600"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        {copied === message.id ? "Copied" : "Copy"}
                      </button>
                    </div>

                    <AIResponse content={message.content} />

                    {message.provider && (
                      <p className="mt-4 border-t border-slate-200 pt-2 text-xs text-slate-400">
                        Generated by {message.provider}
                      </p>
                    )}

                  </div>
                )}
              </div>
            ))}

            {sending && (
              <>
                <div className="flex justify-end">
                  <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl bg-indigo-600 px-4 py-3 text-sm text-white">
                    {pendingQuestion}
                  </div>
                </div>
                <div className="flex items-center gap-3 rounded-xl bg-indigo-50 p-4 text-sm text-indigo-700">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  AI Tutor is preparing your answer...
                </div>
              </>
            )}

            <div ref={bottomRef} />
          </div>

          <div className="space-y-3 border-t border-slate-200 p-4">

            <label className="flex items-start gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={acceptAI}
                disabled={locked}
                onChange={e => setAcceptAI(e.target.checked)}
                className="mt-0.5 accent-indigo-600"
              />
              I accept external AI processing of my question,
              conversation history and selected document.
            </label>

            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={personalKeys}
                disabled={locked}
                onChange={e => {
                  setPersonalKeys(e.target.checked);
                  setAcceptCharges(false);
                }}
                className="accent-indigo-600"
              />
              Use my personal API keys
            </label>

            {personalKeys && (
              <label className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
                <input
                  type="checkbox"
                  checked={acceptCharges}
                  disabled={locked}
                  onChange={e => setAcceptCharges(e.target.checked)}
                  className="accent-indigo-600"
                />
                I understand that my AI provider may charge
                for requests made using personal API keys.
              </label>
            )}

            <div className="flex items-end gap-3">

              <textarea
                ref={inputRef}
                value={question}
                disabled={locked}
                maxLength={5000}
                rows={3}
                onChange={e => setQuestion(e.target.value)}
                onKeyDown={e => {
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    void sendQuestion();
                  }
                }}
                placeholder="Ask your AI Tutor a question..."
                className="min-w-0 flex-1 resize-y rounded-xl border border-slate-300 p-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              />

              <button
                onClick={() => void sendQuestion()}
                disabled={
                  locked ||
                  !question.trim() ||
                  !acceptAI ||
                  (personalKeys && !acceptCharges) ||
                  (usage !== null && usage.calls_remaining <= 0)
                }
                className="flex h-12 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {sending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Send
              </button>

            </div>

            <div className="flex justify-between text-xs text-slate-400">
              <span>Enter to send. Shift + Enter for a new line.</span>
              <span>{question.length}/5000</span>
            </div>

            <p className="text-center text-xs text-slate-400">
              AI-generated answers may contain mistakes.
              Verify important academic information.
            </p>

          </div>
        </section>
      </div>
    </div>
  );
}