import type { ChatIntent } from "@/src/lib/chatbot/corpus";
import { checkDomain } from "@/src/lib/chatbot/domain";
import { isExplicitlyOffTopic, isUnsafeSecurityRequest, matchRule, type RuleMatch } from "@/src/lib/chatbot/rules";
import { knowledgeByIntent, type KnowledgeArticle } from "@/src/lib/chatbot/knowledge";
import { AssistantModel } from "@/src/lib/chatbot/model";
import { formatFa } from "@/src/lib/chatbot/persian";
import { searchKnowledge, type RetrievalHit } from "@/src/lib/chatbot/retrieval";
import { extractSlots, referenceBitrateKbps, type Slots } from "@/src/lib/chatbot/slots";
import { productCompareSkill, productPriceSkill, productSearchSkill } from "@/src/lib/chatbot/catalog-skill";
import {
  ackSkill,
  bandwidthSkill,
  cableSkill,
  channelSkill,
  dbmSkill,
  doriSkill,
  fovSkill,
  fresnelSkill,
  lensSkill,
  poeSkill,
  ppmSkill,
  raidSkill,
  storageSkill,
  subnetSkill,
  upsSkill,
  wirelessSkill,
  type Answer
} from "@/src/lib/chatbot/skills";
import { calculateSurveillanceStorage, kbpsToMbps } from "@/src/lib/calculators/storage";

/**
 * Routes a Persian message to an answer.
 *
 * The neural classifier proposes an intent, TF-IDF retrieval proposes an article, and
 * this module arbitrates between them. Retrieval wins when the network is unsure or
 * still training, which is what keeps the assistant usable on a cold first load.
 */

export type ChatReply = {
  answer: Answer;
  intent: ChatIntent | "fallback";
  confidence: number;
  reasoning: {
    intents: { intent: ChatIntent; score: number }[];
    articles: { title: string; score: number }[];
    modelReady: boolean;
    slots: string[];
    runtime?: {
      kind: "local-llm" | "local-nlp";
      model?: string;
      thinking?: boolean;
      mode?: "low" | "medium" | "high";
      verified?: boolean;
    };
  };
};

const confidentThreshold = 0.42;
const retrievalOverrideThreshold = 0.26;

const calculationSkills: Partial<Record<ChatIntent, (slots: Slots) => Answer>> = {
  calc_storage: storageSkill,
  calc_bandwidth: bandwidthSkill,
  calc_lens_focal: lensSkill,
  calc_fov: fovSkill,
  calc_dori: doriSkill,
  calc_ppm: ppmSkill,
  calc_raid: raidSkill,
  calc_poe_budget: poeSkill,
  calc_ups: upsSkill,
  calc_subnet: subnetSkill,
  calc_wireless_link: wirelessSkill,
  calc_fresnel: fresnelSkill,
  calc_ack: ackSkill,
  calc_dbm: dbmSkill,
  calc_channels: channelSkill,
  calc_cable: cableSkill
};

const catalogSkills: Partial<Record<ChatIntent, (slots: Slots) => Promise<Answer>>> = {
  product_search: productSearchSkill,
  product_price: productPriceSkill,
  product_compare: productCompareSkill
};

export async function respond(message: string): Promise<ChatReply> {
  const text = message.trim();
  if (!text) return reply(smallTalk("help_menu"), "help_menu", 1, null, []);

  const slots = extractSlots(text);
  const model = AssistantModel.getInstance();
  const classification = model.classify(text);
  const hits = searchKnowledge(text, 3);
  const rule = matchRule(slots.text, slots);

  if (isUnsafeSecurityRequest(slots.text)) {
    return reply(securityBoundaryAnswer(), "fallback", 1, classification, [], slots);
  }

  // Nothing in the message belongs to this subject matter: say so rather than
  // letting a confident softmax pick the least-wrong CCTV article. A named off-topic
  // subject overrides even a rule match — "قیمت دلار" shares vocabulary with the catalog.
  if (isExplicitlyOffTopic(slots.text) || (!rule && !checkDomain(text).inDomain)) {
    return reply(offTopicAnswer(), "fallback", 0, classification, [], slots);
  }

  const intent = decideIntent(classification, hits, rule);
  const confidence = rule ? 1 : classification?.confidence ?? (hits[0]?.score ?? 0);

  const answer = await buildAnswer(intent, slots, hits);
  return reply(answer, intent, confidence, classification, hits, slots);
}

function decideIntent(
  classification: ReturnType<AssistantModel["classify"]>,
  hits: RetrievalHit[],
  rule: RuleMatch | null
): ChatIntent | "fallback" {
  const top = hits[0];

  // A unit signature beats the network outright, including when the network is confident
  // — the confidently-wrong routings were all cases a rule resolves unambiguously.
  if (rule) return rule.intent;

  if (!classification) return top && top.score >= 0.05 ? top.article.intent : "fallback";
  if (classification.confidence >= confidentThreshold) return classification.intent;

  // The network is hedging: let a strong article vote override it.
  if (top && top.score >= retrievalOverrideThreshold) return top.article.intent;
  if (classification.confidence >= 0.2) return classification.intent;
  if (top && top.score >= 0.08) return top.article.intent;
  return "fallback";
}

async function buildAnswer(intent: ChatIntent | "fallback", slots: Slots, hits: RetrievalHit[]): Promise<Answer> {
  if (intent === "fallback") return fallbackAnswer(hits);

  const calculation = calculationSkills[intent];
  if (calculation) {
    const article = pickArticle(intent, hits);
    const requirement = requiredSlots[intent];
    const hasOperand = !requirement || requirement.some((slot) => slots[slot] !== undefined);

    if (!hasOperand) {
      // A calculator with none of its operands would headline an invented number.
      // Explain the method when the question is conceptual, ask for inputs when it
      // looks like a real request that simply did not parse.
      return hasNumbers(slots) ? clarifyAnswer(intent, article) : methodAnswer(intent, article);
    }

    const answer = calculation(slots);
    // Conceptual questions ("چطور حساب می‌شود") deserve the method note beside the number.
    if (article && !hasNumbers(slots)) {
      return {
        ...answer,
        lines: [...answer.lines, "", "---", `**${article.title}**`, ...article.body]
      };
    }
    return answer;
  }

  const catalog = catalogSkills[intent];
  if (catalog) return catalog(slots);

  if (intent === "recommend_system") return systemDesignAnswer(slots, hits);

  if (intent === "greeting" || intent === "thanks" || intent === "help_menu" || intent === "contact") {
    return smallTalk(intent);
  }

  const article = pickArticle(intent, hits);
  if (article) {
    return {
      source: "knowledge",
      title: article.title,
      lines: article.body,
      followUps: article.followUps
    };
  }

  return fallbackAnswer(hits);
}

/**
 * The operands each calculator genuinely needs. If none are present the skill would be
 * running entirely on defaults, and presenting that as the user's answer is worse than
 * asking — this is an engineering tool, and a confident wrong number costs more than a
 * follow-up question.
 */
const requiredSlots: Partial<Record<ChatIntent, (keyof Slots)[]>> = {
  calc_storage: ["cameraCount", "days", "terabytes", "bitrateKbps"],
  calc_bandwidth: ["cameraCount", "megapixel", "bitrateKbps"],
  calc_lens_focal: ["distanceM", "sceneWidthM"],
  calc_fov: ["focalMm", "sensorInch"],
  calc_dori: ["megapixel", "focalMm", "distanceM"],
  calc_ppm: ["distanceM", "focalMm", "megapixel"],
  calc_raid: ["diskCount", "terabytes", "raidLevel"],
  calc_poe_budget: ["cameraCount", "watts"],
  calc_ups: ["cameraCount", "watts", "minutes"],
  calc_subnet: ["prefix", "ipAddress"],
  calc_wireless_link: ["distanceKm", "distanceM", "dbi", "frequencyGhz"],
  calc_fresnel: ["distanceKm", "distanceM", "frequencyGhz"],
  calc_ack: ["distanceKm", "distanceM"],
  calc_dbm: ["milliwatts", "dbm", "watts"],
  calc_channels: ["cameraCount", "channels"],
  calc_cable: ["distanceM"]
};

/** What to ask for, per calculator, when the message had numbers but not the right ones. */
const clarifyPrompts: Partial<Record<ChatIntent, string>> = {
  calc_storage: "تعداد دوربین، رزولوشن و مدت آرشیو را بگویید. مثلاً: «۱۶ دوربین ۴ مگاپیکسل، ۳۰ روز»",
  calc_bandwidth: "تعداد دوربین و رزولوشن را بگویید. مثلاً: «۱۶ دوربین ۴ مگاپیکسل»",
  calc_lens_focal: "فاصله دوربین تا سوژه و عرض صحنه را بگویید. مثلاً: «فاصله ۲۵ متر، عرض ۶ متر»",
  calc_fov: "فاصله کانونی لنز و اندازه سنسور را بگویید. مثلاً: «لنز ۴ میلی‌متر، سنسور ۱/۲.۸»",
  calc_dori: "رزولوشن، لنز و فاصله را بگویید. مثلاً: «۴ مگاپیکسل، لنز ۶ میلی‌متر»",
  calc_ppm: "فاصله سوژه و رزولوشن دوربین را بگویید. مثلاً: «۲۰ متر، ۵ مگاپیکسل»",
  calc_raid: "تعداد و ظرفیت دیسک‌ها و سطح RAID را بگویید. مثلاً: «۶ دیسک ۴ ترابایتی، RAID 5»",
  calc_poe_budget: "تعداد دوربین و توان مصرفی هرکدام را بگویید. مثلاً: «۱۶ دوربین ۱۲ وات»",
  calc_ups: "تعداد دوربین و زمان پشتیبانی موردنیاز را بگویید. مثلاً: «۱۶ دوربین، ۳۰ دقیقه»",
  calc_subnet: "آدرس و پیشوند شبکه را بگویید. مثلاً: «192.168.1.10/24»",
  calc_wireless_link: "فاصله لینک و گین آنتن را بگویید. مثلاً: «۵ کیلومتر، آنتن ۲۴ دی‌بی»",
  calc_fresnel: "فاصله لینک و فرکانس را بگویید. مثلاً: «۳ کیلومتر، ۵ گیگاهرتز»",
  calc_ack: "فاصله لینک را بگویید. مثلاً: «۱۰ کیلومتر»",
  calc_dbm: "مقدار و واحد را بگویید. مثلاً: «۱۰۰ میلی‌وات» یا «۲۰ dBm»",
  calc_channels: "تعداد دوربین را بگویید. مثلاً: «۱۸ دوربین»",
  calc_cable: "طول مسیر کابل را بگویید. مثلاً: «۱۸۰ متر»"
};

function clarifyAnswer(intent: ChatIntent, article?: KnowledgeArticle): Answer {
  return {
    source: "system",
    title: "برای محاسبه به یک ورودی دیگر نیاز دارم",
    lines: [
      clarifyPrompts[intent] ?? "لطفاً عدد و واحد موردنیاز را در جمله بیاورید.",
      "",
      "عددی را حدس نمی‌زنم تا پاسخ اشتباه به شما ندهم."
    ],
    tool: article ? undefined : undefined,
    followUps: article?.followUps
  };
}

/** No numbers at all: the user is asking how it works, so explain the method. */
function methodAnswer(intent: ChatIntent, article?: KnowledgeArticle): Answer {
  if (article) {
    return {
      source: "knowledge",
      title: article.title,
      lines: [
        ...article.body,
        "",
        "---",
        clarifyPrompts[intent] ? `**برای محاسبه عددی:** ${clarifyPrompts[intent]}` : ""
      ].filter((line, index, all) => line !== "" || all[index - 1] !== ""),
      followUps: article.followUps
    };
  }
  return clarifyAnswer(intent);
}

function pickArticle(intent: ChatIntent, hits: RetrievalHit[]): KnowledgeArticle | undefined {
  const matching = hits.find((hit) => hit.article.intent === intent);
  if (matching) return matching.article;
  return knowledgeByIntent[intent]?.[0] ?? hits[0]?.article;
}

function hasNumbers(slots: Slots) {
  return slots.numbers.length > 0;
}

/** Composite answer: sizes an entire system from whatever the user mentioned. */
function systemDesignAnswer(slots: Slots, hits: RetrievalHit[]): Answer {
  const presets: Record<NonNullable<Slots["projectType"]>, { cameras: number; days: number; label: string }> = {
    residential: { cameras: 6, days: 15, label: "منزل مسکونی" },
    shop: { cameras: 5, days: 30, label: "مغازه" },
    office: { cameras: 12, days: 30, label: "دفتر اداری" },
    factory: { cameras: 24, days: 45, label: "کارخانه یا انبار" },
    parking: { cameras: 8, days: 30, label: "پارکینگ" }
  };

  const preset = slots.projectType ? presets[slots.projectType] : undefined;
  const cameraCount = slots.cameraCount ?? preset?.cameras ?? 8;
  const days = slots.days ?? preset?.days ?? 30;
  const megapixel = slots.megapixel ?? 4;
  const perCameraKbps = referenceBitrateKbps(megapixel);
  const totalKbps = perCameraKbps * cameraCount;
  const totalMbps = kbpsToMbps(totalKbps);

  const storage = calculateSurveillanceStorage({
    totalVideoBitrateKbps: totalKbps,
    cameraCount,
    archiveDays: days,
    recordingMode: "continuous",
    motionActivityPercent: 30,
    bitrateMode: "VBR",
    recordAudio: false,
    audioBitrateKbps: 64,
    filesystemOverheadPercent: 5,
    vbrSafetyMarginPercent: 15,
    reservePercent: 10
  });

  const channels = [4, 8, 16, 32, 64, 128].find((option) => option >= Math.ceil(cameraCount * 1.25)) ?? 128;
  const poeLoad = cameraCount * 8 * 1.2;
  const upsLoad = (cameraCount * 8 * 1.12 + 40 + 16) * 1.25;
  const diskCount = Math.max(1, Math.ceil(storage.requiredStorageTb / 4));

  const article = pickArticle("recommend_system", hits);

  return {
    source: "calculation",
    title: `طرح پیشنهادی${preset ? ` برای ${preset.label}` : ""} با ${formatFa(cameraCount)} دوربین`,
    lines: [
      `**دوربین:** ${formatFa(cameraCount)} عدد ${formatFa(megapixel, 1)} مگاپیکسل${slots.outdoor ? "، حداقل IP66 برای موقعیت‌های بیرونی" : ""}`,
      `**دستگاه ضبط:** NVR ${formatFa(channels)} کانال با پهنای باند ورودی حداقل ${formatFa(Math.ceil((totalMbps * 1.2) / 10) * 10)} مگابیت بر ثانیه`,
      `**ذخیره‌سازی:** ${formatFa(storage.requiredStorageTb, 1)} ترابایت برای ${formatFa(days)} روز آرشیو ← حدود ${formatFa(diskCount)} هارد ۴ ترابایتی Surveillance`,
      `**سوئیچ:** حداقل ${formatFa(Math.ceil(cameraCount * 1.25))} پورت PoE با بودجه توان ${formatFa(Math.ceil(poeLoad / 30) * 30)} وات`,
      `**برق اضطراری:** UPS با توان خروجی حداقل ${formatFa(upsLoad)} وات`,
      `**شبکه:** یک /۲۴ اختصاصی روی VLAN جدا از شبکه اداری`,
      "",
      `بار شبکه این طرح: **${formatFa(totalMbps, 1)} مگابیت بر ثانیه**`,
      "",
      "---",
      article ? `**${article.title}**` : "",
      ...(article ? article.body : [])
    ].filter((line, index, all) => !(line === "" && all[index - 1] === "")),
    assumptions: [
      slots.cameraCount === undefined ? `تعداد دوربین از الگوی ${preset?.label ?? "پیش‌فرض"} گرفته شد: ${formatFa(cameraCount)}` : "",
      slots.days === undefined ? `مدت آرشیو فرض شد: ${formatFa(days)} روز` : "",
      slots.megapixel === undefined ? "رزولوشن فرض شد: ۴ مگاپیکسل" : "",
      "مصرف هر دوربین ۸ وات و ضبط پیوسته ۲۴ ساعته"
    ].filter(Boolean),
    tool: { slug: "__planner__", label: "طراحی هوشمند با نقشه پوشش" },
    followUps: ["اگر آرشیو ۹۰ روز باشد چقدر هارد لازم است؟", "بودجه PoE این طرح چقدر است؟"]
  };
}

function smallTalk(intent: "greeting" | "thanks" | "help_menu" | "contact"): Answer {
  if (intent === "greeting") {
    return {
      source: "system",
      title: "سلام 👋",
      lines: [
        "من دستیار فنی همیار دوربین هستم؛ درباره دوربین مداربسته، شبکه و محاسبات پروژه کمک می‌کنم.",
        "",
        "سوالتان را با عدد بپرسید تا مستقیم محاسبه کنم. مثلاً:",
        "• «برای ۱۶ دوربین ۴ مگاپیکسل و ۳۰ روز آرشیو چقدر هارد لازم است؟»",
        "• «لنز مناسب برای شناسایی چهره در ۲۵ متری چیست؟»",
        "• «قیمت NVR ۱۶ کانال چقدر است؟»"
      ]
    };
  }

  if (intent === "thanks") {
    return {
      source: "system",
      title: "خواهش می‌کنم",
      lines: ["اگر سوال فنی دیگری درباره دوربین، شبکه یا محاسبات پروژه دارید بپرسید."]
    };
  }

  if (intent === "contact") {
    return {
      source: "system",
      title: "ارتباط با کارشناس",
      lines: [
        "اطلاعات تماس، آدرس و ساعت کاری در صفحه «تماس با ما» آمده است.",
        "",
        "اگر سوال فنی دارید، همین‌جا بپرسید — محاسبات و مشخصات را بدون نیاز به اینترنت پاسخ می‌دهم."
      ],
      tool: { slug: "__contacts__", label: "صفحه تماس با ما" }
    };
  }

  return {
    source: "system",
    title: "چه کارهایی می‌توانم انجام دهم",
    lines: [
      "**محاسبات پروژه**",
      "ظرفیت هارد و آرشیو، پهنای باند، انتخاب لنز و زاویه دید، فواصل DORI، تراکم پیکسل، ظرفیت RAID، بودجه PoE، انتخاب UPS، ساب‌نت IP، بودجه لینک بی‌سیم، ناحیه فرنل، زمان ACK، تبدیل mW و dBm، تعداد کانال و محدودیت طول کابل.",
      "",
      "**مشخصات و دانش فنی**",
      "رزولوشن و سنسور، کدک‌ها، درجه IP و IK، دید در شب، WDR، PTZ، انواع دوربین، تفاوت NVR و DVR، استانداردهای PoE، ONVIF، قابلیت‌های هوش مصنوعی، انواع لنز، اصول نصب، عیب‌یابی و استانداردهای مرجع.",
      "",
      "**شبکه و امنیت دفاعی**",
      "طراحی شبکه، VLAN، فایروال، VPN و دسترسی از راه دور، امن‌سازی دوربین و NVR، امنیت Wi‑Fi، پاسخ به نفوذ، کنترل تردد و دزدگیر.",
      "",
      "**محصولات و قیمت**",
      "جست‌وجو در کاتالوگ محلی، بازه قیمت هر دسته و مقایسه محصولات.",
      "",
      "**طراحی سیستم**",
      "یک طرح کامل با دوربین، دستگاه، هارد، سوئیچ و UPS بر اساس نوع پروژه."
    ]
  };
}

function fallbackAnswer(hits: RetrievalHit[]): Answer {
  if (hits.length) {
    return {
      source: "knowledge",
      title: "مطمئن نیستم منظورتان کدام بود",
      lines: [
        "نزدیک‌ترین موضوعاتی که درباره‌شان اطلاعات دارم:",
        "",
        ...hits.map((hit) => `• ${hit.article.title}`),
        "",
        "سوال را کمی مشخص‌تر بپرسید، یا عدد و واحد را در جمله بیاورید تا مستقیم محاسبه کنم."
      ],
      followUps: hits.flatMap((hit) => hit.article.followUps ?? []).slice(0, 3)
    };
  }

  return offTopicAnswer();
}

function offTopicAnswer(): Answer {
  return {
    source: "system",
    title: "این موضوع خارج از تخصص من است",
    lines: [
      "من درباره دوربین مداربسته، شبکه، امنیت سایبری دفاعی، کنترل تردد، دزدگیر و محاسبات مرتبط پاسخ می‌دهم.",
      "",
      "برای دیدن فهرست کامل توانایی‌ها بنویسید: «چه کارهایی می‌توانی انجام بدهی؟»"
    ]
  };
}

function securityBoundaryAnswer(): Answer {
  return {
    source: "system",
    title: "در امنیت دفاعی کمکتان می‌کنم",
    lines: [
      "نمی‌توانم برای نفوذ بدون مجوز، شکستن رمز، دورزدن کنترل دسترسی، پاک‌کردن ردپا یا مختل‌کردن سامانه حفاظتی راهنمای عملیاتی بدهم.",
      "",
      "اگر تجهیز متعلق به خودتان است، می‌توانم برای بازیابی رسمی دسترسی، جداسازی دستگاه مشکوک، بررسی Log، امن‌سازی شبکه یا طراحی آزمون مجاز مرحله‌به‌مرحله کمک کنم."
    ],
    followUps: ["فکر کنم دوربین خودم هک شده؛ چه کنم؟", "چک‌لیست امن‌سازی NVR را بگو"]
  };
}

function reply(
  answer: Answer,
  intent: ChatIntent | "fallback",
  confidence: number,
  classification: ReturnType<AssistantModel["classify"]>,
  hits: RetrievalHit[],
  slots?: Slots
): ChatReply {
  return {
    answer,
    intent,
    confidence,
    reasoning: {
      intents: classification?.ranked ?? [],
      articles: hits.map((hit) => ({ title: hit.article.title, score: hit.score })),
      modelReady: AssistantModel.getInstance().isReady(),
      slots: slots ? describeSlots(slots) : []
    }
  };
}

function describeSlots(slots: Slots): string[] {
  const labels: [keyof Slots, string][] = [
    ["cameraCount", "تعداد دوربین"],
    ["channels", "کانال"],
    ["megapixel", "مگاپیکسل"],
    ["days", "روز آرشیو"],
    ["distanceM", "فاصله (متر)"],
    ["distanceKm", "فاصله (کیلومتر)"],
    ["sceneWidthM", "عرض صحنه (متر)"],
    ["focalMm", "فاصله کانونی (میلی‌متر)"],
    ["terabytes", "ترابایت"],
    ["diskCount", "تعداد دیسک"],
    ["raidLevel", "سطح RAID"],
    ["watts", "وات"],
    ["prefix", "پیشوند شبکه"],
    ["frequencyGhz", "فرکانس (گیگاهرتز)"],
    ["budgetToman", "بودجه (تومان)"]
  ];

  return labels
    .filter(([key]) => slots[key] !== undefined)
    .map(([key, label]) => `${label}: ${slots[key]}`);
}
