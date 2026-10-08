import { Mail, MapPin, Phone } from "lucide-react";
import Image from "next/image";

type SocialIconName = "telegram" | "instagram" | "facebook" | "twitter" | "linkedin" | "youtube" | "aparat";

const socialLinks = [
  { href: "https://telegram.me/ddcpersia", label: "تلگرام", icon: "telegram" as const },
  { href: "https://www.instagram.com/accounts/login/?next=/persiasystem/", label: "اینستاگرام", icon: "instagram" as const },
  { href: "https://www.linkedin.com/company/10004212/admin/", label: "لینکدین", icon: "linkedin" as const },
  { href: "https://www.aparat.com/ddcpersia", label: "آپارات", icon: "aparat" as const },
  { href: "https://www.youtube.com/channel/UCc5rtHPtSBne6DFLg3KvmDA?view_as=subscriber", label: "یوتیوب", icon: "youtube" as const },
  { href: "https://www.facebook.com/persiasystem-1341386802692930/", label: "فیسبوک", icon: "facebook" as const },
  { href: "https://twitter.com/SystemPersia", label: "توییتر", icon: "twitter" as const }
];

function SocialIcon({ name }: { name: SocialIconName }) {
  if (name === "instagram") {
    return (
      <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
        <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
        <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
      </svg>
    );
  }

  if (name === "telegram") {
    return (
      <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 5L2 12.5l7 2.5 12-8.5-9 9.5v5l3.5-3.5 4.5 3.5L21 5z" />
      </svg>
    );
  }

  if (name === "youtube") {
    return (
      <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z" />
        <polygon points="9.75 15.02 15.5 12 9.75 8.98 9.75 15.02" />
      </svg>
    );
  }

  if (name === "aparat") {
    return (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
        <circle cx="12" cy="12" r="7" />
        <circle cx="9" cy="8.5" r="1.4" />
        <circle cx="15.5" cy="10" r="1.4" />
        <circle cx="13.8" cy="16" r="1.4" />
        <circle cx="8" cy="14" r="1.4" />
      </svg>
    );
  }

  const labels: Record<Exclude<SocialIconName, "instagram" | "telegram" | "youtube" | "aparat">, string> = {
    facebook: "F",
    twitter: "X",
    linkedin: "in"
  };

  return <span style={{ fontSize: "16px", fontWeight: "900" }} aria-hidden="true">{labels[name]}</span>;
}

export default function ContactsPage() {
  return (
    <main className="app-shell">
      <section className="contacts-page">
        <div className="calc-header">
          <div>
            <p className="eyebrow">راه‌های ارتباطی</p>
            <h1>تماس با ما</h1>
            <p className="lead">کارشناسان پرشیا سیستم آماده پاسخگویی به سوالات و راهنمایی شما در زمینه‌های فنی و فروش هستند.</p>
          </div>
        </div>

        <div className="contacts-grid">
          <div className="contacts-left">
            <div className="panel contacts-brand-card">
              <div className="contacts-brand-info">
                <div className="contacts-logo-wrap">
                  <Image src="/assets/New-Project-13.jpg" alt="لوگوی پرشیا سیستم" width={160} height={63} className="contacts-logo" />
                </div>
                <h2>شرکت پرشیا سیستم</h2>
                <p>پیشرو در ارائه راهکارهای نوین دوربین‌های مداربسته و تجهیزات شبکه تحت شبکه</p>
              </div>

              <div className="contacts-socials-section">
                <h3>شبکه‌های اجتماعی ما</h3>
                <div className="contacts-socials-grid">
                  {socialLinks.map((item) => (
                    <a key={item.href} href={item.href} className="social-pill" target="_blank" rel="noreferrer" title={item.label}>
                      <span className="social-pill-icon">
                        <SocialIcon name={item.icon} />
                      </span>
                      <span>{item.label}</span>
                    </a>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="contacts-right">
            <div className="contacts-info-cards">
              <div className="panel contact-info-card">
                <span className="contact-info-icon">
                  <MapPin size={24} aria-hidden="true" />
                </span>
                <div className="contact-info-content">
                  <span>دفتر مرکزی</span>
                  <strong>نشانی شرکت</strong>
                  <p>تهران، میدان آرژانتین، خیابان وزرا یا خالد اسلامبولی، خیابان بهزاد شفق (۱۷ ام)، پلاک ۱۸</p>
                </div>
              </div>

              <div className="contact-two-columns">
                <div className="panel contact-info-card">
                  <span className="contact-info-icon contact-icon-phone">
                    <Phone size={24} aria-hidden="true" />
                  </span>
                  <div className="contact-info-content">
                    <span>واحد فروش و اداری</span>
                    <strong>تلفن تماس</strong>
                    <a href="tel:02154871200" className="contact-link-call">۰۲۱-۵۴۸۷۱۲۰۰</a>
                    <small>شنبه تا چهارشنبه ۹:۰۰ الی ۱۷:۰۰</small>
                  </div>
                </div>

                <div className="panel contact-info-card">
                  <span className="contact-info-icon contact-icon-support">
                    <Phone size={24} aria-hidden="true" />
                  </span>
                  <div className="contact-info-content">
                    <span>پشتیبانی فنی</span>
                    <strong>تلفن پشتیبانی</strong>
                    <a href="tel:02154871300" className="contact-link-call">۰۲۱-۵۴۸۷۱۳۰۰</a>
                    <small>پاسخگویی سریع به مشکلات فنی ابزارها</small>
                  </div>
                </div>
              </div>

              <div className="panel contact-info-card">
                <span className="contact-info-icon contact-icon-email">
                  <Mail size={24} aria-hidden="true" />
                </span>
                <div className="contact-info-content">
                  <span>پست الکترونیکی</span>
                  <strong>ارسال ایمیل</strong>
                  <a href="mailto:info@ddcpersia.com" className="contact-link-call">info@ddcpersia.com</a>
                  <small>پاسخگویی در کمتر از ۲۴ ساعت کاری</small>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
