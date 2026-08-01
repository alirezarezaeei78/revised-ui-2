import { normalizePersian } from "@/src/lib/chatbot/persian";

export type MemoryCommand =
  | { kind: "remember"; fact: string }
  | { kind: "list" }
  | { kind: "clear" }
  | { kind: "none" };

export function sanitizeMemoryFact(value: unknown) {
  if (typeof value !== "string") return "";
  return value.replace(/\u0000/g, "").replace(/\s+/g, " ").trim().slice(0, 280);
}

export function normalizeMemoryFact(value: string) {
  return normalizePersian(value)
    .toLocaleLowerCase("fa")
    .replace(/[.!؟?،,:؛;]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function isSensitiveMemoryFact(value: string) {
  const text = normalizeMemoryFact(value);
  return /(رمز|پسورد|گذرواژه|کلمه عبور|password|passcode|secret|api[ _-]?key|private[ _-]?key|کلید خصوصی|توکن|token|otp|کد تایید|cvv|شماره کارت)/i.test(text);
}

export function parseMemoryCommand(message: string): MemoryCommand {
  const original = sanitizeMemoryFact(message);
  const normalized = normalizeMemoryFact(original);
  if (/^(?:حافظه(?: من)? را پاک کن|همه چیز را فراموش کن|هرچی از من یادت هست پاک کن)$/.test(normalized)) {
    return { kind: "clear" };
  }
  if (/^(?:چه چیزی از من یادت هست|چی از من یادت هست|حافظه من را نشان بده|حافظه ام را نشان بده)$/.test(normalized)) {
    return { kind: "list" };
  }

  const explicit = original.match(/^(?:یادت باشه|یادت باشد|به خاطر بسپار|به یاد بسپار)\s*[:：-]?\s*(.+)$/i)?.[1];
  if (explicit) return { kind: "remember", fact: sanitizeMemoryFact(explicit) };
  return { kind: "none" };
}

export function extractAutomaticMemoryFacts(message: string) {
  const original = sanitizeMemoryFact(message);
  if (!original || isSensitiveMemoryFact(original)) return [];
  const command = parseMemoryCommand(original);
  if (command.kind === "clear" || command.kind === "list") return [];

  const facts = new Set<string>();
  if (command.kind === "remember") facts.add(command.fact);

  const name = original.match(/(?:^|[.!؟]\s*)(?:اسم|نام) من\s+(.{2,48}?)(?:\s+(?:است|هست|هستم))?(?:[.!؟?]|$)/i)?.[1];
  if (name) facts.add(`نام کاربر: ${sanitizeMemoryFact(name)}`);

  const role = original.match(/(?:^|[.!؟]\s*)من\s+(نصاب|تکنسین|کارشناس|فروشنده|طراح|مدیر شبکه|مدیر امنیت|مجری|برنامه نویس|توسعه دهنده)\s*(.{0,50}?)\s*(?:هستم|می باشم)(?:[.!؟?]|$)/i);
  if (role) {
    const detail = sanitizeMemoryFact(role[2]);
    facts.add(`نقش حرفه‌ای کاربر: ${role[1]}${detail ? ` ${detail}` : ""}`);
  }

  const experience = original.match(/(?:^|[.!؟]\s*)من\s+(مبتدی|تازه کار|حرفه ای|باتجربه|با تجربه)\s*(?:هستم|می باشم)(?:[.!؟?]|$)/i)?.[1];
  if (experience) facts.add(`سطح تجربه کاربر: ${experience}`);

  const preferredBrand = original.match(/(?:^|[.!؟]\s*)(?:من\s+)?(?:برند\s+)?([\p{L}\p{N}][\p{L}\p{N}\- ]{1,48}?)\s+را\s+(?:ترجیح می[\s‌-]*دهم|ترجیح می[\s‌-]*دم|دوست دارم)(?:[.!؟?]|$)/iu)?.[1];
  if (preferredBrand) facts.add(`ترجیح کاربر: ${sanitizeMemoryFact(preferredBrand)}`);

  const avoidedBrand = original.match(/(?:^|[.!؟]\s*)(?:من\s+)?(?:برند\s+)?([\p{L}\p{N}][\p{L}\p{N}\- ]{1,48}?)\s+را\s+(?:نمی[\s‌-]*خواهم|نمی[\s‌-]*خوام|دوست ندارم|استفاده نمی[\s‌-]*کنم)(?:[.!؟?]|$)/iu)?.[1];
  if (avoidedBrand) facts.add(`عدم ترجیح کاربر: ${sanitizeMemoryFact(avoidedBrand)}`);

  const usualWork = original.match(/((?:من\s+)?معمولاً|(?:من\s+)?معمولا)\s+(.{3,160}?)(?:[.!؟?]|$)/i)?.[2];
  if (usualWork && /پروژه|دوربین|شبکه|نصب|طراحی|برند|سیستم/i.test(usualWork)) {
    facts.add(`روال معمول کاربر: ${sanitizeMemoryFact(usualWork)}`);
  }

  const technicalEnvironment = original.match(/((?:سرور|سیستم|کامپیوتر|لپ\s*تاپ|شبکه|پروژه)(?:\s+(?:من|ما))?\s+.{2,170}?(?:دارم|داریم|دارد|دارند|ندارم|نداریم|ندارد|ندارند|است|هست|اجرا می‌شود|استفاده می‌کنم))(?:[.!؟?]|$)/i)?.[1];
  if (technicalEnvironment) facts.add(`محیط فنی کاربر: ${sanitizeMemoryFact(technicalEnvironment)}`);

  const englishPreference = original.match(/\bI\s+(?:prefer|usually use|do not use|don't use)\s+(.{2,100}?)(?:[.!?]|$)/i);
  if (englishPreference) facts.add(`User preference: ${sanitizeMemoryFact(englishPreference[0])}`);

  const englishEnvironment = original.match(/\bI\s+(?:do not have|don't have|have|run|use)\s+.{2,160}\b(?:server|system|network|GPU|CPU)\b.{0,80}(?:[.!?]|$)/i)?.[0];
  if (englishEnvironment) facts.add(`User technical environment: ${sanitizeMemoryFact(englishEnvironment)}`);

  return Array.from(facts).filter((fact) => fact && !isSensitiveMemoryFact(fact)).slice(0, 4);
}
