import type { ObstacleKind, ObstacleVariant, PlanObstacle } from "@/src/domain/planner/types";

export type ObstacleGroup =
  | "vehicle"
  | "tree"
  | "structure"
  | "landscape"
  | "site"
  | "living"
  | "bedroom"
  | "kitchen"
  | "office"
  | "retail"
  | "industrial"
  | "warehouse"
  | "parking"
  | "hospitality"
  | "medical"
  | "public-safety"
  | "education";

/** Menu sections, in the order they are offered. */
export const obstacleGroupLabels: Record<ObstacleGroup, string> = {
  living: "پذیرایی",
  bedroom: "اتاق خواب",
  kitchen: "آشپزخانه",
  office: "اداری و دفتر",
  retail: "فروشگاهی",
  industrial: "کارگاه و کارخانه",
  warehouse: "انبار و لجستیک",
  parking: "پارکینگ و تردد",
  hospitality: "هتل و فضای عمومی",
  medical: "پزشکی و درمانی",
  "public-safety": "انتظامی و خدمات عمومی",
  education: "آموزشی",
  landscape: "محوطه و فضای سبز",
  site: "تجهیزات سایت",
  vehicle: "خودرو",
  tree: "درخت",
  structure: "سازه"
};

export type ObstaclePreset = {
  id: ObstacleVariant;
  group: ObstacleGroup;
  label: string;
  description: string;
  kind: ObstacleKind;
  widthM: number;
  depthM: number;
  heightM: number;
  /**
   * Whether the element interrupts a camera's line of sight.
   *
   * Ground cover and low planting do not: painting a lawn across a courtyard should
   * change how the plan reads, not carve blind spots into the coverage map.
   */
  blocksView?: boolean;
};

export const obstaclePresets: ObstaclePreset[] = [
  { id: "sedan", group: "vehicle", label: "خودروی سواری", description: "سدان شهری", kind: "vehicle", widthM: 4.5, depthM: 1.8, heightM: 1.45 },
  { id: "suv", group: "vehicle", label: "شاسی‌بلند", description: "خودروی SUV", kind: "vehicle", widthM: 4.8, depthM: 1.95, heightM: 1.8 },
  { id: "pickup", group: "vehicle", label: "وانت", description: "کابین و فضای بار", kind: "vehicle", widthM: 5.3, depthM: 1.9, heightM: 1.75 },
  { id: "van", group: "vehicle", label: "ون", description: "خودروی خدماتی", kind: "vehicle", widthM: 5.4, depthM: 2.05, heightM: 2.45 },
  { id: "truck", group: "vehicle", label: "کامیون", description: "خودروی سنگین", kind: "vehicle", widthM: 8.2, depthM: 2.5, heightM: 3.35 },
  { id: "deciduous", group: "tree", label: "درخت پهن‌برگ", description: "تاج گرد و متراکم", kind: "tree", widthM: 4.5, depthM: 4.5, heightM: 6 },
  { id: "conifer", group: "tree", label: "درخت سوزنی‌برگ", description: "فرم مخروطی", kind: "tree", widthM: 3.2, depthM: 3.2, heightM: 7 },
  { id: "palm", group: "tree", label: "نخل", description: "تنه بلند و تاج باز", kind: "tree", widthM: 4, depthM: 4, heightM: 7.5 },
  { id: "stairs-straight", group: "structure", label: "راه‌پله مستقیم", description: "اتصال عمودی طبقات", kind: "stairs", widthM: 4.2, depthM: 1.4, heightM: 3.2 },
  { id: "elevator", group: "structure", label: "آسانسور", description: "کابین و درِ آسانسور کنار هسته راه‌پله", kind: "equipment", widthM: 2.2, depthM: 2.2, heightM: 3.2, blocksView: true },
  { id: "escalator", group: "structure", label: "پله‌برقی", description: "مسیر متحرک رفت‌وآمد طبقات تجاری", kind: "stairs", widthM: 5.2, depthM: 1.5, heightM: 3.2, blocksView: false },

  // Ground cover: drawn flat and deliberately non-blocking.
  { id: "grass", group: "landscape", label: "چمن", description: "سطح سبز محوطه", kind: "surface", widthM: 8, depthM: 6, heightM: 0.05, blocksView: false },
  { id: "road", group: "landscape", label: "جاده / مسیر", description: "مسیر تردد خودرو", kind: "surface", widthM: 12, depthM: 4, heightM: 0.02, blocksView: false },
  // Knee-height planting: a mounted camera looks straight over it, so it is not a barrier.
  { id: "bush", group: "landscape", label: "بوته", description: "پوشش کوتاه و پراکنده", kind: "tree", widthM: 1.2, depthM: 1.2, heightM: 0.9, blocksView: false },
  { id: "hedge", group: "landscape", label: "پرچین", description: "ردیف شمشاد مرزبندی", kind: "tree", widthM: 6, depthM: 0.8, heightM: 1.6, blocksView: true },

  /*
   * Site and security elements.
   *
   * These exist because they change camera decisions: a fence line is what perimeter
   * cameras watch, a gate is where plate capture happens, mounting height comes from the
   * pole, and night performance depends on where the lighting actually is.
   */
  { id: "fence-mesh", group: "site", label: "حصار توری", description: "دید نسبی از میان توری", kind: "fence", widthM: 10, depthM: 0.1, heightM: 2, blocksView: false },
  { id: "fence-wall", group: "site", label: "دیوار محوطه", description: "مرز مات و مسدودکننده", kind: "fence", widthM: 10, depthM: 0.25, heightM: 2.2, blocksView: true },
  { id: "gate-sliding", group: "site", label: "دروازه خودرو", description: "ورودی کشویی محوطه", kind: "gate", widthM: 5, depthM: 0.2, heightM: 2, blocksView: true },
  { id: "camera-pole", group: "site", label: "پایه دوربین", description: "دکل نصب دوربین محوطه", kind: "pole", widthM: 0.25, depthM: 0.25, heightM: 4.5, blocksView: false },
  { id: "light-pole", group: "site", label: "پایه روشنایی", description: "روشنایی مؤثر بر دید شبانه", kind: "pole", widthM: 0.22, depthM: 0.22, heightM: 5, blocksView: false },
  { id: "equipment-rack", group: "site", label: "رک تجهیزات", description: "محل NVR، سوئیچ و UPS", kind: "equipment", widthM: 0.8, depthM: 0.8, heightM: 1.8, blocksView: true },

  { id: "hospital-bed", group: "medical", label: "تخت بیمارستانی", description: "تخت بستری با حریم دسترسی", kind: "bed", widthM: 1.05, depthM: 2.2, heightM: 0.72, blocksView: false },
  { id: "stretcher", group: "medical", label: "برانکارد", description: "تخت چرخ‌دار انتقال بیمار", kind: "bed", widthM: 0.75, depthM: 2.05, heightM: 0.82, blocksView: false },
  { id: "exam-table", group: "medical", label: "تخت معاینه", description: "تخت اتاق معاینه و درمان", kind: "bed", widthM: 0.75, depthM: 1.9, heightM: 0.78, blocksView: false },
  { id: "nurse-station", group: "medical", label: "ایستگاه پرستاری", description: "کانتر کنترل بخش", kind: "furniture", widthM: 3.2, depthM: 1.1, heightM: 1.15, blocksView: false },
  { id: "medical-cart", group: "medical", label: "ترالی پزشکی", description: "ترالی دارو و احیا", kind: "equipment", widthM: 0.8, depthM: 0.55, heightM: 1.05, blocksView: false },
  { id: "privacy-screen", group: "medical", label: "پاراوان پزشکی", description: "جداکننده متحرک تخت‌ها", kind: "fence", widthM: 2.1, depthM: 0.08, heightM: 1.75, blocksView: true },

  { id: "service-counter", group: "public-safety", label: "کانتر خدمت", description: "پذیرش مراجعان و ثبت درخواست", kind: "furniture", widthM: 2.4, depthM: 0.85, heightM: 1.15, blocksView: false },
  { id: "waiting-bench", group: "public-safety", label: "نیمکت انتظار", description: "نشیمن چندنفره فضای عمومی", kind: "seating", widthM: 2.1, depthM: 0.62, heightM: 0.82, blocksView: false },
  { id: "locker-row", group: "public-safety", label: "ردیف کمد فلزی", description: "کمد تجهیزات و لباس کارکنان", kind: "furniture", widthM: 2.4, depthM: 0.55, heightM: 2, blocksView: true },
  { id: "metal-bunk", group: "public-safety", label: "تخت دوطبقه", description: "تخت آسایشگاهی دوطبقه", kind: "bed", widthM: 1, depthM: 2.05, heightM: 1.75, blocksView: true },

  { id: "student-desk", group: "education", label: "میز دانش‌آموز", description: "میز دونفره کلاس", kind: "furniture", widthM: 1.2, depthM: 0.55, heightM: 0.75, blocksView: false },
  { id: "whiteboard", group: "education", label: "تخته کلاس", description: "تخته دیواری آموزشی", kind: "furniture", widthM: 2.4, depthM: 0.12, heightM: 1.35, blocksView: false },
  { id: "lab-bench", group: "education", label: "میز آزمایشگاه", description: "میز مقاوم آزمایش و کارگاه", kind: "furniture", widthM: 2.4, depthM: 0.9, heightM: 0.92, blocksView: false },
  { id: "library-shelf", group: "education", label: "قفسه کتابخانه", description: "قفسه دوطرفه کتاب", kind: "furniture", widthM: 2, depthM: 0.7, heightM: 1.8, blocksView: true },
  { id: "gym-bleacher", group: "education", label: "سکوی تماشاگر", description: "نیمکت پلکانی سالن ورزش", kind: "seating", widthM: 4, depthM: 1.8, heightM: 1.2, blocksView: false },

  /*
   * Interior furniture.
   *
   * Heights are what decide whether a camera sees over an item, so they are real
   * dimensions rather than convenient round numbers: a sofa back at 0.85 m is seen over
   * from a ceiling mount, a wardrobe at 2.1 m is not.
   */
  { id: "sofa-three", group: "living", label: "مبل سه‌نفره", description: "کاناپه بزرگ", kind: "seating", widthM: 2.1, depthM: 0.9, heightM: 0.85, blocksView: false },
  { id: "sofa-single", group: "living", label: "مبل تک‌نفره", description: "صندلی راحتی", kind: "seating", widthM: 0.95, depthM: 0.9, heightM: 0.85, blocksView: false },
  { id: "coffee-table", group: "living", label: "میز جلومبلی", description: "میز کوتاه وسط", kind: "furniture", widthM: 1.1, depthM: 0.6, heightM: 0.42, blocksView: false },
  { id: "tv-unit", group: "living", label: "میز تلویزیون", description: "کنسول دیواری", kind: "furniture", widthM: 1.8, depthM: 0.45, heightM: 0.55, blocksView: false },
  { id: "dining-table", group: "living", label: "میز ناهارخوری", description: "میز شش‌نفره", kind: "furniture", widthM: 1.8, depthM: 0.95, heightM: 0.75, blocksView: false },
  { id: "dining-chair", group: "living", label: "صندلی میز", description: "صندلی ناهارخوری و جلسه", kind: "seating", widthM: 0.48, depthM: 0.52, heightM: 0.86, blocksView: false },
  { id: "rug", group: "living", label: "فرش", description: "پوشش کف", kind: "surface", widthM: 3, depthM: 2, heightM: 0.02, blocksView: false },

  { id: "bed-double", group: "bedroom", label: "تخت دونفره", description: "تخت کویین", kind: "bed", widthM: 1.6, depthM: 2, heightM: 0.55, blocksView: false },
  { id: "bed-single", group: "bedroom", label: "تخت یک‌نفره", description: "تخت تک", kind: "bed", widthM: 0.95, depthM: 2, heightM: 0.55, blocksView: false },
  { id: "wardrobe", group: "bedroom", label: "کمد لباس", description: "کمد بلند دیواری", kind: "furniture", widthM: 1.8, depthM: 0.6, heightM: 2.1, blocksView: true },
  { id: "bookshelf", group: "bedroom", label: "کتابخانه", description: "قفسه کتاب بلند", kind: "furniture", widthM: 1.2, depthM: 0.35, heightM: 1.9, blocksView: true },
  { id: "nightstand", group: "bedroom", label: "پاتختی", description: "میز کنار تخت", kind: "furniture", widthM: 0.5, depthM: 0.4, heightM: 0.55, blocksView: false },
  { id: "dresser", group: "bedroom", label: "میز آرایش", description: "دراور و آینه", kind: "furniture", widthM: 1.2, depthM: 0.45, heightM: 0.8, blocksView: false },

  { id: "fridge", group: "kitchen", label: "یخچال", description: "یخچال فریزر دوقلو", kind: "appliance", widthM: 0.9, depthM: 0.7, heightM: 1.85, blocksView: true },
  { id: "kitchen-counter", group: "kitchen", label: "کابینت", description: "کانتر و کابینت زمینی", kind: "furniture", widthM: 2.4, depthM: 0.6, heightM: 0.9, blocksView: false },
  { id: "stove", group: "kitchen", label: "اجاق گاز", description: "اجاق و فر", kind: "appliance", widthM: 0.6, depthM: 0.6, heightM: 0.9, blocksView: false },
  { id: "sink-unit", group: "kitchen", label: "سینک ظرفشویی", description: "سینک و شیر", kind: "furniture", widthM: 0.9, depthM: 0.6, heightM: 0.9, blocksView: false },
  { id: "kitchen-island", group: "kitchen", label: "جزیره آشپزخانه", description: "کانتر مرکزی", kind: "furniture", widthM: 1.8, depthM: 0.9, heightM: 0.95, blocksView: false },
  { id: "dishwasher", group: "kitchen", label: "ماشین ظرفشویی", description: "زیر کانتر", kind: "appliance", widthM: 0.6, depthM: 0.6, heightM: 0.85, blocksView: false },

  { id: "office-desk", group: "office", label: "میز کار", description: "میز اداری تکی", kind: "furniture", widthM: 1.4, depthM: 0.7, heightM: 0.75, blocksView: false },
  { id: "office-chair", group: "office", label: "صندلی اداری", description: "صندلی گردان", kind: "seating", widthM: 0.6, depthM: 0.6, heightM: 1.1, blocksView: false },
  { id: "meeting-table", group: "office", label: "میز کنفرانس", description: "میز جلسات هشت‌نفره", kind: "furniture", widthM: 2.6, depthM: 1.2, heightM: 0.75, blocksView: false },
  { id: "filing-cabinet", group: "office", label: "کمد بایگانی", description: "فایل اسناد", kind: "furniture", widthM: 0.9, depthM: 0.5, heightM: 1.6, blocksView: true },
  { id: "reception-desk", group: "office", label: "کانتر پذیرش", description: "میز منشی و پذیرش", kind: "furniture", widthM: 2, depthM: 0.8, heightM: 1.1, blocksView: false },
  { id: "partition-screen", group: "office", label: "پارتیشن", description: "جداکننده فضای کاری", kind: "furniture", widthM: 1.6, depthM: 0.08, heightM: 1.5, blocksView: true },

  { id: "shelving-unit", group: "retail", label: "قفسه فروشگاهی", description: "استند کالا", kind: "furniture", widthM: 2, depthM: 0.6, heightM: 1.8, blocksView: true },
  { id: "display-fridge", group: "retail", label: "یخچال ویترینی", description: "یخچال ایستاده", kind: "appliance", widthM: 1.2, depthM: 0.7, heightM: 2, blocksView: true },
  { id: "checkout-counter", group: "retail", label: "صندوق فروش", description: "میز صندوق و باسکول", kind: "furniture", widthM: 1.6, depthM: 0.8, heightM: 1, blocksView: false },
  // Hung garments make this opaque in practice, unlike an open display stand.
  { id: "clothing-rack", group: "retail", label: "رگال لباس", description: "استند آویز پوشاک", kind: "furniture", widthM: 1.5, depthM: 0.6, heightM: 1.7, blocksView: true },
  { id: "display-stand", group: "retail", label: "استند نمایش", description: "میز عرضه کالا", kind: "furniture", widthM: 1.2, depthM: 1.2, heightM: 0.9, blocksView: false },
  { id: "workbench", group: "industrial", label: "میز کار صنعتی", description: "سطح مونتاژ و تعمیر", kind: "furniture", widthM: 2.2, depthM: 0.9, heightM: 0.95, blocksView: false },
  { id: "cnc-machine", group: "industrial", label: "دستگاه صنعتی", description: "ماشین‌آلات خط تولید", kind: "equipment", widthM: 2.4, depthM: 1.8, heightM: 2.1, blocksView: true },
  { id: "tool-cabinet", group: "industrial", label: "کمد ابزار", description: "تجهیزات و ابزار کارگاه", kind: "furniture", widthM: 1.4, depthM: 0.55, heightM: 1.9, blocksView: true },
  { id: "welding-station", group: "industrial", label: "ایستگاه جوشکاری", description: "کابین محافظ عملیات گرم", kind: "equipment", widthM: 2, depthM: 1.6, heightM: 2, blocksView: true },
  { id: "conveyor", group: "industrial", label: "نوار نقاله", description: "مسیر جابه‌جایی محصول", kind: "equipment", widthM: 5, depthM: 1.1, heightM: 1.05, blocksView: false },

  { id: "storage-rack", group: "warehouse", label: "قفسه انبار", description: "رک پالت چندطبقه", kind: "furniture", widthM: 3.2, depthM: 1.1, heightM: 3, blocksView: true },
  { id: "pallet-stack", group: "warehouse", label: "پالت کالا", description: "بار پالت‌شده", kind: "block", widthM: 1.2, depthM: 1, heightM: 1.5, blocksView: true },
  { id: "crate-stack", group: "warehouse", label: "جعبه‌های انبار", description: "چیدمان کارتن و صندوق", kind: "block", widthM: 1.6, depthM: 1.2, heightM: 1.8, blocksView: true },
  { id: "packing-table", group: "warehouse", label: "میز بسته‌بندی", description: "ایستگاه آماده‌سازی سفارش", kind: "furniture", widthM: 2, depthM: 0.9, heightM: 0.9, blocksView: false },
  { id: "loading-platform", group: "warehouse", label: "سکوی بارگیری", description: "لبه تحویل و دریافت کالا", kind: "equipment", widthM: 5, depthM: 2.2, heightM: 1.1, blocksView: false },

  { id: "parking-barrier", group: "parking", label: "راهبند پارکینگ", description: "کنترل ورود خودرو", kind: "gate", widthM: 4.5, depthM: 0.35, heightM: 1, blocksView: false },
  { id: "guard-booth", group: "parking", label: "اتاق نگهبانی", description: "کنترل ورودی و خروجی", kind: "equipment", widthM: 2.4, depthM: 2.4, heightM: 2.6, blocksView: true },
  { id: "bollard", group: "parking", label: "بولارد", description: "ستونک محافظ مسیر", kind: "pole", widthM: 0.25, depthM: 0.25, heightM: 0.9, blocksView: false },
  { id: "speed-bump", group: "parking", label: "سرعت‌گیر", description: "کنترل سرعت خودرو", kind: "surface", widthM: 3.5, depthM: 0.45, heightM: 0.08, blocksView: false },
  { id: "wheel-stop", group: "parking", label: "متوقف‌کننده چرخ", description: "حد انتهای جای پارک", kind: "block", widthM: 1.8, depthM: 0.18, heightM: 0.12, blocksView: false },

  { id: "lobby-sofa", group: "hospitality", label: "نشیمن لابی", description: "مبل فضای انتظار", kind: "seating", widthM: 2.4, depthM: 0.9, heightM: 0.82, blocksView: false },
  { id: "concierge-desk", group: "hospitality", label: "کانتر اطلاعات", description: "پذیرش هتل و فضای عمومی", kind: "furniture", widthM: 2.6, depthM: 0.85, heightM: 1.1, blocksView: false },
  { id: "luggage-cart", group: "hospitality", label: "ترولی بار", description: "حمل چمدان و مرسوله", kind: "equipment", widthM: 1.1, depthM: 0.7, heightM: 1.8, blocksView: true },
  { id: "queue-barrier", group: "hospitality", label: "جداکننده صف", description: "هدایت مسیر مراجعه‌کننده", kind: "fence", widthM: 2, depthM: 0.12, heightM: 1, blocksView: false },
  { id: "vending-machine", group: "hospitality", label: "دستگاه فروش", description: "دستگاه خدمات خودکار", kind: "appliance", widthM: 1, depthM: 0.8, heightM: 1.9, blocksView: true }
];

export function obstaclePreset(variant?: ObstacleVariant) {
  return obstaclePresets.find((item) => item.id === variant);
}

export function applyObstaclePreset(obstacle: PlanObstacle, preset: ObstaclePreset): PlanObstacle {
  return {
    ...obstacle,
    label: preset.label,
    kind: preset.kind,
    variant: preset.id,
    widthM: preset.widthM,
    depthM: preset.depthM,
    heightM: preset.heightM,
    blocksView: preset.blocksView ?? true
  };
}
