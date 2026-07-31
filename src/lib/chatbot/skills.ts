import { formatFa } from "@/src/lib/chatbot/persian";
import { doriPixelsPerMeter, referenceBitrateKbps, sensorWidthMm, type Slots } from "@/src/lib/chatbot/slots";
import { calculateIpv4Details, calculateIpv4Prefix } from "@/src/lib/calculators/ipv4";
import {
  distanceForPixelDensity,
  doriDistances,
  focalLengthMm,
  horizontalFovDeg,
  horizontalPixelsForMegapixel,
  pixelsPerMeter,
  sceneWidthAtDistanceM
} from "@/src/lib/calculators/optics";
import { calculateUpsRequirements } from "@/src/lib/calculators/power";
import { calculateRaidUsable, type RaidLevel } from "@/src/lib/calculators/raid";
import { ackRoundTripMicroseconds, calculateLinkBudget, fresnelRadiusM } from "@/src/lib/calculators/rf";
import { calculateSurveillanceStorage, kbpsToMbps } from "@/src/lib/calculators/storage";
import { dbmToMilliwatts, milliwattsToDbm } from "@/src/lib/calculators/wireless";

/**
 * Calculation skills.
 *
 * Each skill reads whatever the slot filler managed to recover, falls back to a
 * documented default for the rest, and always reports which defaults it used. The
 * maths is delegated to the same modules the calculator pages use, so a number the
 * assistant quotes is reproducible in the matching tool.
 */

export type Answer = {
  title: string;
  lines: string[];
  assumptions?: string[];
  tool?: { slug: string; label: string };
  followUps?: string[];
  source: "calculation" | "knowledge" | "catalog" | "llm" | "system";
};

const defaultMegapixel = 4;
const defaultArchiveDays = 30;
const defaultCameraCount = 8;
const defaultSensorMm = sensorWidthMm(undefined, "1/2.8");

export function storageSkill(slots: Slots): Answer {
  const cameraCount = slots.cameraCount ?? defaultCameraCount;
  const megapixel = slots.megapixel ?? defaultMegapixel;
  const days = slots.days ?? defaultArchiveDays;
  const codec = slots.codec ?? "H.265";
  const perCameraKbps = slots.bitrateKbps ?? referenceBitrateKbps(megapixel, codec);
  const totalKbps = perCameraKbps * cameraCount;

  const result = calculateSurveillanceStorage({
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

  const motion = calculateSurveillanceStorage({
    totalVideoBitrateKbps: totalKbps,
    cameraCount,
    archiveDays: days,
    recordingMode: "motion",
    motionActivityPercent: 30,
    bitrateMode: "VBR",
    recordAudio: false,
    audioBitrateKbps: 64,
    filesystemOverheadPercent: 5,
    vbrSafetyMarginPercent: 15,
    reservePercent: 10
  });

  const diskSizeTb = slots.terabytes ?? 4;
  const diskCount = Math.max(1, Math.ceil(result.requiredStorageTb / diskSizeTb));

  return {
    source: "calculation",
    title: `فضای ذخیره‌سازی برای ${formatFa(cameraCount)} دوربین در ${formatFa(days)} روز`,
    lines: [
      `بیت‌ریت هر دوربین: **${formatFa(perCameraKbps)} کیلوبیت بر ثانیه** (${formatFa(megapixel, 1)} مگاپیکسل، ${codec})`,
      `بیت‌ریت کل سیستم: **${formatFa(kbpsToMbps(totalKbps), 1)} مگابیت بر ثانیه**`,
      "",
      `فضای موردنیاز با ضبط پیوسته: **${formatFa(result.requiredStorageTb, 2)} ترابایت**`,
      `فضای موردنیاز با ضبط تشخیص حرکت (۳۰٪ فعالیت): **${formatFa(motion.requiredStorageTb, 2)} ترابایت**`,
      "",
      `یعنی حدود **${formatFa(diskCount)} عدد هارد ${formatFa(diskSizeTb)} ترابایتی** از خانواده Surveillance.`
    ],
    assumptions: [
      "ضبط ۲۴ ساعته و بیت‌ریت متغیر (VBR) با ۱۵٪ حاشیه اطمینان",
      "۵٪ سربار فایل‌سیستم و ۱۰٪ فضای رزرو",
      "بدون ضبط صدا",
      slots.cameraCount === undefined ? `تعداد دوربین فرض شد: ${formatFa(defaultCameraCount)}` : "",
      slots.megapixel === undefined ? `رزولوشن فرض شد: ${formatFa(defaultMegapixel)} مگاپیکسل` : "",
      slots.days === undefined ? `مدت آرشیو فرض شد: ${formatFa(defaultArchiveDays)} روز` : ""
    ].filter(Boolean),
    tool: { slug: "capacity", label: "محاسبه‌گر ظرفیت ذخیره‌سازی" },
    followUps: ["پهنای باند شبکه این سیستم چقدر است؟", "چه دستگاهی برای این تعداد دوربین لازم است؟"]
  };
}

export function bandwidthSkill(slots: Slots): Answer {
  const cameraCount = slots.cameraCount ?? defaultCameraCount;
  const megapixel = slots.megapixel ?? defaultMegapixel;
  const codec = slots.codec ?? "H.265";
  const perCameraKbps = slots.bitrateKbps ?? referenceBitrateKbps(megapixel, codec);
  const totalMbps = kbpsToMbps(perCameraKbps * cameraCount);
  const withMargin = totalMbps * 1.2;

  return {
    source: "calculation",
    title: `پهنای باند ${formatFa(cameraCount)} دوربین ${formatFa(megapixel, 1)} مگاپیکسل`,
    lines: [
      `بیت‌ریت هر دوربین: **${formatFa(perCameraKbps)} کیلوبیت بر ثانیه** (${codec})`,
      `بار خالص ضبط: **${formatFa(totalMbps, 1)} مگابیت بر ثانیه**`,
      `با ۲۰٪ حاشیه اطمینان: **${formatFa(withMargin, 1)} مگابیت بر ثانیه**`,
      "",
      `NVR باید پهنای باند ورودی حداقل **${formatFa(Math.ceil(withMargin / 10) * 10)} مگابیت بر ثانیه** داشته باشد.`,
      `لینک بین سوئیچ و NVR با این بار، یک پورت گیگابیت ${withMargin > 700 ? "کفاف نمی‌دهد و باید Aggregate یا ۱۰ گیگابیت شود" : "کافی است"}.`,
      "",
      "توجه: این عدد فقط بار ضبط است. تماشای هم‌زمان از راه دور، بار خروجی جداگانه‌ای روی اینترنت ایجاد می‌کند."
    ],
    assumptions: [
      slots.cameraCount === undefined ? `تعداد دوربین فرض شد: ${formatFa(defaultCameraCount)}` : "",
      slots.megapixel === undefined ? `رزولوشن فرض شد: ${formatFa(defaultMegapixel)} مگاپیکسل` : "",
      "۲۵ فریم بر ثانیه و کیفیت متوسط تا خوب"
    ].filter(Boolean),
    tool: { slug: "capacity", label: "محاسبه‌گر ظرفیت و پهنای باند" }
  };
}

export function lensSkill(slots: Slots): Answer {
  const distanceM = slots.distanceM ?? 20;
  const sensor = slots.sensorInch ?? defaultSensorMm;
  const megapixel = slots.megapixel ?? defaultMegapixel;
  const widthPx = horizontalPixelsForMegapixel(megapixel);

  // With a stated task, the required pixel density fixes the scene width for us.
  const goal = slots.goal;
  const requiredPpm = goal ? doriPixelsPerMeter[goal] : undefined;
  const sceneWidthM = slots.sceneWidthM ?? (requiredPpm ? widthPx / requiredPpm : 6);
  const focal = focalLengthMm(sceneWidthM, distanceM, sensor);
  const fov = horizontalFovDeg(focal, sensor);

  const lines = [
    `فاصله کانونی موردنیاز: **${formatFa(focal, 1)} میلی‌متر**`,
    `زاویه دید حاصل: **${formatFa(fov, 1)} درجه**`,
    `عرض صحنه در ${formatFa(distanceM)} متری: **${formatFa(sceneWidthM, 1)} متر**`,
    `تراکم پیکسل: **${formatFa(pixelsPerMeter(widthPx, sceneWidthM))} پیکسل بر متر**`,
    "",
    `نزدیک‌ترین لنز تجاری: **${nearestCommercialLens(focal)}**`
  ];

  if (requiredPpm) {
    lines.splice(4, 0, `این تراکم برای «${goalLabel(goal!)}» طبق EN 62676-4 حداقل ${formatFa(requiredPpm)} پیکسل بر متر لازم دارد.`);
  }

  return {
    source: "calculation",
    title: `انتخاب لنز برای فاصله ${formatFa(distanceM)} متر`,
    lines,
    assumptions: [
      `عرض سنسور فرض شد: ${formatFa(sensor, 2)} میلی‌متر`,
      slots.megapixel === undefined ? `رزولوشن فرض شد: ${defaultMegapixel} مگاپیکسل (${formatFa(widthPx)} پیکسل افقی)` : "",
      slots.sceneWidthM === undefined && !requiredPpm ? "عرض صحنه فرض شد: ۶ متر" : "",
      slots.distanceM === undefined ? "فاصله فرض شد: ۲۰ متر" : ""
    ].filter(Boolean),
    tool: { slug: "lens", label: "محاسبه‌گر فاصله کانونی لنز" },
    followUps: ["تا چه فاصله‌ای می‌توانم چهره را شناسایی کنم؟"]
  };
}

export function fovSkill(slots: Slots): Answer {
  const focal = slots.focalMm ?? 4;
  const sensor = slots.sensorInch ?? defaultSensorMm;
  const fov = horizontalFovDeg(focal, sensor);
  const distances = [5, 10, 20, 30];

  return {
    source: "calculation",
    title: `زاویه دید لنز ${formatFa(focal, 1)} میلی‌متر`,
    lines: [
      `زاویه دید افقی: **${formatFa(fov, 1)} درجه**`,
      "",
      "عرض صحنه در فواصل مختلف:",
      ...distances.map((distance) => `• ${formatFa(distance)} متر → **${formatFa(sceneWidthAtDistanceM(distance, fov), 1)} متر** عرض`)
    ],
    assumptions: [
      `عرض سنسور فرض شد: ${formatFa(sensor, 2)} میلی‌متر`,
      slots.focalMm === undefined ? "فاصله کانونی فرض شد: ۴ میلی‌متر" : ""
    ].filter(Boolean),
    tool: { slug: "view-angle", label: "محاسبه‌گر زاویه دید" }
  };
}

export function doriSkill(slots: Slots): Answer {
  const megapixel = slots.megapixel ?? defaultMegapixel;
  const widthPx = horizontalPixelsForMegapixel(megapixel);
  const sensor = slots.sensorInch ?? defaultSensorMm;
  const fov = slots.focalMm ? horizontalFovDeg(slots.focalMm, sensor) : 90;
  const result = doriDistances(widthPx, fov);

  return {
    source: "calculation",
    title: `فواصل DORI برای دوربین ${formatFa(megapixel, 1)} مگاپیکسل`,
    lines: [
      `رزولوشن افقی: **${formatFa(widthPx)} پیکسل** — زاویه دید: **${formatFa(fov, 1)} درجه**`,
      "",
      `• کشف (Detect، ۲۵ پیکسل بر متر): تا **${formatFa(result.detection, 1)} متر**`,
      `• مشاهده (Observe، ۶۲ پیکسل بر متر): تا **${formatFa(result.observation, 1)} متر**`,
      `• بازشناسی (Recognize، ۱۲۵ پیکسل بر متر): تا **${formatFa(result.recognition, 1)} متر**`,
      `• شناسایی (Identify، ۲۵۰ پیکسل بر متر): تا **${formatFa(result.identification, 1)} متر**`,
      "",
      `پلاک‌خوانی (حدود ۲۰۰ پیکسل بر متر): تا **${formatFa(distanceForPixelDensity(widthPx, fov, 200), 1)} متر**`
    ],
    assumptions: [
      slots.focalMm === undefined ? "زاویه دید فرض شد: ۹۰ درجه (لنز واید)" : `از لنز ${formatFa(slots.focalMm, 1)} میلی‌متری روی سنسور ${formatFa(sensor, 2)} میلی‌متر`,
      slots.megapixel === undefined ? `رزولوشن فرض شد: ${formatFa(defaultMegapixel)} مگاپیکسل` : "",
      "این اعداد کف استاندارد هستند و در نور کم باید حاشیه گرفت"
    ].filter(Boolean),
    tool: { slug: "dori", label: "محاسبه‌گر فاصله DORI" }
  };
}

export function ppmSkill(slots: Slots): Answer {
  const megapixel = slots.megapixel ?? defaultMegapixel;
  const widthPx = horizontalPixelsForMegapixel(megapixel);
  const sensor = slots.sensorInch ?? defaultSensorMm;
  const fov = slots.focalMm ? horizontalFovDeg(slots.focalMm, sensor) : 90;
  const distanceM = slots.distanceM ?? 20;
  const sceneWidthM = slots.sceneWidthM ?? sceneWidthAtDistanceM(distanceM, fov);
  const ppm = pixelsPerMeter(widthPx, sceneWidthM);

  const achieved = (Object.entries(doriPixelsPerMeter) as [keyof typeof doriPixelsPerMeter, number][])
    .filter(([, required]) => ppm >= required)
    .map(([key]) => goalLabel(key));

  return {
    source: "calculation",
    title: `تراکم پیکسل در ${formatFa(distanceM)} متری`,
    lines: [
      `عرض صحنه: **${formatFa(sceneWidthM, 1)} متر** — رزولوشن افقی: **${formatFa(widthPx)} پیکسل**`,
      `تراکم پیکسل: **${formatFa(ppm)} پیکسل بر متر**`,
      "",
      achieved.length
        ? `این تراکم برای این وظایف کافی است: **${achieved.join("، ")}**`
        : "این تراکم حتی برای کشف حضور (۲۵ پیکسل بر متر) کافی نیست؛ لنز بلندتر یا رزولوشن بالاتر لازم است.",
      "",
      "مرجع EN 62676-4: کشف ۲۵، مشاهده ۶۲.۵، بازشناسی ۱۲۵، شناسایی ۲۵۰ پیکسل بر متر."
    ],
    assumptions: [
      slots.focalMm === undefined ? "زاویه دید فرض شد: ۹۰ درجه" : "",
      slots.megapixel === undefined ? `رزولوشن فرض شد: ${formatFa(defaultMegapixel)} مگاپیکسل` : "",
      slots.distanceM === undefined ? "فاصله فرض شد: ۲۰ متر" : ""
    ].filter(Boolean),
    tool: { slug: "lens-3d", label: "شبیه‌ساز سه‌بعدی میدان دید" }
  };
}

export function raidSkill(slots: Slots): Answer {
  const level = (slots.raidLevel ?? "5") as RaidLevel;
  const diskCount = Math.max(1, slots.diskCount ?? 4);
  const diskSizeTb = slots.terabytes ?? 4;
  const spare = slots.hotSpare ?? 0;
  const result = calculateRaidUsable(new Array(diskCount).fill(diskSizeTb), level, spare);

  if (!result.valid) {
    return {
      source: "calculation",
      title: `RAID ${level} با ${formatFa(diskCount)} دیسک`,
      lines: [`این ترکیب معتبر نیست: ${result.reason}`],
      tool: { slug: "raid", label: "محاسبه‌گر ظرفیت RAID" }
    };
  }

  return {
    source: "calculation",
    title: `RAID ${level} با ${formatFa(diskCount)} دیسک ${formatFa(diskSizeTb)} ترابایتی`,
    lines: [
      `ظرفیت خام: **${formatFa(result.rawTb, 1)} ترابایت**`,
      `ظرفیت قابل استفاده: **${formatFa(result.usableTb, 1)} ترابایت**`,
      `دیسک فعال در آرایه: **${formatFa(result.activeDriveCount)}** — Hot Spare: **${formatFa(result.hotSpareCount)}**`,
      `بازدهی ظرفیت: **${formatFa((result.usableTb / Math.max(1, result.rawTb)) * 100)}٪**`,
      "",
      level === "5" && diskSizeTb >= 8
        ? "هشدار: با دیسک‌های ۸ ترابایت به بالا، زمان بازسازی RAID 5 طولانی است و RAID 6 انتخاب امن‌تری است."
        : "یادآوری: RAID جایگزین پشتیبان‌گیری نیست."
    ],
    assumptions: [
      slots.raidLevel === undefined ? "سطح RAID فرض شد: ۵" : "",
      slots.diskCount === undefined ? "تعداد دیسک فرض شد: ۴" : "",
      slots.terabytes === undefined ? "ظرفیت هر دیسک فرض شد: ۴ ترابایت" : ""
    ].filter(Boolean),
    tool: { slug: "raid", label: "محاسبه‌گر ظرفیت RAID" }
  };
}

export function poeSkill(slots: Slots): Answer {
  const cameraCount = slots.cameraCount ?? defaultCameraCount;
  const perCameraW = slots.watts ?? 8;
  const load = cameraCount * perCameraW;
  const withMargin = load * 1.2;
  const standard = perCameraW <= 12.95 ? "802.3af (PoE)" : perCameraW <= 25.5 ? "802.3at (PoE+)" : "802.3bt (PoE++)";

  return {
    source: "calculation",
    title: `بودجه PoE برای ${formatFa(cameraCount)} دوربین`,
    lines: [
      `مصرف هر دوربین: **${formatFa(perCameraW, 1)} وات** → استاندارد لازم: **${standard}**`,
      `بار خالص: **${formatFa(load, 1)} وات**`,
      `بودجه PoE موردنیاز سوئیچ با ۲۰٪ حاشیه: **${formatFa(withMargin, 1)} وات**`,
      "",
      `پیشنهاد: سوئیچ با حداقل **${formatFa(Math.ceil(withMargin / 30) * 30)} وات** بودجه PoE و حداقل **${formatFa(Math.ceil(cameraCount * 1.25))} پورت**.`,
      "",
      "دقت کنید بودجه کل سوئیچ با بیشینه توان هر پورت فرق دارد؛ سوئیچ ممکن است پورت ۳۰ واتی داشته باشد ولی بودجه کل آن فقط ۶۵ وات باشد."
    ],
    assumptions: [
      slots.cameraCount === undefined ? `تعداد دوربین فرض شد: ${formatFa(defaultCameraCount)}` : "",
      slots.watts === undefined ? "مصرف هر دوربین فرض شد: ۸ وات (دوربین ثابت با IR)" : "",
      "دوربین PTZ، هیتردار و نور سفید مصرف اوج بسیار بالاتری دارند"
    ].filter(Boolean),
    tool: { slug: "capacity", label: "محاسبه‌گر ظرفیت و توان" }
  };
}

export function upsSkill(slots: Slots): Answer {
  const cameraCount = slots.cameraCount ?? defaultCameraCount;
  const perCameraW = slots.watts ?? 8;
  const cameraLoad = cameraCount * perCameraW;
  const switchLoss = cameraLoad * 0.12;
  const nvrLoad = 40;
  const diskLoad = Math.max(1, Math.ceil((slots.diskCount ?? 2))) * 8;
  const totalLoad = cameraLoad + switchLoss + nvrLoad + diskLoad;
  const requirements = calculateUpsRequirements(totalLoad);
  const runtimeMinutes = slots.minutes ?? 15;

  return {
    source: "calculation",
    title: `انتخاب UPS برای سیستم ${formatFa(cameraCount)} دوربینه`,
    lines: [
      `مصرف دوربین‌ها: **${formatFa(cameraLoad, 1)} وات**`,
      `تلفات سوئیچ PoE (۱۲٪): **${formatFa(switchLoss, 1)} وات**`,
      `دستگاه ضبط و هاردها: **${formatFa(nvrLoad + diskLoad, 1)} وات**`,
      `بار کل: **${formatFa(totalLoad, 1)} وات**`,
      "",
      `توان خروجی موردنیاز با ۲۵٪ حاشیه: **${formatFa(requirements.requiredOutputW, 1)} وات**`,
      `ظرفیت موردنیاز: **${formatFa(requirements.requiredCapacityVa)} ولت‌آمپر (VA)**`,
      "",
      `برای ${formatFa(runtimeMinutes)} دقیقه پشتیبانی، ${runtimeMinutes > 30 ? "به بانک باتری خارجی نیاز دارید؛ UPS استاندارد اداری این زمان را پوشش نمی‌دهد." : "یک UPS آنلاین یا لاین‌اینتراکتیو با این ظرفیت معمولاً کافی است."}`,
      "",
      "مودم و تجهیز ارتباطی را هم روی UPS بگذارید، وگرنه ضبط ادامه دارد اما دسترسی از راه دور قطع می‌شود."
    ],
    assumptions: [
      slots.cameraCount === undefined ? `تعداد دوربین فرض شد: ${formatFa(defaultCameraCount)}` : "",
      slots.watts === undefined ? "مصرف هر دوربین فرض شد: ۸ وات" : "",
      "ضریب توان ۰.۸۵ و حاشیه اطمینان ۲۵٪"
    ].filter(Boolean),
    tool: { slug: "capacity", label: "محاسبه‌گر ظرفیت و توان" }
  };
}

export function subnetSkill(slots: Slots): Answer {
  const prefix = slots.prefix ?? 24;

  if (slots.ipAddress) {
    const octets = slots.ipAddress.split(".").map(Number);
    const details = calculateIpv4Details(octets, prefix, "lan");
    return {
      source: "calculation",
      title: `تحلیل شبکه ${slots.ipAddress}/${prefix}`,
      lines: [
        `آدرس شبکه: **${details.network}**`,
        `ماسک: **${details.mask}** — وایلدکارت: **${details.wildcard}**`,
        `اولین هاست: **${details.firstHost}** — آخرین هاست: **${details.lastHost}**`,
        `برادکست: **${details.broadcast ?? "—"}**`,
        `تعداد هاست قابل استفاده: **${formatFa(details.hosts)}**`,
        "",
        `این محدوده برای **${formatFa(Math.floor(details.hosts * 0.7))} دوربین** با حاشیه رشد مناسب است.`
      ],
      assumptions: slots.prefix === undefined ? ["پیشوند فرض شد: /۲۴"] : [],
      tool: { slug: "ip", label: "محاسبه‌گر ساب‌نت IP" }
    };
  }

  const result = calculateIpv4Prefix(prefix, "lan");
  return {
    source: "calculation",
    title: `پیشوند /${formatFa(prefix)}`,
    lines: [
      `تعداد کل آدرس‌ها: **${formatFa(result.total)}**`,
      `هاست قابل استفاده: **${formatFa(result.hosts)}**`,
      "",
      "توصیه طراحی: دوربین‌ها را در VLAN جدا از شبکه اداری بگذارید و آدرس‌ها را ثابت یا رزرو DHCP کنید."
    ],
    assumptions: slots.prefix === undefined ? ["پیشوند فرض شد: /۲۴"] : [],
    tool: { slug: "ipv4", label: "محاسبه‌گر پیشوند IPv4" }
  };
}

export function wirelessSkill(slots: Slots): Answer {
  const distanceKm = slots.distanceKm ?? (slots.distanceM ? slots.distanceM / 1000 : 5);
  const frequencyMHz = (slots.frequencyGhz ?? 5) * 1000;
  const txPower = slots.dbm ?? 20;
  const gain = slots.dbi ?? 15;
  const result = calculateLinkBudget({
    txPower,
    txGain: gain,
    txLoss: 1,
    rxGain: gain,
    rxLoss: 1,
    frequencyMHz,
    distanceKm
  });
  const sensitivity = -75;
  const margin = result.rxPower - sensitivity;

  return {
    source: "calculation",
    title: `بودجه لینک بی‌سیم در ${formatFa(distanceKm, 2)} کیلومتر`,
    lines: [
      `افت مسیر فضای آزاد: **${formatFa(result.fspl, 1)} دسی‌بل**`,
      `توان دریافتی: **${formatFa(result.rxPower, 1)} dBm**`,
      `حاشیه نسبت به حساسیت گیرنده (${formatFa(sensitivity)} dBm): **${formatFa(margin, 1)} دسی‌بل**`,
      "",
      margin >= 15
        ? "این حاشیه برای لینک پایدار مناسب است."
        : margin >= 10
          ? "حاشیه در مرز قابل قبول است؛ در بارندگی و مه ممکن است افت کند."
          : "حاشیه کافی نیست. آنتن با گین بالاتر، فرکانس پایین‌تر یا کاهش فاصله لازم است.",
      "",
      `شعاع ناحیه اول فرنل در نقطه میانی: **${formatFa(fresnelRadiusM(distanceKm, frequencyMHz / 1000), 2)} متر** — حداقل ۶۰٪ آن باید از هر مانع پاک باشد.`
    ],
    assumptions: [
      slots.dbm === undefined ? "توان ارسال فرض شد: ۲۰ dBm" : "",
      slots.dbi === undefined ? "گین هر آنتن فرض شد: ۱۵ dBi" : "",
      slots.frequencyGhz === undefined ? "فرکانس فرض شد: ۵ گیگاهرتز" : "",
      "افت کابل هر سمت ۱ دسی‌بل و حساسیت گیرنده ۷۵- dBm"
    ].filter(Boolean),
    tool: { slug: "wireless", label: "محاسبه‌گر بودجه لینک بی‌سیم" }
  };
}

export function fresnelSkill(slots: Slots): Answer {
  const distanceKm = slots.distanceKm ?? (slots.distanceM ? slots.distanceM / 1000 : 5);
  const frequencyGhz = slots.frequencyGhz ?? 5;
  const radius = fresnelRadiusM(distanceKm, frequencyGhz);

  return {
    source: "calculation",
    title: `ناحیه فرنل در لینک ${formatFa(distanceKm, 2)} کیلومتری`,
    lines: [
      `شعاع ناحیه اول فرنل در نقطه میانی: **${formatFa(radius, 2)} متر**`,
      `حداقل پاک‌سازی موردنیاز (۶۰٪): **${formatFa(radius * 0.6, 2)} متر**`,
      "",
      `یعنی در نقطه میانی مسیر، هیچ مانعی نباید در شعاع ${formatFa(radius * 0.6, 2)} متری خط مستقیم بین دو آنتن باشد.`,
      "",
      "به انحنای زمین و رشد درختان هم توجه کنید؛ ارتفاع دکل را با حاشیه انتخاب کنید."
    ],
    assumptions: [
      slots.frequencyGhz === undefined ? "فرکانس فرض شد: ۵ گیگاهرتز" : "",
      slots.distanceKm === undefined && slots.distanceM === undefined ? "فاصله فرض شد: ۵ کیلومتر" : ""
    ].filter(Boolean),
    tool: { slug: "fresnel", label: "محاسبه‌گر ناحیه فرنل" }
  };
}

export function ackSkill(slots: Slots): Answer {
  const distanceKm = slots.distanceKm ?? (slots.distanceM ? slots.distanceM / 1000 : 10);
  const roundTrip = ackRoundTripMicroseconds(distanceKm);

  return {
    source: "calculation",
    title: `زمان ACK برای لینک ${formatFa(distanceKm, 2)} کیلومتری`,
    lines: [
      `زمان رفت و برگشت انتشار: **${formatFa(roundTrip, 2)} میکروثانیه**`,
      "",
      "در لینک‌های بلند، اگر ACK Timeout رادیو کمتر از این مقدار تنظیم شود، فریم‌ها بی‌دلیل ارسال مجدد می‌شوند و توان عملیاتی به‌شدت افت می‌کند.",
      "بیشتر رادیوهای حرفه‌ای تنظیم خودکار فاصله دارند؛ در صورت تنظیم دستی، مقدار را با حاشیه بالاتر از عدد بالا بگذارید."
    ],
    assumptions: slots.distanceKm === undefined && slots.distanceM === undefined ? ["فاصله فرض شد: ۱۰ کیلومتر"] : [],
    tool: { slug: "ack", label: "محاسبه‌گر زمان ACK" }
  };
}

export function dbmSkill(slots: Slots): Answer {
  if (slots.milliwatts !== undefined) {
    const dbm = milliwattsToDbm(slots.milliwatts);
    return {
      source: "calculation",
      title: `تبدیل ${formatFa(slots.milliwatts, 2)} میلی‌وات به dBm`,
      lines: [`نتیجه: **${dbm === null ? "—" : formatFa(dbm, 2)} dBm**`, "", "رابطه: dBm = ۱۰ × log₁₀(mW)"],
      tool: { slug: "mw-dbm", label: "مبدل mW و dBm" }
    };
  }

  const dbm = slots.dbm ?? slots.numbers[0] ?? 20;
  const milliwatts = dbmToMilliwatts(dbm);
  return {
    source: "calculation",
    title: `تبدیل ${formatFa(dbm, 2)} dBm به میلی‌وات`,
    lines: [
      `نتیجه: **${formatFa(milliwatts, 2)} میلی‌وات** (${formatFa(milliwatts / 1000, 3)} وات)`,
      "",
      "رابطه: mW = ۱۰^(dBm ÷ ۱۰)",
      "یادآوری: هر ۳ دسی‌بل افزایش یعنی دو برابر شدن توان، و هر ۱۰ دسی‌بل یعنی ده برابر."
    ],
    tool: { slug: "mw-dbm", label: "مبدل mW و dBm" }
  };
}

export function channelSkill(slots: Slots): Answer {
  const cameraCount = slots.cameraCount ?? defaultCameraCount;
  const megapixel = slots.megapixel ?? defaultMegapixel;
  const options = [4, 8, 16, 32, 64, 128];
  const recommended = options.find((option) => option >= Math.ceil(cameraCount * 1.25)) ?? 128;
  const totalMbps = kbpsToMbps(referenceBitrateKbps(megapixel) * cameraCount);

  return {
    source: "calculation",
    title: `تعداد کانال دستگاه برای ${formatFa(cameraCount)} دوربین`,
    lines: [
      `دستگاه پیشنهادی: **${formatFa(recommended)} کانال**`,
      `دلیل: با ${formatFa(cameraCount)} دوربین، حداقل ۲۵٪ ظرفیت خالی برای توسعه لازم است.`,
      "",
      `پهنای باند ورودی موردنیاز: **حداقل ${formatFa(Math.ceil((totalMbps * 1.2) / 10) * 10)} مگابیت بر ثانیه**`,
      "",
      "قبل از خرید این سه سقف را هم بررسی کنید:",
      "• پهنای باند ورودی NVR",
      "• ظرفیت Decode برای نمایش هم‌زمان",
      "• تعداد Bay هارد نسبت به حجم آرشیو موردنیاز"
    ],
    assumptions: [
      slots.cameraCount === undefined ? `تعداد دوربین فرض شد: ${formatFa(defaultCameraCount)}` : "",
      slots.megapixel === undefined ? `رزولوشن فرض شد: ${formatFa(defaultMegapixel)} مگاپیکسل` : ""
    ].filter(Boolean),
    followUps: ["چقدر هارد برای این سیستم لازم است؟"]
  };
}

export function cableSkill(slots: Slots): Answer {
  const distanceM = slots.distanceM ?? 150;
  const lines = [`فاصله موردنظر: **${formatFa(distanceM)} متر**`, ""];

  if (distanceM <= 100) {
    lines.push("این فاصله در محدوده استاندارد اترنت است و با یک کابل Cat5e یا Cat6 مسی خالص پوشش داده می‌شود.");
    lines.push("رعایت کنید: حداکثر ۹۰ متر کابل ثابت به‌علاوه ۱۰ متر پچ‌کورد.");
  } else if (distanceM <= 250) {
    lines.push("از حد استاندارد ۱۰۰ متر عبور کرده‌اید. گزینه‌ها:");
    lines.push("• حالت Extend سوئیچ PoE — تا حدود ۲۵۰ متر با سرعت ۱۰ مگابیت بر ثانیه (فقط برای یک یا دو دوربین کم‌بیت‌ریت)");
    lines.push("• سوئیچ میانی با تغذیه برق در نقطه وسط");
    lines.push("• مبدل فیبر نوری");
  } else {
    lines.push("این فاصله فقط با یکی از این روش‌ها قابل اجراست:");
    lines.push("• فیبر نوری با مبدل مدیا در دو سر — انتخاب درست برای مسیر بیرونی و بین دو ساختمان");
    lines.push("• زنجیره سوئیچ‌های میانی با تغذیه محلی");
    lines.push("• لینک بی‌سیم در صورت وجود دید مستقیم");
  }

  lines.push("");
  lines.push("کابل حتماً مسی خالص باشد. کابل CCA افت ولتاژ PoE را زیاد می‌کند و شایع‌ترین علت ریست شدن دوربین‌های دوردست است.");

  return {
    source: "calculation",
    title: "بررسی فاصله و کابل‌کشی",
    lines,
    assumptions: slots.distanceM === undefined ? ["فاصله فرض شد: ۱۵۰ متر"] : [],
    followUps: ["بودجه PoE سوئیچ چقدر باشد؟"]
  };
}

function goalLabel(goal: keyof typeof doriPixelsPerMeter) {
  const labels: Record<keyof typeof doriPixelsPerMeter, string> = {
    detect: "کشف حضور",
    observe: "مشاهده رفتار",
    recognize: "بازشناسی",
    identify: "شناسایی هویت",
    anpr: "پلاک‌خوانی"
  };
  return labels[goal];
}

function nearestCommercialLens(focalMm: number) {
  const common = [2.8, 3.6, 4, 6, 8, 12, 16, 25, 35, 50];
  if (focalMm > 50) return "لنز بلندتر از ۵۰ میلی‌متر یا دوربین PTZ با زوم اپتیکال";
  let closest = common[0];
  for (const value of common) {
    if (Math.abs(value - focalMm) < Math.abs(closest - focalMm)) closest = value;
  }
  return `${formatFa(closest, 1)} میلی‌متر`;
}
