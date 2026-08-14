/**
 * Removes generated product recommendations whose model number is not backed by a
 * retrieved datasheet. Negative statements such as "not verified" remain visible.
 */
export function removeUnsupportedProductClaims(content: string, allowedPartNumbers: string[]) {
  const allowed = new Set(allowedPartNumbers.map(normalizedPartNumber).filter(Boolean));
  let removed = false;
  const lines = content.split("\n").filter((line) => {
    const tokens = line.match(/(?=[A-Z0-9._/-]*\d)[A-Z]{1,8}[-_/][A-Z0-9][A-Z0-9._/-]{2,}/gi) ?? [];
    const unsupported = tokens.filter((token) => {
      const normalized = normalizedPartNumber(token);
      if (/^(?:CAT|IEEE|IEC|EN|ONVIF|WPA|IPV|POE)/.test(normalized)) return false;
      return !allowed.has(normalized);
    });
    if (!unsupported.length) return true;
    if (/(تأیید نشده|تایید نشده|در دیتابیس نیست|داده کافی نیست|دیتاشیت.*(?:نیست|ندار)|نمی‌توان.*تأیید|قابل تأیید نیست)/.test(line)) return true;
    removed = true;
    return false;
  });
  if (removed) {
    lines.push("", "**کنترل مشخصات محصول:** مدل یا قابلیت بدون دیتاشیت تأییدشده از پاسخ حذف شد؛ برای پیشنهاد دقیق، برند، Part Number یا نیازهای پروژه را مشخص کنید.");
  }
  return lines.join("\n").trim();
}

export function normalizedPartNumber(value: string) {
  return value.toLocaleUpperCase("en").replace(/[^A-Z0-9]+/g, "");
}
