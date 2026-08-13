import type { ProductCategory, SourceCatalogPage, SourceCatalogProduct } from "@/src/domain/catalog/types";
import type { Answer } from "@/src/lib/chatbot/skills";
import { formatFa, formatToman, normalizePersian } from "@/src/lib/chatbot/persian";
import type { Slots } from "@/src/lib/chatbot/slots";

/**
 * Product, price and comparison answers.
 *
 * Everything here reads the local ddcpersia mirror through the app's own catalog API.
 * The assistant never invents a price: if the snapshot has no match it says so, and if
 * a product has no recorded price it reports that instead of guessing.
 */

export type CatalogProductRef = { name: string; price: number; sourceUrl: string };

export type CatalogRequest = {
  category?: ProductCategory;
  brand?: string;
  resolutionMp?: number;
  requestedCount: number;
  search: string;
  wantsRecommendation: boolean;
};

const brandAliases: { pattern: RegExp; brand: string }[] = [
  { pattern: /(?:تیان\s*دی|تیاندی|tiandy)/i, brand: "Tiandy" },
  { pattern: /(?:هایک\s*ویژن|هایکویژن|هایک|hikvision)/i, brand: "Hikvision" },
  { pattern: /(?:داهوا|دیهوا|dahua)/i, brand: "Dahua" },
  { pattern: /(?:اپتی\s*نت|اپتینت|optinet)/i, brand: "OptiNet" },
  { pattern: /(?:لول\s*وان|level\s*one|levelone)/i, brand: "LevelOne" },
  { pattern: /(?:یونی\s*ویو|یونیویو|uniview)/i, brand: "Uniview" },
  { pattern: /(?:های\s*لوک|هایلوک|hilook)/i, brand: "HiLook" },
  { pattern: /(?:اکسیس|axis)/i, brand: "Axis" }
];

const categoryWords: [RegExp, ProductCategory][] = [
  [/دوربین|کمرا|camera|بولت|دام|توربولت|ptz/, "camera"],
  [/nvr|ان ?وی ?ار|dvr|دی ?وی ?ار|xvr|اکس ?وی ?ار|دستگاه|ضبط|رکوردر|کاناله|کانال/, "recorder"],
  [/سوئیچ|سوییچ|switch|poe|پی ای|پورت/, "switch"],
  [/هارد|hdd|دیسک|storage|ترابایت|سرویلنس|purple|skyhawk/, "storage"],
  [/ups|یو پی اس|برق اضطراری|باتری/, "ups"]
];

/** Words that describe the question rather than the product being searched for. */
const stopWords = new Set([
  "قیمت", "قیمتش", "چند", "چنده", "هست", "هستش", "دارید", "داری", "میخوام", "می خوام", "لطفا",
  "بگو", "نشان", "نشون", "بده", "لیست", "موجود", "موجودی", "برای", "یک", "یه", "تا", "از", "با",
  "در", "به", "را", "رو", "و", "چه", "کدوم", "کدام", "بهترین", "ارزان", "ارزون", "گران", "گرون",
  "ترین", "محصول", "محصولات", "مدل", "خرید", "بخرم", "تومان", "تومن", "هزینه", "میشه", "است",
  "معرفی", "کن", "کنید", "پیشنهاد", "خوب", "مناسب", "مگاپیکسل", "مگاپیکسلی", "مگا", "پیکسل",
  "دونه", "دانه", "عدد", "بهم", "بم", "برام", "بده", "بگی", "بگین", "میگی", "میشه",
  "میخوام", "میخام", "میخواستم", "میخاستم", "خواستن", "واسه"
]);

function detectCategory(text: string): ProductCategory | undefined {
  for (const [pattern, category] of categoryWords) {
    if (pattern.test(text)) return category;
  }
  return undefined;
}

/** Keeps model numbers and brand-like tokens, drops the conversational filler. */
function detectBrand(text: string) {
  return brandAliases.find((item) => item.pattern.test(text))?.brand;
}

function buildSearchTerm(text: string, brand?: string): string {
  const tokens = normalizePersian(text)
    .split(" ")
    .filter((token) => token.length > 1 && !stopWords.has(token))
    .filter((token) => !/^\d+$/.test(token))
    .filter((token) => !/^\d+(?:\.\d+)?(?:mp|مگاپیکسل)$/.test(token))
    .filter((token) => !brand || token.toLocaleLowerCase("en") !== brand.toLocaleLowerCase("en"))
    .filter((token) => !brandAliases.some((item) => item.pattern.test(token)));

  const modelLike = tokens.filter((token) => /[a-z]/.test(token) && /[0-9\-]/.test(token));
  if (modelLike.length) return modelLike.slice(0, 2).join(" ");

  const latin = tokens.filter((token) => /^[a-z][a-z0-9\-]{2,}$/.test(token));
  if (latin.length) return latin.slice(0, 2).join(" ");

  return "";
}

export function parseCatalogRequest(slots: Slots): CatalogRequest {
  const brand = detectBrand(slots.text);
  const category = detectCategory(slots.text);
  return {
    category,
    brand,
    resolutionMp: slots.megapixel,
    requestedCount: Math.min(4, Math.max(1, Math.floor(category === "camera" ? (slots.cameraCount ?? 1) : 1))),
    search: buildSearchTerm(slots.text, brand),
    wantsRecommendation: /معرفی|پیشنهاد|خوب|مناسب|(?:چی|کدومو|کدوم)\s*(?:بگیرم|بخرم)|چه\s*مدلی|(?:بهم|بم|برام)?\s*(?:بگو|بگی|بگین|میگی|بده)|میشه\s*(?:بگی|بگین)|(?:میخوام|میخام|میخواستم|میخاستم|می خواهم)/.test(slots.text)
  };
}

async function fetchCatalog(params: Record<string, string>): Promise<SourceCatalogPage | null> {
  try {
    const query = new URLSearchParams({ page: "1", limit: "24", inStock: "true", ...params });
    const response = await fetch(`/api/assistant/catalog?${query}`, { cache: "no-store" });
    if (!response.ok) return null;
    return (await response.json()) as SourceCatalogPage;
  } catch {
    return null;
  }
}

const unavailable: Answer = {
  source: "catalog",
  title: "کاتالوگ محلی در دسترس نیست",
  lines: [
    "در حال حاضر نتوانستم اطلاعات محصول را از کاتالوگ محلی بخوانم؛ بنابراین مدل یا قیمت حدس نمی‌زنم.",
    "",
    "سرویس کاتالوگ و پایگاه داده را بررسی کنید یا کمی بعد دوباره بپرسید."
  ]
};

function productLine(product: SourceCatalogProduct) {
  const stock = product.stockStatus === "out_of_stock" ? "ناموجود" : product.stockStatus === "low_stock" ? "موجودی محدود" : "موجود";
  const commercial = product.source === "woocommerce" ? `${formatToman(product.price)} — ${stock}` : "داده نمایشی؛ قیمت و موجودی قابل استناد نیست";
  return `• **${product.name}** — Part Number: **${product.sku}** — ${commercial}${product.brand && product.brand !== "بدون برند" ? ` — ${product.brand}` : ""}`;
}

const factLabels: Record<string, string> = {
  resolution: "رزولوشن", resolutionMp: "رزولوشن (MP)", sensor: "سنسور", sensorFormat: "اندازه سنسور",
  lens: "لنز", focalLength: "فاصله کانونی", irRange: "برد IR", irRangeM: "برد IR (متر)",
  microphone: "میکروفن", audio: "صدا", poe: "PoE", ipRating: "درجه IP", ikRating: "درجه IK",
  wdr: "WDR", maxFps: "حداکثر FPS", codecs: "کدک‌ها", aiFeatures: "قابلیت‌های AI",
  localStorage: "حافظه محلی", localStorageGb: "حافظه محلی (GB)", maxPowerW: "حداکثر توان (W)"
};

function formatFactValue(value: string | number | boolean | string[]) {
  if (Array.isArray(value)) return value.join("، ");
  if (typeof value === "boolean") return value ? "دارد" : "ندارد";
  return String(value);
}

function verifiedTechnicalDetails(product: SourceCatalogProduct) {
  if (!product.datasheet) {
    return [
      "• **مشخصات فنی این Part Number هنوز با دیتاشیت سازنده در پایگاه محلی تأیید نشده است.**",
      "• برای جلوگیری از اطلاعات اشتباه، لنز، IR، صدا، PoE، IP/IK، WDR، FPS، کدک و قابلیت AI را حدس نمی‌زنم."
    ];
  }
  const facts = Object.entries(product.datasheet.facts).slice(0, 12).map(([key, value]) =>
    `• ${factLabels[key] ?? key}: **${formatFactValue(value)}**`
  );
  return [
    `• Part Number تأییدشده: **${product.datasheet.partNumber}**`,
    ...facts,
    `• منبع مشخصات: **${product.datasheet.sourceTitle}**`
  ];
}

export async function productSearchSkill(slots: Slots): Promise<Answer> {
  const request = parseCatalogRequest(slots);
  const page = await fetchCatalog({
    q: request.search,
    category: request.category ?? "all",
    ...(request.brand ? { brand: request.brand } : {}),
    ...(request.resolutionMp !== undefined ? { resolutionMp: String(request.resolutionMp) } : {})
  });
  if (!page) return unavailable;

  if (!page.products.length) {
    return {
      source: "catalog",
      title: request.search ? "Part Number تأیید نشد" : "محصولی پیدا نشد",
      lines: [
        request.search
          ? `مدل یا Part Number دقیق «${request.search}» در کاتالوگ محلی و رکوردهای دیتاشیت پیدا نشد؛ بنابراین هیچ ویژگی فنی برای آن اعلام نمی‌کنم.`
          : "در کاتالوگ محلی محصولی مطابق این جست‌وجو ثبت نشده است.",
        "",
        "Part Number کامل را دقیقاً مطابق برچسب دستگاه یا دیتاشیت سازنده بنویسید، چون پسوندهای نزدیک ممکن است مشخصات متفاوتی داشته باشند."
      ],
      tool: { slug: "__catalog__", label: "مشاهده همه محصولات" }
    };
  }

  const shown = page.products.slice(0, 6);
  if ((request.wantsRecommendation || (request.search && shown.length === 1)) && shown.length) {
    const selectedProducts = shown.slice(0, request.requestedCount);
    const allLive = selectedProducts.every((product) => product.source === "woocommerce");
    const allDatasheets = selectedProducts.every((product) => Boolean(product.datasheet));
    const requested = [
      request.brand,
      request.resolutionMp !== undefined ? `${formatFa(request.resolutionMp)} مگاپیکسل` : undefined
    ].filter(Boolean).join("، ");
    const productBlocks = selectedProducts.flatMap((product, index) => {
      const liveListing = product.source === "woocommerce";
      return [
        selectedProducts.length > 1 ? `**گزینه ${formatFa(index + 1)} — ${product.name}**` : `• مدل ثبت‌شده: **${product.name}**`,
        `• Part Number کاتالوگ: **${product.sku}**`,
        ...verifiedTechnicalDetails(product),
        liveListing
          ? `• قیمت ثبت‌شده: **${formatToman(product.price)}**؛ وضعیت: **${product.stockStatus === "low_stock" ? "موجودی محدود" : "موجود"}**`
          : "• قیمت و موجودی داده نمایشی عمداً به‌عنوان اطلاعات واقعی اعلام نمی‌شود.",
        index < selectedProducts.length - 1 ? "---" : ""
      ];
    });
    return {
      source: "catalog",
      title: selectedProducts.length > 1
        ? `${formatFa(selectedProducts.length)} مدل ${allLive ? "مبتنی بر کاتالوگ" : "نیازمند تأیید"}`
        : `${allLive ? "پیشنهاد مبتنی بر کاتالوگ" : "نمونه نیازمند تأیید"}: ${selectedProducts[0].name}`,
      lines: [
        allLive
          ? `بر اساس آخرین همگام‌سازی فروشگاه، ${formatFa(selectedProducts.length)} مدل متمایز با درخواست **${requested || "شما"}** تطابق دارد:`
          : `این ${formatFa(selectedProducts.length)} مدل در داده نمایشی توسعه با درخواست **${requested || "شما"}** تطابق دارند و هنوز پیشنهاد تجاری تأییدشده نیستند:`,
        selectedProducts.length < request.requestedCount
          ? `از ${formatFa(request.requestedCount)} مدل درخواستی، فقط ${formatFa(selectedProducts.length)} مدل منطبق پیدا شد.`
          : "",
        "",
        ...productBlocks,
        "",
        "برای تأیید اینکه واقعاً بهترین انتخاب پروژه شماست، فاصله سوژه، فضای داخل/بیرون و نیاز به میکروفن را هم بگویید."
      ].filter((line, index, lines) => line !== "" || lines[index - 1] !== ""),
      assumptions: [
        allLive
          ? "نام، Part Number، قیمت و موجودی از آخرین همگام‌سازی WooCommerce خوانده شده‌اند"
          : "نام و Part Number از داده نمایشی توسعه آمده‌اند؛ قیمت، موجودی و مشخصات آن قابل استناد نیست",
        allDatasheets
          ? "مشخصات فنی هر گزینه فقط از رکورد دیتاشیت تأییدشده همان Part Number آمده است"
          : "مشخصات نرمال‌شده یا تخمینی فروشگاه به‌عنوان دیتاشیت معتبر نمایش داده نشده‌اند"
      ],
      tool: { slug: "__catalog__", label: "مشاهده کاتالوگ محصولات" }
    };
  }

  return {
    source: "catalog",
    title: request.search ? `نتایج جست‌وجوی «${request.search}»` : `محصولات موجود${request.category ? ` — ${categoryLabel(request.category)}` : ""}`,
    lines: [
      ...shown.map(productLine),
      "",
      `مجموع نتایج: **${formatFa(page.total)} محصول**${page.total > shown.length ? ` (${formatFa(shown.length)} مورد نمایش داده شد)` : ""}`
    ],
    assumptions: ["قیمت و موجودی از آخرین همگام‌سازی کاتالوگ محلی ddcpersia خوانده شده است"],
    tool: { slug: "__catalog__", label: "مشاهده همه محصولات" }
  };
}

export async function productPriceSkill(slots: Slots): Promise<Answer> {
  const request = parseCatalogRequest(slots);
  const page = await fetchCatalog({
    q: request.search,
    category: request.category ?? "all",
    limit: "48",
    ...(request.brand ? { brand: request.brand } : {}),
    ...(request.resolutionMp !== undefined ? { resolutionMp: String(request.resolutionMp) } : {})
  });
  if (!page) return unavailable;

  const priced = page.products.filter((product) => product.source === "woocommerce" && product.price > 0);
  if (!priced.length) {
    return {
      source: "catalog",
      title: "قیمتی ثبت نشده است",
      lines: [
        page.products.length
          ? "محصول پیدا شد اما قیمتی برای آن در کاتالوگ درج نشده است."
          : "محصولی مطابق این جست‌وجو در کاتالوگ نیست.",
        "",
        "برای اطلاع از قیمت، صفحه محصول را ببینید یا با کارشناسان فروش تماس بگیرید."
      ],
      tool: { slug: "__catalog__", label: "مشاهده همه محصولات" }
    };
  }

  const sorted = [...priced].sort((a, b) => a.price - b.price);
  const cheapest = sorted[0];
  const dearest = sorted[sorted.length - 1];
  const median = sorted[Math.floor(sorted.length / 2)];
  const wantsCheapest = /ارزان|ارزون|کمترین|پایین ترین/.test(slots.text);
  const wantsDearest = /گران|گرون|بیشترین|بالاترین|بهترین/.test(slots.text);

  const lines: string[] = [];
  if (wantsCheapest) lines.push(`ارزان‌ترین گزینه: **${cheapest.name}** — ${formatToman(cheapest.price)}`);
  else if (wantsDearest) lines.push(`گران‌ترین گزینه: **${dearest.name}** — ${formatToman(dearest.price)}`);
  else lines.push(...sorted.slice(0, 5).map(productLine));

  lines.push("");
  lines.push(`بازه قیمت این دسته: از **${formatToman(cheapest.price)}** تا **${formatToman(dearest.price)}**`);
  lines.push(`قیمت میانه: **${formatToman(median.price)}** در میان ${formatFa(priced.length)} محصول قیمت‌دار`);

  if (slots.budgetToman) {
    const affordable = sorted.filter((product) => product.price <= slots.budgetToman!);
    lines.push("");
    lines.push(
      affordable.length
        ? `با بودجه ${formatToman(slots.budgetToman)}، **${formatFa(affordable.length)} محصول** از این دسته در دسترس است؛ گران‌ترین آن‌ها **${affordable[affordable.length - 1].name}** با ${formatToman(affordable[affordable.length - 1].price)} است.`
        : `با بودجه ${formatToman(slots.budgetToman)} هیچ محصولی در این دسته پیدا نشد؛ ارزان‌ترین گزینه ${formatToman(cheapest.price)} است.`
    );
  }

  return {
    source: "catalog",
    title: request.search ? `قیمت «${request.search}»` : `قیمت‌ها${request.category ? ` — ${categoryLabel(request.category)}` : ""}`,
    lines,
    assumptions: ["اعداد از آخرین همگام‌سازی کاتالوگ محلی ddcpersia است و ممکن است با قیمت لحظه‌ای فروشگاه تفاوت داشته باشد"],
    tool: { slug: "__catalog__", label: "مشاهده همه محصولات" }
  };
}

export async function productCompareSkill(slots: Slots): Promise<Answer> {
  const request = parseCatalogRequest(slots);
  const page = await fetchCatalog({
    q: request.search,
    category: request.category ?? "all",
    limit: "48",
    ...(request.brand ? { brand: request.brand } : {}),
    ...(request.resolutionMp !== undefined ? { resolutionMp: String(request.resolutionMp) } : {})
  });
  if (!page) return unavailable;

  const candidates = page.products.filter((product) => product.source === "woocommerce" && product.price > 0).slice(0, 4);
  if (candidates.length < 2) {
    return {
      source: "catalog",
      title: "برای مقایسه به دو محصول نیاز دارم",
      lines: [
        "در کاتالوگ محلی کمتر از دو محصول قیمت‌دار مطابق این جست‌وجو پیدا شد.",
        "",
        "نام دو مدل مشخص را بنویسید، برای مثال: «مقایسه TC-C32 و TC-C34»."
      ],
      tool: { slug: "__catalog__", label: "مشاهده همه محصولات" }
    };
  }

  return {
    source: "catalog",
    title: "مقایسه محصولات کاتالوگ",
    lines: [
      ...candidates.map((product) => {
        const highlights = product.datasheet
          ? Object.entries(product.datasheet.facts).slice(0, 3)
              .map(([key, value]) => `${factLabels[key] ?? key}: ${formatFactValue(value)}`)
              .join(" | ")
          : "مشخصات فنی بدون دیتاشیت تأییدشده نمایش داده نمی‌شود";
        return `• **${product.name}** — ${formatToman(product.price)}${highlights ? `\n  ${highlights}` : ""}`;
      }),
      "",
      "معیارهای فنی مقایسه که فراتر از قیمت اهمیت دارند: رزولوشن و اندازه سنسور، دیافراگم لنز، True WDR، توان مصرفی اوج، درجه IP و IK، و کیفیت واقعی تحلیل هوش مصنوعی روی خود دوربین."
    ],
    tool: { slug: "__catalog__", label: "مشاهده همه محصولات" }
  };
}

function categoryLabel(category: ProductCategory) {
  const labels: Record<ProductCategory, string> = {
    camera: "دوربین",
    recorder: "دستگاه ضبط",
    switch: "سوئیچ PoE",
    storage: "ذخیره‌سازی",
    ups: "برق اضطراری"
  };
  return labels[category];
}
