import { normalizePersian } from "@/src/lib/chatbot/persian";

type NetworkTopic = {
  pattern: RegExp;
  title: string;
  guidance: string[];
};

const topics: NetworkTopic[] = [
  {
    pattern: /ip|آدرس|ساب ?نت|subnet|dhcp|gateway|گیت ?وی|dns|ntp/,
    title: "آدرس‌دهی و سرویس‌های پایه",
    guidance: [
      "برای تجهیزات زیرساختی IP پایدار استفاده کن: Static مستند یا DHCP Reservation؛ محدوده دوربین، ضبط و مدیریت در نقشه IP ثبت شود.",
      "Gateway فقط وقتی لازم است که تجهیز باید از Subnet خارج شود. دسترسی خروجی دوربین را با Firewall محدود کن.",
      "NTP واحد برای دوربین، NVR/VMS، کنترل تردد و Log Server ضروری است؛ اختلاف زمان اعتبار شواهد و عیب‌یابی را از بین می‌برد.",
      "DNS دوربین فقط در صورت نیاز واقعی مجاز باشد و به Resolver مشخص داخلی محدود شود."
    ]
  },
  {
    pattern: /vlan|trunk|access|سوئیچ|سوییچ|switch|stp|lacp/,
    title: "Switching و VLAN",
    guidance: [
      "پورت دوربین Access/Untagged در VLAN دوربین است؛ لینک بین سوئیچ‌ها Trunk/Tagged فقط برای VLANهای لازم است.",
      "پورت NVR پیش‌فرض Access است. Trunk فقط با پشتیبانی و پیکربندی صریح 802.1Q روی NVR مجاز است.",
      "Native VLAN ناامن و VLANهای بلااستفاده روی Trunk مجاز نشوند؛ پورت بدون استفاده Shutdown شود.",
      "STP Root و مسیر افزونه را طراحی کن؛ LACP ظرفیت یک جریان منفرد را دو برابر نمی‌کند و باید پشتیبانی دو سمت تأیید شود."
    ]
  },
  {
    pattern: /پهنای ?باند|bandwidth|bitrate|بیت ?ریت|uplink|آپ ?لینک|ظرفیت|decode/,
    title: "ظرفیت و جریان‌های ویدئویی",
    guidance: [
      "بار ضبط را از جمع بیت‌ریت واقعی هر Stream محاسبه کن؛ Live View، Sub-stream، بازپخش، Failover و ترافیک مدیریتی مسیرهای جدا دارند.",
      "ظرفیت ورودی NVR/VMS، توان Decode کلاینت و ظرفیت Uplink را جداگانه کنترل کن؛ تعداد کانال به‌تنهایی کافی نیست.",
      "حاشیه رشد فقط یک بار و با درصد اعلام‌شده پروژه اعمال شود. Speed اسمی پورت معادل Throughput تضمین‌شده نیست.",
      "برای ازدحام یا Packet Loss از Counterهای Interface، Drop/Error، Queue و نرخ واقعی Stream استفاده کن، نه حدس."
    ]
  },
  {
    pattern: /poe|پی ?او ?ای|توان|وات|بودجه برق|af|at|bt/,
    title: "PoE و برق",
    guidance: [
      "بودجه PoE را با بیشینه مصرف دیتاشیت در بدترین حالت IR، هیتر، فن و موتور جمع کن و محدودیت هر پورت و کل سوئیچ را جدا ببین.",
      "استاندارد موردنیاز PD و خروجی واقعی PSE باید سازگار باشند؛ Passive PoE را هم‌ارز IEEE PoE فرض نکن.",
      "افت ولتاژ و کیفیت کابل در مسیر بلند اهمیت دارد. از CCA برای لینک PoE پروژه‌ای استفاده نکن.",
      "توان UPS باید سوئیچ، NVR، دیسک‌ها، سرور، مانیتورهای ضروری و تلفات را پوشش دهد و زمان پشتیبانی با بار واقعی سنجیده شود."
    ]
  },
  {
    pattern: /multicast|مولتی ?کست|igmp|پخش گروهی/,
    title: "Multicast",
    guidance: [
      "Multicast فقط وقتی مفید است که چند گیرنده همان Stream را هم‌زمان مصرف کنند و دوربین/VMS از آن پشتیبانی کنند.",
      "IGMP Snooping روی Access Switch و IGMP Querier در VLAN لازم است؛ بدون آن Multicast می‌تواند مانند Broadcast Flood شود.",
      "TTL، عبور بین VLANها و PIM فقط برای طراحی چندشبکه‌ای و با نیاز مشخص اضافه شوند.",
      "ضبط اصلی را بدون آزمون Failover و سازگاری به Multicast وابسته نکن."
    ]
  },
  {
    pattern: /کابل|cat|متر|فیبر|fiber|sfp|بین ساختمان|surge|صاعقه/,
    title: "رسانه، فاصله و فیبر",
    guidance: [
      "کانال مسی اترنت حداکثر 100 متر و Permanent Link معمولاً حداکثر 90 متر طراحی می‌شود؛ Patch Cordها جزو کانال‌اند.",
      "بین ساختمان‌ها، کنار برق قدرت، محیط نویزی یا محل دارای اختلاف زمین، فیبر ایمن‌تر و پایدارتر از مس است.",
      "نوع Single-mode/Multi-mode، طول موج، Connector و Optical Budget ماژول‌های SFP دو سمت باید منطبق باشند.",
      "Surge Protector جای ارت، هم‌بندی و مسیر صحیح کابل را نمی‌گیرد؛ حفاظت باید متناسب با هر دو سمت لینک طراحی شود."
    ]
  },
  {
    pattern: /وایرلس|بی ?سیم|wifi|رادیو|لینک|فرزنل|fresnel|کانال رادیویی/,
    title: "Wireless Bridge",
    guidance: [
      "دید مستقیم و آزادبودن ناحیه Fresnel را بررسی کن؛ دیده‌شدن ظاهری آنتن‌ها به‌تنهایی کافی نیست.",
      "ظرفیت واقعی را از Throughput دوطرفه، سطح سیگنال، Noise Floor، SNR، Channel Width و شلوغی طیف بسنج.",
      "WPA2/WPA3 با کلید یکتا، مدیریت از VLAN امن و غیرفعال‌کردن سرویس ابری غیرضروری لازم است.",
      "برای لینک بحرانی، مسیر پشتیبان یا ذخیره محلی دوربین در زمان قطعی در نظر بگیر."
    ]
  },
  {
    pattern: /vpn|اینترنت|راه دور|remote|فایروال|firewall|acl|امن|هک|نفوذ|پورت فوروارد|p2p/,
    title: "امنیت و دسترسی راه دور",
    guidance: [
      "Port Forward مستقیم پنل دوربین/NVR به اینترنت انجام نده؛ VPN با MFA و کنترل دسترسی مبتنی بر نقش استفاده کن.",
      "از VLAN مدیریت فقط پروتکل‌های لازم به IPهای مشخص مجاز باشند؛ شروع ارتباط دوربین به LAN کاربری و اینترنت مسدود شود.",
      "رمز یکتا، Firmware رسمی، غیرفعال‌سازی UPnP/P2P و سرویس‌های بدون استفاده، ثبت Log و نسخه پشتیبان تنظیمات الزامی‌اند.",
      "برای رخداد مشکوک ابتدا تجهیز را بدون نابودکردن Log ایزوله کن، زمان و شواهد را حفظ و سپس Credentialها را از مسیر امن تعویض کن."
    ]
  },
  {
    pattern: /قطع|وصل|packet|پکت|loss|تاخیر|latency|jitter|مشکل|عیب|ping/,
    title: "عیب‌یابی لایه‌ای",
    guidance: [
      "از لایه فیزیکی شروع کن: برق/PoE، Link، کابل و Error Counter؛ سپس VLAN/IP، ARP، Route/ACL و در پایان Stream/Application را بررسی کن.",
      "Ping موفق سلامت ویدئو را ثابت نمی‌کند. Packet Loss، Jitter، TCP retransmission یا UDP loss و bitrate واقعی باید اندازه‌گیری شوند.",
      "با یک تغییر در هر مرحله و ثبت نتیجه کار کن؛ Reset یا تعویض هم‌زمان چند تجهیز علت اصلی را پنهان می‌کند.",
      "زمان همه تجهیزات را همگام کن تا Log سوئیچ، دوربین و NVR قابل تطبیق باشد."
    ]
  }
];

const networkPattern = /شبکه|network|ip|vlan|poe|سوئیچ|سوییچ|switch|nvr|vms|فایروال|firewall|کابل|فیبر|وایرلس|پهنای ?باند|bitrate|vpn/;

export function buildNetworkEngineeringGrounding(message: string) {
  const normalized = normalizePersian(message).toLowerCase();
  if (!networkPattern.test(normalized)) return "";
  const matched = topics.filter((topic) => topic.pattern.test(normalized));
  return [
    "قواعد مهندسی شبکه نظارت تصویری:",
    "- توپولوژی، تعداد Streamها، مسیر ضبط/نمایش، خرابی‌های قابل تحمل و مرزهای امنیتی را قبل از انتخاب سوئیچ و NVR مشخص کن.",
    "- اعداد ظرفیت فقط از ورودی کاربر، اندازه‌گیری یا دیتاشیت تأییدشده گرفته شوند؛ ویژگی یا محدودیت مدل از روی نام آن حدس زده نشود.",
    ...matched.flatMap((topic) => ["", `${topic.title}:`, ...topic.guidance.map((line) => `- ${line}`)])
  ].join("\n");
}

export function detectedNetworkTopics(message: string) {
  const normalized = normalizePersian(message).toLowerCase();
  return topics.filter((topic) => topic.pattern.test(normalized)).map((topic) => topic.title);
}
