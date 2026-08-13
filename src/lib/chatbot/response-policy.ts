import type { AssistantReasoningMode } from "@/src/lib/chatbot/assistant-types";
import type { ChatReply } from "@/src/lib/chatbot/engine";

const memoryCommandPattern = /(یادت باشه|یادت باشد|به خاطر بسپار|به یاد بسپار|اسم من|نام من|حافظه.*(?:پاک|نشان)|چه چیزی از من یادت|چی از من یادت|همه چیز را فراموش)/i;
const contextualPattern = /^(?:و|پس|حالا|خب)?\s*(?:برای|اگر|یعنی|پس|اون|آن|این|همین|قبلی|بیشتر|ادامه|چطورش|چگونه‌اش|در موردش|باهاش|بدونش|چی|چه‌طور)/i;
const synthesisPattern = /(طراح|معماری|سناریو|راهبرد|استراتژی|توپولوژی|مرحله\s*به\s*مرحله|قدم\s*به\s*قدم|عیب\s*یابی|رفع\s*مشکل|مشکل|قطع\s*(?:و|‌و)?\s*وصل|هک|نفوذ|حادثه|ریسک|علت|چرا|چطور|چگونه|امن\s*(?:کن|سازی)|vlan|فایروال|firewall|acl|trunk|access)/i;

/**
 * Exact catalog, calculation and simple knowledge answers should not be rewritten by
 * a generative model. The LLM is reserved for synthesis, diagnosis and contextual
 * follow-ups where language-level reasoning actually improves the answer.
 */
export function shouldUseLocalLlm(
  reply: ChatReply,
  message: string,
  historyLength: number,
  mode: AssistantReasoningMode
) {
  if (memoryCommandPattern.test(message)) return true;
  if (reply.answer.source === "catalog" || reply.answer.source === "calculation") return false;
  if (["greeting", "thanks", "help_menu", "contact"].includes(reply.intent)) return false;

  if (reply.intent === "fallback") {
    return historyLength >= 3 && contextualPattern.test(normalize(message));
  }

  if (reply.answer.source === "knowledge") {
    if (mode === "low") return false;
    if (mode === "high") return true;
    return synthesisPattern.test(normalize(message)) || message.length > 220;
  }

  return true;
}

function normalize(message: string) {
  return message.toLowerCase().replace(/ي/g, "ی").replace(/ك/g, "ک").trim();
}
