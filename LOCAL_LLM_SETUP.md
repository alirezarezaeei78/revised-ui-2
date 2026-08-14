# راه‌اندازی مدل زبانی محلی هوش‌یار

هوش‌یار از `Qwen3 4B Instruct` برای پاسخ‌های سریع و `Qwen3 8B` برای حالت هوش زیاد روی Ollama استفاده می‌کند. استنتاج روی
ماشین میزبان انجام می‌شود؛ API پولی، کلید و هزینه توکن وجود ندارد. رابط Next.js فقط
با `127.0.0.1:11434` روی همان سرور صحبت می‌کند. حالت «زیاد» از thinking خصوصی
استفاده می‌کند؛ حالت‌های «کم» و «متوسط» برای پاسخ سریع‌تر روی CPU مستقیم پاسخ می‌دهند.

## نیاز سخت‌افزاری

- حداقل عملی: ۸ گیگابایت RAM برای مدل ۴B کوانتیزه.
- پیشنهاد: ۱۲ تا ۱۶ گیگابایت RAM. GPU اختیاری است و برنامه روی CPU نیز اجرا می‌شود.
- مدل پیش‌فرض حدود ۲.۵ گیگابایت دانلود دارد.

## نصب و ساخت مدل اختصاصی

ابتدا Ollama را روی سروری نصب کنید که برنامه Next.js روی آن اجرا می‌شود. سپس از
ریشه پروژه:

```powershell
ollama pull qwen3:4b-instruct
ollama pull qwen3:8b
ollama pull qwen3-embedding:0.6b
ollama create hamyar-security -f ollama/Modelfile
ollama run hamyar-security
```

پس از اولین پاسخ، اجرای تعاملی را با `Ctrl+C` ببندید؛ سرویس Ollama در پس‌زمینه
فعال می‌ماند. وضعیت را بررسی کنید:

```powershell
npm run llm:check
```

در Linux سرویس را فعال کنید:

```bash
sudo systemctl enable --now ollama
ollama pull qwen3:4b-instruct
ollama pull qwen3:8b
ollama pull qwen3-embedding:0.6b
ollama create hamyar-security -f ollama/Modelfile
```

## تنظیم برنامه

مقادیر پیش‌فرض برای نصب روی همان میزبان مناسب‌اند:

```env
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=hamyar-security
OLLAMA_HIGH_MODEL=qwen3:8b
OLLAMA_EMBED_MODEL=qwen3-embedding:0.6b
```

اگر Next.js داخل Docker و Ollama روی میزبان است، آدرس معمولاً باید به
`http://host.docker.internal:11434` تغییر کند. پورت ۱۱۴۳۴ را روی اینترنت عمومی
منتشر نکنید؛ فقط Backend برنامه باید به آن دسترسی داشته باشد.

## معماری پاسخ

1. پیام و تاریخچه کوتاه گفتگو به مدل محلی فرستاده می‌شود.
2. مقالات داخلی و اسناد رسمی از Full Text و در صورت نصب pgvector از جست‌وجوی معنایی محلی بازیابی می‌شوند.
3. اگر سؤال محاسباتی باشد، خروجی دقیق ابزار پروژه به مدل داده می‌شود.
4. پاسخ‌های قطعی کاتالوگ، دیتاشیت و محاسبات مستقیم نمایش داده می‌شوند تا مدل نتواند عدد یا Part Number را تغییر دهد.
5. Qwen3 برای عیب‌یابی، طراحی، امنیت و ادامهٔ مکالمه پاسخ فارسی را Stream می‌کند. حالت «زیاد» thinking خصوصی را فعال می‌کند.
6. حالت‌های «کم» و «متوسط» مدل ۴B کم‌مصرف را اجرا می‌کنند؛ حالت «زیاد» از مدل ۸B با thinking خصوصی و بودجه راستی‌آزمایی بیشتر استفاده می‌کند. اگر مدل ۸B نصب نباشد، API به‌طور خودکار به مدل ۴B برمی‌گردد.
7. مشخصات مدل و Part Number فقط از کاتالوگ یا رکورد دیتاشیت تأییدشده پاسخ داده می‌شود؛ داده ناموجود حدس زده نمی‌شود.
8. حافظه خودکار، اطلاعات پایدار مانند نام، نقش، سطح تجربه، ترجیحات برند و محدودیت‌های فنی کاربر را در PostgreSQL (یا فایل محلی توسعه) نگه می‌دارد. سؤال‌های گذرا، رمز و توکن ذخیره نمی‌شوند.
9. اگر Ollama موقتاً در دسترس نباشد، موتور NLP و محاسبات قبلی پاسخ پشتیبان می‌دهد.
10. برای طراحی سایت، Playbook همان محیط و قواعد شبکه به Context اضافه می‌شود؛ برای مدل محصول فقط دیتاشیت دارای Part Number دقیق معتبر است.

زنجیره فکر خام به کاربر نمایش داده نمی‌شود. رابط فقط وضعیت واقعی «در حال استدلال»
و روش قابل بررسی پاسخ را نشان می‌دهد.

## افزودن دیتاشیت‌های تأییدشده

دانستن «همه مدل‌های همه برندها» بدون مجموعه داده معتبر ممکن نیست. برای توسعه پوشش،
رکوردهای استخراج‌شده از دیتاشیت رسمی سازنده را به شکل JSON زیر آماده کنید؛ هر
Part Number باید لینک HTTPS و عنوان منبع خودش را داشته باشد:

```json
[
  {
    "brand": "Manufacturer",
    "partNumber": "EXACT-PART-NUMBER",
    "sourceUrl": "https://manufacturer.example/datasheet.pdf",
    "sourceTitle": "Official manufacturer datasheet",
    "facts": {
      "resolutionMp": 4,
      "lens": "2.8 mm",
      "poe": true,
      "ipRating": "IP67"
    }
  }
]
```

سپس روی سروری که PostgreSQL دارد اجرا کنید:

```powershell
$env:DATABASE_URL="postgresql://..."
npm run datasheets:import -- C:\data\verified-datasheets.json
```

همین داده از API مدیریتی `GET/POST/DELETE /api/admin/catalog/datasheets` نیز قابل
مدیریت است. نرمال‌سازی WooCommerce برای جست‌وجو مفید است، اما مشخصات فنی آن تا
زمان اتصال یک رکورد دیتاشیت تأییدشده به Part Number در پاسخ به‌عنوان واقعیت نشان
داده نمی‌شود.

## ورود کامل PDF، Manual و راهنمای رسمی

برای پوشش تعداد زیاد برند و مدل، از `knowledge/official-sources.example.json` یک
Manifest جدید بسازید. `allowedDomains` باید فقط دامنه‌های رسمی سازندگان یا ناشران
استاندارد باشد. هر Document یکی از نوع‌های `datasheet`، `manual`، `installation`،
`network`، `standard`، `security` یا `troubleshooting` است. دیتاشیت حتماً باید
`brand` و `partNumber` دقیق داشته باشد.

سپس اجرا کنید:

```powershell
$env:DATABASE_URL="postgresql://..."
$env:OLLAMA_EMBED_MODEL="qwen3-embedding:0.6b"
npm run knowledge:ingest -- C:\data\official-cctv-sources.json
```

Importer این کنترل‌ها را اعمال می‌کند:

- فقط URLهای HTTPS داخل Allowlist؛ Host محلی و Private رد می‌شود.
- حداکثر حجم ۳۰ مگابایت و حداکثر متن استخراج‌شده ۳ میلیون نویسه برای هر سند.
- استخراج متن PDF با شماره صفحه، قطعه‌بندی با هم‌پوشانی و Hash منبع.
- ساخت Embedding کاملاً محلی از API خود Ollama؛ هیچ متن یا فایل به Cloud ارسال نمی‌شود.
- ثبت Facts ساختاریافته دیتاشیت در جدول کاتالوگ و ثبت متن کامل در Knowledge Store.
- پیوست خودکار عنوان، URL، Part Number و صفحه منبع به پاسخ مدل.

برای جست‌وجوی معنایی سریع روی مجموعه بزرگ، Extension زیر را یک بار روی PostgreSQL
فعال کنید:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

اگر `pgvector` نصب یا قابل فعال‌سازی نباشد، ورود سند متوقف نمی‌شود و PostgreSQL
Full Text همچنان کار می‌کند؛ فقط رتبه‌بندی معنایی غیرفعال می‌ماند. این خط لوله
مدیریتی است و هیچ بخش Upload برای کاربر نهایی ایجاد نمی‌کند.
