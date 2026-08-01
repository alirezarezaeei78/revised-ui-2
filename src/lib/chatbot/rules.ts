import type { ChatIntent } from "@/src/lib/chatbot/corpus";
import type { Slots } from "@/src/lib/chatbot/slots";

/**
 * High-precision routing rules, evaluated before the neural classifier.
 *
 * Some questions carry an unambiguous signature — an IP address with a prefix, a RAID
 * level, the word "فرنل" — and a softmax should never get a vote on those. Held-out
 * testing had the network routing "۲۴ دوربین هرکدوم ۹ وات چه سوییچی" to the storage
 * calculator at 0.91 confidence; a unit signature is simply more reliable than a
 * 400-sample model, so where one exists it wins outright.
 *
 * Every rule here must be high precision, not high recall. Anything ambiguous is left
 * to the classifier and retrieval.
 */

export type RuleMatch = { intent: ChatIntent; reason: string };

type Rule = { intent: ChatIntent; reason: string; test: (text: string, slots: Slots) => boolean };

const rules: Rule[] = [
  {
    intent: "calc_subnet",
    reason: "آدرس IP همراه با پیشوند شبکه",
    test: (text, slots) =>
      (slots.ipAddress !== undefined && slots.prefix !== undefined) ||
      (slots.prefix !== undefined && /هاست|ساب ?نت|سابنت|ماسک|براد ?کست|رنج|شبکه/.test(text))
  },
  {
    intent: "calc_dbm",
    reason: "تبدیل واحد توان رادیویی",
    test: (text) => /dbm|دی ?بی ?ام|دسی ?بل میلی ?وات/.test(text) && /میلی ?وات|\bmw\b|وات|توان/.test(text)
  },
  {
    intent: "calc_fresnel",
    reason: "ناحیه فرنل",
    test: (text) => /فرنل|fresnel/.test(text)
  },
  {
    intent: "calc_ack",
    reason: "زمان ACK",
    test: (text) => /\back\b|ای ?سی ?کی|زمان تاییدیه/.test(text)
  },
  {
    intent: "calc_raid",
    reason: "سطح RAID مشخص شده",
    test: (_text, slots) => slots.raidLevel !== undefined
  },
  {
    intent: "calc_poe_budget",
    reason: "توان و سوئیچ PoE",
    test: (text, slots) =>
      /سوئیچ|سوییچ|\bpoe\b|پی ?او ?ای/.test(text) &&
      (slots.watts !== undefined || /بودجه|توان|وات|برق/.test(text))
  },
  {
    intent: "calc_wireless_link",
    reason: "بودجه لینک بی‌سیم",
    test: (text, slots) =>
      /لینک|بی ?سیم|وایرلس|رادیو|آنتن|انتن/.test(text) &&
      (slots.distanceKm !== undefined || slots.dbi !== undefined || /سیگنال|افت مسیر|fspl|بودجه/.test(text))
  },
  {
    intent: "calc_ups",
    reason: "برق اضطراری",
    test: (text) => /\bups\b|یو ?پی ?اس|برق اضطراری|باتری پشتیبان/.test(text)
  },
  {
    intent: "calc_cable",
    reason: "محدودیت طول کابل",
    test: (text, slots) =>
      /\bcat ?[56]\b|extend|اکستند/.test(text) ||
      (/کابل/.test(text) && (slots.distanceM ?? 0) > 90) ||
      ((slots.distanceM ?? 0) > 100 && /سوئیچ|سوییچ|دوربین|فاصله/.test(text) && !/لنز|کانونی|زاویه|شناسایی|چهره|پلاک/.test(text))
  },
  {
    intent: "calc_ppm",
    reason: "تراکم پیکسل",
    test: (text) => /پیکسل بر متر|\bppm\b|تراکم پیکسل|پیکسل ?بر ?متر/.test(text)
  },
  {
    intent: "calc_fov",
    reason: "زاویه دید",
    test: (text) => /زاویه ?دید|چند درجه|\bfov\b|field of view/.test(text)
  },
  {
    intent: "calc_storage",
    reason: "حجم آرشیو",
    test: (text, slots) =>
      /هارد|ترابایت|ذخیره ?سازی|آرشیو|بایگانی|نگهداری تصویر/.test(text) &&
      (
        slots.days !== undefined ||
        slots.terabytes !== undefined ||
        (slots.cameraCount !== undefined && /هارد|آرشیو|ذخیره ?سازی/.test(text)) ||
        /چند روز|چقدر فضا|چند ترابایت/.test(text)
      )
  },
  {
    intent: "calc_channels",
    reason: "تعداد کانال دستگاه",
    test: (text) => /چند کانال|چند کاناله|کانال بگیرم|تعداد کانال/.test(text)
  },
  {
    intent: "product_compare",
    reason: "مقایسه صریح مدل یا برند محصول",
    test: (text) =>
      /مقایسه|کدام بهتر|کدوم بهتر|فرق.*مدل|بهتره یا/.test(text) &&
      /دوربین|nvr|dvr|سوئیچ|سوییچ|هارد|ups|تیاندی|هایک|داهوا|اپتینت|tiandy|hikvision|dahua|optinet|tc-|ds-/.test(text)
  },
  {
    intent: "product_price",
    reason: "استعلام قیمت یک محصول مشخص",
    test: (text) =>
      /قیمت|چند تومن|چند تومان|چنده|هزینه خرید/.test(text) &&
      /دوربین|nvr|dvr|سوئیچ|سوییچ|هارد|ups|تیاندی|هایک|داهوا|اپتینت|tiandy|hikvision|dahua|optinet|tc-|ds-/.test(text)
  },
  {
    intent: "product_search",
    reason: "درخواست معرفی یا جست‌وجوی محصول با مشخصات",
    test: (text) =>
      /معرفی|پیشنهاد|موجود|لیست|نشان|نشون|چه مدلی|مدل.*خوب|مدل.*مناسب|چی بخرم|چی بگیرم/.test(text) &&
      /دوربین|nvr|dvr|سوئیچ|سوییچ|هارد|ups|تیاندی|هایک|داهوا|اپتینت|tiandy|hikvision|dahua|optinet|tc-|ds-/.test(text)
  },
  {
    intent: "info_codec",
    reason: "نام کدک",
    test: (text) => /h ?\.?26[45]|hevc|\bavc\b|کدک|فشرده ?سازی/.test(text)
  },
  {
    intent: "info_incident_response",
    reason: "نشانه رخداد یا نفوذ به سامانه نظارتی",
    test: (text) => /هک شده|نفوذ شده|ورود مشکوک|لاگین مشکوک|ip ناشناس|ای ?پی ناشناس|تنظیمات.*عوض شده|ترافیک مشکوک|رمز.*لو رفته/.test(text)
  },
  {
    intent: "info_device_hardening",
    reason: "امن‌سازی تجهیزات نظارتی",
    test: (text) => /امن ?سازی|هاردنینگ|hardening|رمز پیش ?فرض|فریم ?ور|firmware|upnp|telnet|جلوگیری از هک/.test(text)
  },
  {
    intent: "info_vlan",
    reason: "تفکیک شبکه با VLAN",
    test: (text) => /\bvlan\b|وی ?لن|تفکیک شبکه|segment|شبکه جدا/.test(text) && /دوربین|nvr|شبکه|کاربر|مدیریت/.test(text)
  },
  {
    intent: "info_firewall",
    reason: "سیاست فایروال و کنترل پورت",
    test: (text) => /فایروال|firewall|\bacl\b|default deny|پورت.*(?:باز|ببند|محدود)/.test(text)
  },
  {
    intent: "info_remote_access",
    reason: "دسترسی امن از راه دور",
    test: (text) => /\bvpn\b|دسترسی از راه دور|remote access|port forwarding|پورت فوروارد|فوروارد پورت|\bp2p\b/.test(text)
  },
  {
    intent: "info_wifi_security",
    reason: "امنیت شبکه بی‌سیم",
    test: (text) => /\bwpa[23]?\b|\bwps\b|امنیت.*(?:wifi|وای ?فای)|رمز.*وای ?فای|ssid/.test(text)
  },
  {
    intent: "info_access_control",
    reason: "کنترل تردد و دسترسی فیزیکی",
    test: (text) => /اکسس کنترل|کنترل تردد|کارتخوان|اثر انگشت|قفل برقی|fail ?safe|fail ?secure|anti ?passback/.test(text)
  },
  {
    intent: "info_alarm_security",
    reason: "دزدگیر و اعلام سرقت",
    test: (text) => /دزدگیر|اعلام سرقت|سنسور.*(?:حرکت|pir)|\bpir\b|مگنت.*(?:در|پنجره)|آژیر|زون دزدگیر|تمپر|tamper/.test(text)
  },
  {
    intent: "info_network_design",
    reason: "طراحی معماری شبکه نظارتی",
    test: (text) => /طراحی شبکه|توپولوژی|سوییچ مرکزی|سوئیچ مرکزی|core switch|uplink|آپ ?لینک|رینگ شبکه|\brstp\b|\bqos\b/.test(text)
  },
  {
    intent: "info_poe_standard",
    reason: "کلاس استاندارد PoE",
    test: (text) => /802\.3 ?[a-z]{1,2}/.test(text) || (/\b(?:af|at|bt)\b/.test(text) && /poe|سوئیچ|سوییچ|تغذیه|پی ?او ?ای/.test(text))
  },
  {
    intent: "info_install",
    reason: "ارتفاع و محل نصب",
    test: (text) => /ارتفاع نصب|ارتفاع دوربین|چند متری بذارم|چند متری نصب|کجا نصب|زاویه نصب/.test(text)
  },
  {
    intent: "info_ip_rating",
    reason: "درجه حفاظت",
    test: (text) => /\bip ?6[5678]\b|\bik ?\d{2}\b|ضد ?آب|ضد ?ضربه|بارون|باران/.test(text)
  },
  {
    intent: "info_onvif",
    reason: "سازگاری بین برندی",
    // Brand names are matched in Persian script too: the slot text is only normalised,
    // not run through the tokeniser's brand lexicon, so "داهوا" never becomes "dahua".
    test: (text) =>
      /onvif|انویف|\brtsp\b/.test(text) ||
      (/برند|داهوا|هایک|تیاندی|هایلوک|یونی ?ویو|tiandy|hikvision|dahua|hilook|uniview/.test(text) &&
        /وصل|سازگار|کار ?میکنه|شناسایی|میشه|میخوره/.test(text))
  },
  {
    intent: "info_wdr",
    reason: "کنتراست و نور پشت سوژه",
    test: (text) => /\bwdr\b|\bblc\b|\bhlc\b|نور پشت|بک ?لایت|نور خورشید|ضد نور/.test(text)
  },
  {
    intent: "info_nvr_dvr",
    reason: "نوع دستگاه ضبط",
    test: (text) => /آنالوگ|انالوگ|\bxvr\b|هایبرید|کواکسیال/.test(text) && /دستگاه|nvr|dvr|وصل|ضبط/.test(text)
  }
];

export function matchRule(text: string, slots: Slots): RuleMatch | null {
  for (const rule of rules) {
    if (rule.test(text, slots)) return { intent: rule.intent, reason: rule.reason };
  }
  return null;
}

/**
 * Subjects that are confidently *not* ours. The vocabulary-overlap gate cannot catch
 * these because words like "قیمت" are genuinely in the catalog vocabulary — that is how
 * "قیمت دلار امروز چنده" reached the product lookup at full confidence.
 */
/*
 * Written against *normalised* text, which folds آ/أ/إ onto ا. Matching a literal "آ"
 * here silently never fires — that is how "آب و هوای تهران" reached the price lookup.
 * The [آا] classes keep the patterns correct either way.
 */
const offTopicPatterns = [
  /دلار|یورو|طلا|سکه|بورس|ارز دیجیتال|بیت ?کوین|رمز ?ارز/,
  /[آا]ب ?و ?هوا|هواشناسی|دما[یی]? هوا/,
  /پایتخت|جمعیت کشور|تاریخ تولد|فوتبال|بازیکن|فیلم|سریال|[آا]هنگ/,
  /دستور پخت|[آا]شپزی|رژیم غذایی|پزشک|دارو|بیماری/,
  /ترجمه کن|شعر بگو|جوک|داستان بنویس/
];

export function isExplicitlyOffTopic(text: string): boolean {
  return offTopicPatterns.some((pattern) => pattern.test(text));
}

/**
 * High-precision safety boundary for requests that would enable unauthorised access,
 * credential theft or deliberate disruption. Defensive questions such as "دوربینم
 * هک شده" are intentionally excluded and route to incident response instead.
 */
const unsafeSecurityPatterns = [
  /(?:چطور|چگونه|روش|راه).*(?:هک|نفوذ).*(?:دوربین|nvr|dvr|شبکه|وای ?فای|wifi|دزدگیر|اکسس کنترل).*(?:کسی|همسایه|بدون اجازه|ناشناس)/,
  /(?:رمز|پسورد|گذرواژه).*(?:بشکن|کرک|حدس بزن|دور بزن|بای ?پس)/,
  /(?:بشکن|کرک|دور بزن|بای ?پس).*(?:رمز|پسورد|گذرواژه|احراز هویت)/,
  /(?:کور|مختل|از کار خارج|غیر ?فعال).*(?:دوربین|دزدگیر|اعلام سرقت|کنترل تردد).*(?:بدون اجازه|مخفیانه|کسی)/,
  /(?:پاک|حذف).*(?:لاگ|ردپا|سابقه).*(?:نفوذ|هک|ورود)/,
  /(?:جمینگ|jammer|پارازیت).*(?:دوربین|دزدگیر|سیستم امنیتی)/
];

export function isUnsafeSecurityRequest(text: string): boolean {
  return unsafeSecurityPatterns.some((pattern) => pattern.test(text));
}
