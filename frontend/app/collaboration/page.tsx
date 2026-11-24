"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { createClient } from "@/lib/supabase/client";

type Contribution = { turn: number; round: number; model: string; response: string };
type ModelUsage = { turn: number; requested_provider: string; provider: string; model: string };
type Result = {
  status: string;
  task: string;
  total_turns: number;
  discussion: Contribution[];
  model_usage: ModelUsage[];
  final_answer?: string;
  task_id?: string;
  requests_remaining?: number;
  retry_status?: string;
  selected_models?: string[];
  max_rounds?: number;
};
type HistoryTask = { id: string; task: string; status: string; created_at: string; final_answer: string | null };
type SavedTurn = { turn_number: number; round_number: number; requested_provider: string; actual_provider: string; model_id: string; response: string };
const API = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");
const names: Record<string,string> = {gemini:"Gemini 3.5 Flash-Lite",groq:"Groq GPT-OSS 20B",openrouter:"OpenRouter",ollama:"Ollama Qwen 2.5 1.5B"};
function isIndividualOllama(models?: string[]) {
  return models?.length === 1 && models[0] === "ollama";
}
async function request(path:string, init:RequestInit = {}) {
  const {data:{session},error} = await createClient().auth.getSession();
  if(error || !session?.access_token) throw new Error("Please sign in again.");
  const response = await fetch(`${API}${path}`, {...init, cache:"no-store", headers:{"Content-Type":"application/json",Authorization:`Bearer ${session.access_token}`}, signal:AbortSignal.timeout(init.method === "POST" ? 360000 : 30000)});
  const data = await response.json();
  if(!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : `Request failed (${response.status})`);
  return data;
}
export default function CollaborationPage(){
  const [task,setTask]=useState("");
  const [cloudSelection,setCloudSelection]=useState<string[]>(["gemini","groq"]);
  const ollamaEnabled = process.env.NEXT_PUBLIC_ENABLE_LOCAL_OLLAMA === "true";
  const availableCloudModels = ollamaEnabled
    ? ["gemini","groq","ollama"]
    : ["gemini","groq"];
  const [usePersonalKeys, setUsePersonalKeys] = useState(false);
  const [acceptProviderCharges, setAcceptProviderCharges] = useState(false);
  const [personalProviders, setPersonalProviders] = useState<string[]>([]);
  const [personalProvidersLoading, setPersonalProvidersLoading] = useState(false);
  const [personalProvidersError, setPersonalProvidersError] = useState("");
  const [result,setResult]=useState<Result|null>(null);
  const [history,setHistory]=useState<HistoryTask[]>([]);
  const [loading,setLoading]=useState(false);
  const submitting = useRef(false);
  const [historyLoading,setHistoryLoading]=useState(false);
  const [opening,setOpening]=useState<string|null>(null);
  const [active,setActive]=useState<string|null>(null);
  const [remaining,setRemaining]=useState<number|null>(null);
  const [error,setError]=useState("");
  const [historyError,setHistoryError]=useState("");
  const [menu,setMenu]=useState(false);
  const busy=loading || !!opening;
    const selectedProviders = usePersonalKeys
    ? personalProviders
    : cloudSelection;
  const individual = isIndividualOllama(selectedProviders);
  const validSelection = individual || (selectedProviders.length >= 2 && selectedProviders.length <= 4);
  const individualResult = result?.max_rounds === 1 && isIndividualOllama(result.selected_models);

  const personalModeBlocked =
    usePersonalKeys &&
    (
      personalProvidersLoading ||
      !!personalProvidersError ||
      personalProviders.length < 2 ||
      !acceptProviderCharges
    );
    const loadPersonalProviders = useCallback(async () => {
    setPersonalProvidersLoading(true);
    setPersonalProvidersError("");

    try {
      const data = await request("/ai/api-keys");

      if (!Array.isArray(data.keys)) {
        throw new Error("Invalid API key settings response.");
      }

      const activeProviders = data.keys
        .filter(
          (key: { provider: string; is_active: boolean }) =>
            key.is_active === true
        )
        .map(
          (key: { provider: string }) => key.provider
        );

      setPersonalProviders(
        ["gemini", "groq", "openrouter"].filter(
          (provider) => activeProviders.includes(provider)
        )
      );
    } catch {
      setPersonalProviders([]);
      setPersonalProvidersError(
        "Unable to load personal API providers."
      );
    } finally {
      setPersonalProvidersLoading(false);
    }
  }, []);

  useEffect(() => {
    if (usePersonalKeys) {
      void loadPersonalProviders();
    }
  }, [usePersonalKeys, loadPersonalProviders]);
  const loadHistory=useCallback(async()=>{
    setHistoryLoading(true);setHistoryError("");
    try{const data=await request("/ai/history");if(!Array.isArray(data.tasks))throw new Error("Invalid history response.");setHistory(data.tasks);}
    catch(e){setHistoryError(e instanceof Error?e.message:"History unavailable.");}
    finally{setHistoryLoading(false);}
  },[]);
    const loadUsage = useCallback(async () => {
    try {
      const data = await request("/ai/usage");

      if (typeof data.requests_remaining !== "number") {
        throw new Error("Invalid usage response.");
      }

      setRemaining(data.requests_remaining);
    } catch (e) {
      setRemaining(null);
      console.error("Unable to load daily usage:", e);
    }
  }, []);

  useEffect(() => {
    void loadHistory();
    void loadUsage();
  }, [loadHistory, loadUsage]);
  useEffect(() => {
  if (
    !active ||
    !result ||
    !["paused", "running", "pending"].includes(result.status) ||
    loading ||
    opening
  ) {
    return;
  }

  let cancelled = false;
  let timer: ReturnType<typeof setTimeout>;

  async function checkTaskStatus() {
    try {
      const data = await request(`/ai/history/${active}`);

      if (cancelled) return;

      if (!data.task || !Array.isArray(data.turns)) {
        throw new Error("Invalid saved collaboration.");
      }

      const turns: SavedTurn[] = data.turns;

      setResult({
        status: data.task.status,
        task: data.task.task,
        task_id: active!,
        selected_models: data.task.selected_models,
        max_rounds: data.task.max_rounds,
        total_turns: turns.length,

        discussion: turns.map(t => ({
          turn: t.turn_number,
          round: t.round_number,
          model: t.requested_provider,
          response: t.response,
        })),

        model_usage: turns.map(t => ({
          turn: t.turn_number,
          requested_provider: t.requested_provider,
          provider: t.actual_provider,
          model: t.model_id,
        })),

        final_answer: data.task.final_answer ?? undefined,
      retry_status: data.task.retry_status,
      });

      if (["completed", "failed"].includes(data.task.status)) {
        void loadHistory();
        return;
      }

    } catch {
      // Retry temporarily unavailable status checks.
    }

    if (!cancelled) {
      timer = setTimeout(checkTaskStatus, 30000);
    }
  }

  void checkTaskStatus();

  return () => {
    cancelled = true;
    clearTimeout(timer);
  };

}, [active, result?.status, loading, opening, loadHistory]);
  function startNew(){if(busy)return;setTask("");setResult(null);setActive(null);setError("");setMenu(false);}
  async function openSaved(id: string) {
  if (busy) return;

  setOpening(id);
  setError("");

  try {
    const data = await request(`/ai/history/${id}`);

    if (!data.task || !Array.isArray(data.turns)) {
      throw new Error("Invalid saved collaboration.");
    }

    const turns: SavedTurn[] = data.turns;

    setTask(data.task.task);
    setActive(id);
    setMenu(false);

    setResult({
      status: data.task.status,
      task: data.task.task,
      task_id: id,
      selected_models: data.task.selected_models,
      max_rounds: data.task.max_rounds,
      total_turns: turns.length,

      discussion: turns.map(t => ({
        turn: t.turn_number,
        round: t.round_number,
        model: t.requested_provider,
        response: t.response,
      })),

      model_usage: turns.map(t => ({
        turn: t.turn_number,
        requested_provider: t.requested_provider,
        provider: t.actual_provider,
        model: t.model_id,
      })),

      final_answer: data.task.final_answer ?? undefined,
      retry_status: data.task.retry_status,
    });

  } catch (e) {
    setError(
      e instanceof Error
        ? e.message
        : "Unable to open history."
    );
  } finally {
    setOpening(null);
  }
}
  async function generate(){
    if (submitting.current || busy || !task.trim()) return;
    if (!validSelection) {
      setError("Choose at least two models for collaboration, or use Ollama independently.");
      return;
    }

    if (usePersonalKeys && !acceptProviderCharges) {
      setError("Please accept potential provider charges.");
      return;
    }

    submitting.current = true;
    setLoading(true);
    setError("");
    setResult(null);
    setActive(null);
        try {
      const data: Result = await request("/ai/collaborate", {
        method: "POST",
        body: JSON.stringify({
          task: task.trim(),
          selected_models: selectedProviders,
          use_personal_keys: usePersonalKeys,
          accept_provider_charges:
            usePersonalKeys && acceptProviderCharges,
        }),
      });
      if (["paused", "running", "pending"].includes(data.status)) {
  if (!data.task_id) {
    throw new Error("Missing saved collaboration ID.");
  }

  setResult({
    status: data.status,
    task: task.trim(),
    task_id: data.task_id,
    selected_models: data.selected_models ?? selectedProviders,
    max_rounds: data.max_rounds ?? (individual ? 1 : 2),
    total_turns: data.total_turns ?? 0,
    discussion: data.discussion ?? [],
    model_usage: data.model_usage ?? [],
  });

  setActive(data.task_id);

  if (typeof data.requests_remaining === "number") {
    setRemaining(data.requests_remaining);
  }

  return;
}

if (
  data.status !== "completed" ||
  !Array.isArray(data.discussion) ||
  !Array.isArray(data.model_usage)
) {
  throw new Error("Incomplete collaboration response.");
}
      setResult({...data, selected_models: data.selected_models ?? selectedProviders, max_rounds: data.max_rounds ?? (individual ? 1 : 2)});setActive(data.task_id??null);if(typeof data.requests_remaining==="number")setRemaining(data.requests_remaining);
    }catch(e){setError(e instanceof Error?e.message:"Collaboration failed.");}finally {
  await Promise.all([loadHistory(), loadUsage()]);
  submitting.current = false;
  setLoading(false);
}
  }
  return <div className="min-h-screen bg-slate-50 text-slate-900">
    <aside className={`${menu?"flex":"hidden"} fixed inset-y-0 left-0 z-30 w-72 flex-col bg-[#101827] p-5 text-slate-200 lg:flex`}>
      <div className="flex items-center gap-3 pb-7"><div className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-600 text-xl text-white">✦</div><div><h1 className="font-bold text-white">MultiAgent AI</h1><p className="text-xs text-slate-400">Collaboration workspace</p></div><button onClick={()=>setMenu(false)} className="ml-auto lg:hidden" aria-label="Close menu">×</button></div>
      <Link href="/dashboard" className="rounded-lg px-3 py-3 text-sm hover:bg-slate-800">← Main Dashboard</Link>
      <button onClick={startNew} disabled={busy} className="my-3 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50">+ New Collaboration</button>
      <a href="#ai-models" onClick={()=>setMenu(false)} className="rounded-lg px-3 py-3 text-sm hover:bg-slate-800">◇ AI Models</a>
      <Link
  href="/collaboration/api-settings"
  className="rounded-lg px-3 py-3 text-sm hover:bg-slate-800"
>
  ⚙ API Settings
</Link>
      <a href="#usage" onClick={()=>setMenu(false)} className="rounded-lg px-3 py-3 text-sm hover:bg-slate-800">▥ Usage &amp; Limits</a>
      <div className="mt-5 flex items-center justify-between border-t border-slate-700 pt-5"><span className="text-xs font-semibold tracking-wide text-slate-400">RECENT COLLABORATIONS</span><button disabled={historyLoading||busy} onClick={()=>void loadHistory()} className="text-xs text-indigo-300 disabled:opacity-50">Refresh</button></div>
      <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto">
        {historyLoading&&<p className="text-xs text-slate-400">Loading history…</p>}{historyError&&<p className="text-xs text-rose-300">{historyError}</p>}{!historyLoading&&!historyError&&!history.length&&<p className="text-xs text-slate-400">No saved collaborations yet.</p>}
        {history.map(item=><button key={item.id} title={item.task} disabled={busy} onClick={()=>void openSaved(item.id)} className={`block w-full rounded-lg p-3 text-left hover:bg-slate-800 disabled:opacity-60 ${active===item.id?"bg-slate-700":""}`}><p className="truncate text-sm text-slate-100">{item.task}</p><p className="mt-1 text-xs capitalize text-slate-400">{opening===item.id?"Opening…":item.status}</p></button>)}
      </div>
      <div className="border-t border-slate-700 pt-4 text-sm text-slate-400">Settings · Coming soon</div>
    </aside>
    {menu&&<button aria-label="Close navigation" onClick={()=>setMenu(false)} className="fixed inset-0 z-20 bg-black/40 lg:hidden"/>}
    <main className="lg:ml-72">
      <header className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4 sm:px-8"><div className="flex items-center gap-3"><button onClick={()=>setMenu(true)} className="rounded-lg border px-3 py-1 lg:hidden" aria-label="Open menu">☰</button><span className="text-sm text-slate-500">Workspace / <strong className="text-slate-900">AI Collaboration</strong></span></div><span className="hidden text-xs text-slate-500 sm:block">Multi-model workspace</span></header>
      <div className="mx-auto max-w-5xl space-y-7 px-5 py-10 sm:px-8">
        <div className="py-4 text-center"><span className="text-xs font-bold tracking-widest text-indigo-600">MULTI-MODEL ENGINE</span><h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">What are we working on?</h2><p className="mt-3 text-sm text-slate-500">Multiple AI models. One collaborative solution.</p></div>
                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="mb-3 font-semibold">API usage mode</h3>

          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setUsePersonalKeys(false);
                setAcceptProviderCharges(false);
                setError("");
              }}
              className={`rounded-xl border p-4 text-left ${
                !usePersonalKeys
                  ? "border-indigo-500 bg-indigo-50"
                  : "border-slate-200"
              }`}
            >
              <p className="font-semibold">Platform API keys</p>
              <p className="mt-1 text-xs text-slate-500">
                Use the platform's configured AI providers.
              </p>
            </button>

            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setUsePersonalKeys(true);
                setAcceptProviderCharges(false);
                setError("");
              }}
              className={`rounded-xl border p-4 text-left ${
                usePersonalKeys
                  ? "border-indigo-500 bg-indigo-50"
                  : "border-slate-200"
              }`}
            >
              <p className="font-semibold">Personal API keys</p>
              <p className="mt-1 text-xs text-slate-500">
                Use your own configured provider keys.
              </p>
            </button>
          </div>

          {usePersonalKeys && (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
              <p className="mb-3 text-sm text-amber-900">
                At least two personal provider API keys are required.
                Your providers may charge you for API usage.
              </p>

              <label className="flex items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={acceptProviderCharges}
                  onChange={(e) =>
                    setAcceptProviderCharges(e.target.checked)
                  }
                  className="mt-1 h-4 w-4 accent-indigo-600"
                />
                I accept potential provider charges.
              </label>
                            <div className="mt-3 text-sm">
                {personalProvidersLoading ? (
                  <p className="text-slate-500">
                    Checking configured providers...
                  </p>
                ) : personalProvidersError ? (
                  <p className="text-red-600">
                    {personalProvidersError}
                  </p>
                ) : personalProviders.length < 2 ? (
                  <p className="text-amber-800">
                    {personalProviders.length} of 2 required
                    provider keys configured.
                    Please add more API keys.
                  </p>
                ) : (
                  <p className="text-green-700">
                    {personalProviders.length} providers configured.
                    API key validity is not yet verified.
                  </p>
                )}
              </div>

              <Link
                href="/collaboration/api-settings"
                className="mt-3 inline-block text-sm font-medium text-indigo-600"
              >
                Manage personal API keys
              </Link>
            </div>
          )}
        </section>

<section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
  <label htmlFor="task" className="sr-only">Your task</label><textarea id="task" rows={4} maxLength={5000} disabled={busy} value={task} onChange={e=>setTask(e.target.value)} placeholder="Ask a question, solve a problem, or plan a project…" className="w-full resize-y rounded-xl p-3 text-base outline-none focus:ring-2 focus:ring-indigo-100"/><div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4"><span className="rounded-md bg-slate-100 px-3 py-2 text-xs">{selectedProviders.length} AI models</span>{!individual && <span className="rounded-md bg-slate-100 px-3 py-2 text-xs">2 rounds</span>}<button onClick={()=>void generate()} disabled={busy || !task.trim() || !validSelection || personalModeBlocked} className="ml-auto rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">{individual ? "Generate Answer" : "Start Collaboration"}</button></div>{individual && <p className="mt-3 text-sm text-slate-500">Ollama will respond independently.</p>}{loading&&<p role="status" className="mt-3 text-sm text-indigo-600">{individual ? "Generating an answer…" : "Running AI discussion and final synthesis…"}</p>}{error&&<p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}</section>
        <section id="ai-models">
          <h3 className="mb-3 font-semibold">Your AI team</h3>
          <p className="mb-3 text-sm text-slate-500">
            Choose at least two models for collaboration, or use Ollama independently.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {(usePersonalKeys ? personalProviders : availableCloudModels).map(p => {
              const selected = selectedProviders.includes(p);
              return (
                <label key={p} className={`flex items-center gap-4 rounded-xl border bg-white p-4 ${
                  selected ? "border-indigo-500" : "border-slate-200"
                } ${usePersonalKeys ? "opacity-75" : "cursor-pointer"}`}>
                  <input
                    type="checkbox"
                    checked={selected}
                    disabled={busy || usePersonalKeys}
                    onChange={() => setCloudSelection(current =>
                      current.includes(p)
                        ? current.filter(item => item !== p)
                        : [...current, p]
                    )}
                    className="h-4 w-4 accent-indigo-600"
                    aria-label={`Select ${names[p]}`}
                  />
                  <div>
                    <h4 className="font-semibold">{names[p]}</h4>
                    {p === "ollama" && <p className="text-xs text-slate-500">Individual &amp; Collaboration</p>}
                    <p className="text-xs text-slate-500">
                      {selected ? "Selected participant" : "Available model"}
                    </p>
                  </div>
                </label>
              );
            })}
          </div>
        </section>
        {!result&&<section><h3 className="mb-3 font-semibold">Get started</h3><div className="grid gap-3 sm:grid-cols-3">{["Research a topic","Generate a project plan","Solve a problem"].map(p=><button key={p} disabled={busy} onClick={()=>setTask(p+": ")} className="rounded-xl border border-slate-200 bg-white p-4 text-left text-sm hover:border-indigo-400 disabled:opacity-50">{p} →</button>)}</div></section>}
        {result && result.status === "paused" && (
  <section
    role="status"
    className="rounded-xl border border-amber-200 bg-amber-50 p-5"
  >
    <h3 className="font-semibold text-amber-900">
      Collaboration paused
    </h3>

    <p className="mt-2 text-sm text-amber-800">
      Your task and completed work have been saved.
    </p>

    <p className="mt-1 text-sm text-amber-700">
  {result.retry_status === "waiting_for_capacity"
    ? "Task saved and waiting for capacity."
    : result.retry_status === "worker_disabled"
    ? "Automatic resumption is currently unavailable."
    : result.retry_status === "retry_limit_reached"
    ? "Automatic retry limit reached."
    : result.retry_status === "not_eligible"
    ? "Automatic retry is unavailable for this task."
    : result.retry_status === "not_scheduled"
    ? "No further automatic retries are scheduled."
    : "Checking automatic retry availability..."}
</p>
  </section>
)}

{result && ["running", "pending"].includes(result.status) && (
  <section
    role="status"
    className="rounded-xl border border-indigo-200 bg-indigo-50 p-5"
  >
    <div className="flex items-center gap-3">
      <span className="h-3 w-3 animate-pulse rounded-full bg-indigo-600" />

      <h3 className="font-semibold text-indigo-900">
        Collaboration in progress
      </h3>
    </div>

    <p className="mt-2 text-sm text-indigo-700">
      Your task status will update automatically.
    </p>
  </section>
)}

{result && result.status === "failed" && (
  <section
    role="alert"
    className="rounded-xl border border-red-200 bg-red-50 p-5"
  >
    <h3 className="font-semibold text-red-900">
      Collaboration could not be completed
    </h3>

    <p className="mt-2 text-sm text-red-700">
      Any previously saved discussion remains available.
    </p>
  </section>
)}
        {result&&<><section className="space-y-4"><div className="flex flex-wrap justify-between gap-2"><h3 className="text-xl font-bold">{individualResult ? "AI response" : "Collaboration discussion"}</h3><span className="text-sm capitalize text-slate-500">{!individualResult && `${result.total_turns} saved or completed turns · `}{result.status}</span></div>{result.discussion.map((t,i)=>{const u=result.model_usage.find(m=>m.turn===t.turn);return <article key={`${t.turn}-${i}`} className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex flex-wrap justify-between gap-2"><h4 className="font-semibold text-indigo-700">{names[u?.provider??t.model]??u?.provider??t.model}</h4>{!individualResult && <span className="text-xs text-slate-500">Turn {t.turn} · Round {t.round}</span>}</div><p className="mt-2 break-words text-xs text-slate-500">Requested: {t.model} · Actual model: {u?.model??"Not reported"}</p>{u&&u.provider!==u.requested_provider&&<p className="text-xs text-amber-700">Fallback provider used</p>}<div className="markdown-content mt-4 break-words text-sm"><ReactMarkdown remarkPlugins={[remarkGfm]}>{t.response}</ReactMarkdown></div></article>;})}{individualResult && !result.discussion.length && result.final_answer && <div className="markdown-content"><ReactMarkdown remarkPlugins={[remarkGfm]}>{result.final_answer}</ReactMarkdown></div>}</section>{!individualResult && <section className="rounded-2xl border border-indigo-200 bg-white p-6"><h3 className="text-xl font-bold">Final collaborative answer</h3><div className="markdown-content mt-4 break-words">{result.final_answer?<ReactMarkdown remarkPlugins={[remarkGfm]}>{result.final_answer}</ReactMarkdown>:<p className="text-slate-500">No final synthesis saved yet.</p>}</div></section>}</>}
        <section id="usage" className="rounded-xl border border-slate-200 bg-white p-4"><h3 className="text-sm font-semibold">Daily usage &amp; limits</h3><p className="mt-2 text-sm text-slate-500">{remaining===null?"Daily limit: 10 requests. Current balance not loaded.":`${remaining} of 10 requests remaining (last reported balance).`} Reset at midnight UTC.</p></section>
      </div>
    </main>
  </div>;
}
