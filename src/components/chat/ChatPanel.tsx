"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BrainCircuit,
  Check,
  ChevronDown,
  CornerDownLeft,
  ExternalLink,
  LoaderCircle,
  RotateCcw,
  ShieldCheck,
  User
} from "lucide-react";
import {
  reasoningModes,
  type AssistantReasoningMode
} from "@/src/lib/chatbot/assistant-types";
import { respond, type ChatReply } from "@/src/lib/chatbot/engine";
import {
  checkLocalLlm,
  LocalLlmUnavailableError,
  streamLocalLlm,
  type LlmHistoryMessage,
  type LlmRuntimeState,
  type LlmStreamPhase
} from "@/src/lib/chatbot/local-llm-client";
import { AssistantModel, type ModelState } from "@/src/lib/chatbot/model";
import { formatFa } from "@/src/lib/chatbot/persian";
import type { Answer } from "@/src/lib/chatbot/skills";

type Message =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "assistant"; reply: ChatReply; streaming?: boolean };

const starters = [
  "برای ۱۶ دوربین ۴ مگاپیکسل و ۳۰ روز آرشیو چقدر هارد لازم است؟",
  "شبکه دوربین‌های یک کارخانه را چطور امن طراحی کنم؟",
  "قانون فایروال بین VLAN دوربین و NVR چطور باشد؟",
  "فکر می‌کنم دوربینم هک شده؛ قدم‌به‌قدم چه کنم؟",
  "برای مغازه دوربین، دزدگیر و کنترل تردد چه طرحی پیشنهاد می‌دهی؟"
];

const greeting: Answer = {
  source: "system",
  title: "سلام، من هوش‌یار هستم",
  lines: [
    "دستیار هوش مصنوعی محلی همیار دوربین برای دوربین مداربسته، شبکه و امنیت.",
    "",
    "مدل روی سرور خودتان و بدون توکن ابری اجرا می‌شود. حافظه خودکار، ترجیحات و اطلاعات پایدار مفید را برای گفت‌وگوهای بعدی به خاطر می‌سپارد؛ رمز و توکن هرگز ذخیره نمی‌شود."
  ]
};

const initialModelState: ModelState = {
  status: "idle",
  progress: 0,
  epoch: 0,
  totalEpochs: 0,
  loss: 0,
  accuracy: 0,
  origin: "none"
};

let messageCounter = 0;
const nextId = () => `m${(messageCounter += 1)}`;

const welcomeMessage = (): Message => ({
  id: nextId(),
  role: "assistant",
  reply: {
    answer: greeting,
    intent: "greeting",
    confidence: 1,
    reasoning: {
      intents: [],
      articles: [],
      modelReady: false,
      slots: [],
      runtime: { kind: "local-nlp" }
    }
  }
});

export function ChatPanel({ variant }: { variant: "floating" | "page" }) {
  const [messages, setMessages] = useState<Message[]>(() => [welcomeMessage()]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [phase, setPhase] = useState<LlmStreamPhase>("connecting");
  const [runtimeState, setRuntimeState] = useState<LlmRuntimeState>("checking");
  const [modelName, setModelName] = useState("hamyar-security");
  const [reasoningMode, setReasoningMode] = useState<AssistantReasoningMode>("medium");
  const [nlpModelState, setNlpModelState] = useState<ModelState>(initialModelState);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const model = AssistantModel.getInstance();
    const unsubscribe = model.subscribe(setNlpModelState);
    model.start();

    const controller = new AbortController();
    void checkLocalLlm(controller.signal).then((result) => {
      setRuntimeState(result.available ? "ready" : "unavailable");
      setModelName(result.model);
    });

    return () => {
      controller.abort();
      abortRef.current?.abort();
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const container = scrollRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [messages, pending, phase]);

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || pending) return;
    const effectiveMessage = trimmed;

    const history = toLlmHistory(messages);
    const assistantMessageId = nextId();
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;

    setInput("");
    setMessages((current) => [...current, {
      id: nextId(),
      role: "user",
      text: trimmed
    }]);
    setPending(true);
    setPhase("connecting");

    let fallbackReply: ChatReply | null = null;
    let generated = "";
    let streamInserted = false;
    let streamModel = modelName;

    try {
      [fallbackReply] = await Promise.all([
        respond(effectiveMessage),
        learnUserMessage(effectiveMessage)
      ]);

      // Catalog lookups and engineering calculations are already exact, grounded
      // answers. Sending them through a generative model only adds latency and gives
      // the model an opportunity to alter a verified model number or calculation.
      if (shouldAnswerDirectly(fallbackReply, effectiveMessage)) {
        setPhase("answering");
        setMessages((current) => [...current, {
          id: assistantMessageId,
          role: "assistant",
          reply: {
            ...fallbackReply!,
            reasoning: {
              ...fallbackReply!.reasoning,
              runtime: { kind: "local-nlp", thinking: false }
            }
          }
        }]);
        return;
      }

      const result = await streamLocalLlm(
        {
          message: effectiveMessage,
          history,
          grounding: fallbackReply.answer,
          reasoningMode
        },
        (event) => {
          if (event.type === "status") {
            setPhase(event.phase);
            if (event.model) streamModel = event.model;
            return;
          }
          if (event.type !== "content") return;

          setPhase("answering");
          generated += event.delta;
          if (event.model) streamModel = event.model;
          const reply = localLlmReply(generated, fallbackReply!, streamModel, reasoningMode);

          setMessages((current) => {
            if (!streamInserted) {
              streamInserted = true;
              return [...current, { id: assistantMessageId, role: "assistant", reply, streaming: true }];
            }
            return current.map((message) =>
              message.id === assistantMessageId && message.role === "assistant"
                ? { ...message, reply, streaming: true }
                : message
            );
          });
        },
        controller.signal
      );

      setRuntimeState("ready");
      setModelName(result.model);
      const finalReply = localLlmReply(result.content, fallbackReply, result.model, reasoningMode);
      setMessages((current) => {
        const exists = current.some((message) => message.id === assistantMessageId);
        if (!exists) return [...current, { id: assistantMessageId, role: "assistant", reply: finalReply }];
        return current.map((message) =>
          message.id === assistantMessageId && message.role === "assistant"
            ? { ...message, reply: finalReply, streaming: false }
            : message
        );
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      const runtimeUnavailable = error instanceof LocalLlmUnavailableError &&
        ["OLLAMA_OFFLINE", "LOCAL_LLM_UNAVAILABLE"].includes(error.code);
      setRuntimeState(runtimeUnavailable ? "unavailable" : "ready");

      if (!fallbackReply) fallbackReply = await respond(effectiveMessage);
      const errorReply = fallbackReply;
      setMessages((current) => {
        const withoutPartial = current.filter((message) => message.id !== assistantMessageId);
        return [...withoutPartial, {
          id: assistantMessageId,
          role: "assistant",
          reply: {
            ...errorReply!,
            reasoning: {
              ...errorReply!.reasoning,
              runtime: { kind: "local-nlp", thinking: false }
            }
          }
        }];
      });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setPending(false);
    }
  }, [messages, modelName, pending, reasoningMode]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setMessages([welcomeMessage()]);
    setPending(false);
    setInput("");
    inputRef.current?.focus();
  }, []);

  const showStarters = messages.length === 1;

  return (
    <div className={`chat-panel chat-panel-${variant}`}>
      {variant === "page" ? (
        <div className="chat-toolbar">
          <div className="chat-toolbar-identity">
            <span className="chat-toolbar-title">
              <BrainCircuit size={16} aria-hidden="true" />
              هوش‌یار
            </span>
            <RuntimeBadge
              runtimeState={runtimeState}
              modelName={modelName}
              nlpModelState={nlpModelState}
            />
          </div>
          <button type="button" onClick={reset} aria-label="گفت‌وگوی جدید" title="گفت‌وگوی جدید">
            <RotateCcw size={15} aria-hidden="true" />
            <span>گفت‌وگوی جدید</span>
          </button>
        </div>
      ) : null}

      <div className="chat-scroll" ref={scrollRef}>
        {messages.map((message) =>
          message.role === "user" ? (
            <div className="chat-row chat-row-user" key={message.id}>
              <div className="chat-bubble chat-bubble-user">
                <span>{message.text}</span>
              </div>
              <span className="chat-avatar chat-avatar-user"><User size={15} aria-hidden="true" /></span>
            </div>
          ) : (
            <div className="chat-row chat-row-assistant" key={message.id}>
              <span className="chat-avatar chat-avatar-bot"><BrainCircuit size={15} aria-hidden="true" /></span>
              <AnswerCard reply={message.reply} onFollowUp={send} streaming={message.streaming} />
            </div>
          )
        )}

        {pending && phase !== "answering" ? (
          <div className="chat-row chat-row-assistant">
            <span className="chat-avatar chat-avatar-bot"><BrainCircuit size={15} aria-hidden="true" /></span>
            <ThinkingCard phase={phase} runtimeState={runtimeState} reasoningMode={reasoningMode} />
          </div>
        ) : null}

        {showStarters ? (
          <div className="chat-starters">
            <span>می‌توانید از این سؤال‌ها شروع کنید:</span>
            {starters.map((starter) => (
              <button type="button" key={starter} onClick={() => send(starter)}>{starter}</button>
            ))}
          </div>
        ) : null}
      </div>

      <form
        className="chat-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void send(input);
        }}
      >
        <div className="chat-composer-tools">
          <div className="chat-reasoning-selector">
            <span>عمق هوش</span>
            <div role="radiogroup" aria-label="انتخاب سطح استدلال">
              {(Object.keys(reasoningModes) as AssistantReasoningMode[]).map((mode) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={reasoningMode === mode}
                  className={reasoningMode === mode ? "is-active" : ""}
                  title={reasoningModes[mode].description}
                  key={mode}
                  onClick={() => setReasoningMode(mode)}
                  disabled={pending}
                >
                  {reasoningModes[mode].label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="chat-composer-main">
          <div className="chat-composer-field">
            <textarea
              ref={inputRef}
              value={input}
              rows={1}
              placeholder="سؤال فنی یا امنیتی خود را بنویسید..."
              aria-label="پیام شما"
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send(input);
                }
              }}
            />
            <span><ShieldCheck size={11} aria-hidden="true" /> پردازش محلی؛ حافظه خودکار فعال است و اطلاعات حساس ذخیره نمی‌شود</span>
          </div>
          <button
            className="chat-send-button"
            type="submit"
            disabled={pending || !input.trim()}
            aria-label="ارسال پیام"
          >
            {pending ? <LoaderCircle size={18} className="is-spinning" aria-hidden="true" /> : <CornerDownLeft size={18} aria-hidden="true" />}
          </button>
        </div>
      </form>
    </div>
  );
}

async function learnUserMessage(message: string) {
  try {
    await fetch("/api/assistant/memory", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
      cache: "no-store"
    });
  } catch {
    // Memory must never prevent the assistant from answering.
  }
}

function shouldAnswerDirectly(reply: ChatReply, message: string) {
  if (/(یادت باشه|یادت باشد|به خاطر بسپار|به یاد بسپار|اسم من|نام من|حافظه.*(?:پاک|نشان)|چه چیزی از من یادت|چی از من یادت|همه چیز را فراموش)/i.test(message)) return false;
  if (reply.answer.source === "catalog") return true;
  if (reply.answer.source === "calculation") return !needsGenerativeSynthesis(message);
  return ["fallback", "greeting", "thanks", "help_menu", "contact"].includes(reply.intent);
}

function needsGenerativeSynthesis(message: string) {
  const normalized = message.toLowerCase().replace(/ي/g, "ی").replace(/ك/g, "ک");
  return /(طراح|معماری|سناریو|پیشنهاد|مقایسه|ریسک|چطور|چگونه|vlan|فایروال|firewall|acl|امن|توپولوژی|trunk|access)/i.test(normalized);
}

function RuntimeBadge({
  runtimeState,
  modelName,
  nlpModelState
}: {
  runtimeState: LlmRuntimeState;
  modelName: string;
  nlpModelState: ModelState;
}) {
  if (runtimeState === "ready") {
    return <span className="chat-runtime is-ready"><span /> مدل محلی {modelName}</span>;
  }
  if (runtimeState === "checking") {
    return <span className="chat-runtime is-loading"><span /> بررسی موتور محلی</span>;
  }

  const nlpReady = nlpModelState.status === "ready";
  const progress = Math.round(nlpModelState.progress * 100);
  return (
    <span className="chat-runtime is-fallback" title="برای پاسخ زبانی کامل، سرویس Ollama و مدل hamyar-security را اجرا کنید.">
      <span />
      {nlpReady ? "حالت دانش محلی" : `آماده‌سازی پشتیبان ${formatFa(progress)}٪`}
    </span>
  );
}

function ThinkingCard({
  phase,
  runtimeState,
  reasoningMode
}: {
  phase: LlmStreamPhase;
  runtimeState: LlmRuntimeState;
  reasoningMode: AssistantReasoningMode;
}) {
  const activeIndex = phase === "connecting" ? 0 : phase === "thinking" ? 1 : 2;
  const labels = runtimeState === "unavailable"
    ? ["اجرای موتور پشتیبان", "بازیابی دانش فنی", "ساخت پاسخ"]
    : reasoningMode === "high"
      ? ["اتصال به مدل عمیق", "استدلال و راستی‌آزمایی", "ساخت پاسخ نهایی"]
      : reasoningMode === "low"
        ? ["اتصال به مدل محلی", "بررسی سریع مسئله", "ساخت پاسخ فارسی"]
        : ["اتصال به مدل محلی", "استدلال روی مسئله", "ساخت پاسخ فارسی"];

  return (
    <div className="chat-bubble chat-bubble-bot chat-thinking">
      <div className="chat-thinking-head">
        <LoaderCircle size={16} className="is-spinning" aria-hidden="true" />
        <strong>{phase === "thinking" ? "مدل در حال استدلال است..." : "در حال آماده‌سازی پاسخ..."}</strong>
      </div>
      <div className="chat-thinking-steps" aria-label="مراحل پردازش">
        {labels.map((label, index) => (
          <span key={label} className={index < activeIndex ? "is-done" : index === activeIndex ? "is-active" : ""}>
            {index < activeIndex ? <Check size={11} aria-hidden="true" /> : <i />}
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

function AnswerCard({
  reply,
  onFollowUp,
  streaming
}: {
  reply: ChatReply;
  onFollowUp: (text: string) => void;
  streaming?: boolean;
}) {
  const { answer } = reply;
  const href = useMemo(() => toolHref(answer.tool?.slug), [answer.tool?.slug]);

  return (
    <div className={streaming ? "chat-bubble chat-bubble-bot is-streaming" : "chat-bubble chat-bubble-bot"}>
      <div className="chat-answer-head">
        <strong>{answer.title}</strong>
        <span className={`chat-source chat-source-${answer.source}`}>{sourceLabel(answer.source)}</span>
      </div>

      <div className="chat-answer-body">
        {answer.lines.map((line, index) => <RichLine key={index} line={line} />)}
        {streaming ? <span className="chat-stream-caret" aria-hidden="true" /> : null}
      </div>

      {answer.assumptions?.length ? (
        <details className="chat-assumptions">
          <summary>فرض‌ها و مبانی محاسبه ({formatFa(answer.assumptions.length)})</summary>
          <ul>{answer.assumptions.map((item, index) => <li key={index}>{item}</li>)}</ul>
        </details>
      ) : null}

      {!streaming ? <ReasoningSummary reply={reply} /> : null}

      {href && answer.tool ? (
        <Link className="chat-tool-link" href={href}>
          <ExternalLink size={14} aria-hidden="true" />
          <span>{answer.tool.label}</span>
        </Link>
      ) : null}

      {!streaming && answer.followUps?.length ? (
        <div className="chat-followups">
          {answer.followUps.map((item) => (
            <button type="button" key={item} onClick={() => onFollowUp(item)}>{item}</button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ReasoningSummary({ reply }: { reply: ChatReply }) {
  const localLlm = reply.reasoning.runtime?.kind === "local-llm";
  const mode = reply.reasoning.runtime?.mode;
  if (reply.answer.source === "system" && reply.intent === "greeting") return null;

  return (
    <details className="chat-reasoning">
      <summary>
        <span><BrainCircuit size={13} aria-hidden="true" /> روش بررسی پاسخ</span>
        <ChevronDown size={13} aria-hidden="true" />
      </summary>
      <div>
        <p><strong>موتور:</strong> {localLlm ? `مدل زبانی محلی ${reply.reasoning.runtime?.model ?? ""}` : "موتور دانش و محاسبات محلی"}</p>
        <p><strong>روش:</strong> {localLlm ? "استدلال مدل + بازیابی دانش تخصصی + کنترل خروجی ابزارها" : "تشخیص موضوع + بازیابی مقاله یا اجرای محاسبه قطعی"}</p>
        {localLlm && mode ? (
          <p><strong>عمق هوش:</strong> {reasoningModes[mode].label} — {reasoningModes[mode].description}</p>
        ) : null}
        {reply.reasoning.runtime?.verified ? <p><strong>کنترل دقت:</strong> پاسخ با چک‌لیست عدد، ادعا، شبکه و تناقض راستی‌آزمایی شده است.</p> : null}
        {reply.reasoning.slots.length ? (
          <p><strong>ورودی‌های تشخیص‌داده‌شده:</strong> {reply.reasoning.slots.join("، ")}</p>
        ) : null}
        <p className="chat-reasoning-note">زنجیره فکر خصوصی مدل نمایش داده نمی‌شود؛ این بخش فقط روش و مبنای قابل بررسی پاسخ را نشان می‌دهد.</p>
      </div>
    </details>
  );
}

/** Minimal inline formatting: `**bold**`, headings, bullet lines and `---` separators. */
function RichLine({ line }: { line: string }) {
  if (line === "") return <div className="chat-spacer" />;
  if (line === "---") return <hr />;

  const cleaned = line.replace(/^#{1,4}\s*/, "").replace(/^[-*]\s+/, "• ");
  const segments = cleaned.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return (
    <p className={cleaned.startsWith("•") || /^\d+[.)]\s/.test(cleaned) ? "chat-line chat-line-bullet" : "chat-line"}>
      {segments.map((segment, index) => {
        if (segment.startsWith("**") && segment.endsWith("**")) {
          return <strong key={index}>{segment.slice(2, -2)}</strong>;
        }
        if (segment.startsWith("`") && segment.endsWith("`")) {
          return <code key={index}>{segment.slice(1, -1)}</code>;
        }
        return <Fragment key={index}>{segment}</Fragment>;
      })}
    </p>
  );
}

function localLlmReply(
  content: string,
  grounding: ChatReply,
  model: string,
  mode: AssistantReasoningMode
): ChatReply {
  const deterministic = model === "deterministic-network";
  return {
    ...grounding,
    answer: {
      source: deterministic ? "calculation" : "llm",
      title: deterministic ? "محاسبه و طراحی قطعی شبکه" : "پاسخ هوش‌یار",
      lines: generatedLines(content),
      assumptions: grounding.answer.source === "calculation" ? grounding.answer.assumptions : undefined,
      tool: grounding.answer.tool,
      followUps: grounding.answer.followUps
    },
    reasoning: {
      ...grounding.reasoning,
      runtime: {
        kind: deterministic ? "local-nlp" : "local-llm",
        model,
        thinking: deterministic ? false : mode !== "low",
        mode: deterministic ? undefined : mode,
        verified: deterministic ? true : mode === "high"
      }
    }
  };
}

function generatedLines(content: string) {
  return content
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line, index, all) => line !== "" || all[index - 1] !== "");
}

function toLlmHistory(messages: Message[]): LlmHistoryMessage[] {
  return messages
    .slice(-10)
    .map((message): LlmHistoryMessage => message.role === "user"
      ? { role: "user", content: message.text }
      : {
          role: "assistant",
          content: [message.reply.answer.title, ...message.reply.answer.lines].join("\n").slice(0, 2_500)
        })
    .filter((message) => message.content.trim().length > 0);
}

function toolHref(slug?: string) {
  if (!slug) return null;
  if (slug === "__catalog__") return "/catalog";
  if (slug === "__planner__") return "/planner";
  if (slug === "__contacts__") return "/contacts";
  if (slug === "__login__") return "/login";
  return `/calculators/${slug}`;
}

function sourceLabel(source: Answer["source"]) {
  if (source === "calculation") return "محاسبه";
  if (source === "knowledge") return "دانش محلی";
  if (source === "catalog") return "کاتالوگ";
  if (source === "llm") return "مدل محلی";
  return "دستیار";
}
