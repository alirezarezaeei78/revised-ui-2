import type { ChatReply } from "@/src/lib/chatbot/engine";
import type { AssistantReasoningMode } from "@/src/lib/chatbot/assistant-types";

export type LlmRuntimeState = "checking" | "ready" | "unavailable";

export type LlmStreamPhase = "connecting" | "thinking" | "answering";

export type LlmHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

export type LlmStreamEvent =
  | { type: "status"; phase: "connecting" | "thinking"; model?: string; thinkingCharacters?: number }
  | { type: "content"; delta: string; model?: string }
  | { type: "metrics"; evalCount?: number; totalDuration?: number; reason?: string }
  | { type: "done"; model?: string; thinkingCharacters?: number }
  | { type: "error"; message?: string };

export type LlmStreamResult = {
  content: string;
  model: string;
  thinkingCharacters: number;
};

export class LocalLlmUnavailableError extends Error {
  code: string;

  constructor(message: string, code = "LOCAL_LLM_UNAVAILABLE") {
    super(message);
    this.name = "LocalLlmUnavailableError";
    this.code = code;
  }
}

export type LocalLlmStatus = {
  available: boolean;
  model: string;
};

export async function checkLocalLlm(signal?: AbortSignal): Promise<LocalLlmStatus> {
  try {
    const response = await fetch("/api/assistant/chat", {
      method: "GET",
      cache: "no-store",
      signal
    });
    const data = await response.json() as Partial<LocalLlmStatus>;
    return {
      available: response.ok && data.available === true,
      model: data.model || "hamyar-security"
    };
  } catch {
    return {
      available: false,
      model: "hamyar-security"
    };
  }
}

export async function streamLocalLlm(
  input: {
    message: string;
    history: LlmHistoryMessage[];
    grounding: ChatReply["answer"];
    reasoningMode: AssistantReasoningMode;
  },
  onEvent: (event: LlmStreamEvent) => void,
  signal?: AbortSignal
): Promise<LlmStreamResult> {
  const response = await fetch("/api/assistant/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: input.message,
      history: input.history.slice(-10),
      reasoningMode: input.reasoningMode,
      grounding: {
        title: input.grounding.title,
        lines: input.grounding.lines,
        assumptions: input.grounding.assumptions,
        source: input.grounding.source
      }
    }),
    cache: "no-store",
    signal
  });

  if (!response.ok || !response.body) {
    let payload: { error?: string; code?: string } = {};
    try {
      payload = await response.json() as typeof payload;
    } catch {
      /* A proxy may replace the JSON error with its own response. */
    }
    throw new LocalLlmUnavailableError(
      payload.error || "مدل زبانی محلی در دسترس نیست.",
      payload.code
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  let content = "";
  let model = "hamyar-security";
  let thinkingCharacters = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffered += decoder.decode(value, { stream: true });

    const lines = buffered.split("\n");
    buffered = lines.pop() ?? "";
    for (const line of lines) processLine(line);
  }
  if (buffered.trim()) processLine(buffered);

  if (!content.trim()) {
    throw new LocalLlmUnavailableError("مدل محلی پاسخ کاملی تولید نکرد.", "EMPTY_LOCAL_RESPONSE");
  }

  return { content: content.trim(), model, thinkingCharacters };

  function processLine(line: string) {
    if (!line.trim()) return;
    let event: LlmStreamEvent;
    try {
      event = JSON.parse(line) as LlmStreamEvent;
    } catch {
      return;
    }

    if ("model" in event && event.model) model = event.model;
    if (event.type === "status" && event.thinkingCharacters) thinkingCharacters = event.thinkingCharacters;
    if (event.type === "done" && event.thinkingCharacters) thinkingCharacters = event.thinkingCharacters;
    if (event.type === "content") content += event.delta;
    if (event.type === "error") {
      throw new LocalLlmUnavailableError(event.message || "ارتباط با مدل محلی قطع شد.", "STREAM_ERROR");
    }
    onEvent(event);
  }
}
