"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { KeyRound, MessageSquareText, ShieldCheck } from "lucide-react";

export type LoginMode = "otp" | "password";

type AuthApiResult = {
  ok?: boolean;
  error?: string;
  message?: string;
};

async function postAuth(path: string, body: object) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const raw = await response.text();
  let data: AuthApiResult = {};
  if (raw) {
    try {
      data = JSON.parse(raw) as AuthApiResult;
    } catch {
      data = { error: "پاسخ سرویس ورود معتبر نبود." };
    }
  }
  return { response, data };
}

export function LoginForm({ initialMode, initialError = "" }: { initialMode: LoginMode; initialError?: string }) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(initialError);

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    setMessage("");

    try {
      const { response, data } = await postAuth("/api/auth/login", { username, password });
      if (!response.ok || !data.ok) {
        setError(data.error || "ورود انجام نشد.");
        return;
      }
      window.location.href = "/calculators";
    } catch {
      setError("ارتباط با سرویس ورود برقرار نشد.");
    } finally {
      setPending(false);
    }
  }

  async function requestOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    setMessage("");

    try {
      const { response, data } = await postAuth("/api/auth/otp/request", { phone });
      if (!response.ok || !data.ok) {
        setError(data.error || "ارسال کد انجام نشد.");
        return;
      }
      setOtpSent(true);
      setMessage(data.message || "کد ورود ارسال شد.");
    } catch {
      setError("ارتباط با سرویس پیامک برقرار نشد.");
    } finally {
      setPending(false);
    }
  }

  async function verifyOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");

    try {
      const { response, data } = await postAuth("/api/auth/otp/verify", { phone, code });
      if (!response.ok || !data.ok) {
        setError(data.error || "کد تایید نشد.");
        return;
      }
      window.location.href = "/calculators";
    } catch {
      setError("ارتباط با سرویس ورود برقرار نشد.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <p className="eyebrow">ورود امن</p>
        <h1>ورود به حساب کاربری</h1>
        <p className="auth-lead">
          با شماره موبایل و کد یک‌بار مصرف وارد شوید یا از رمز عبور حساب خود استفاده کنید.
        </p>

        <div className="auth-tabs" role="tablist" aria-label="روش ورود">
          <a href="/login" role="tab" aria-selected={initialMode === "otp"} className={initialMode === "otp" ? "active" : ""}>
            <MessageSquareText size={16} aria-hidden="true" />
            پیامک
          </a>
          <a
            href="/login?mode=password"
            role="tab"
            aria-selected={initialMode === "password"}
            className={initialMode === "password" ? "active" : ""}
          >
            <KeyRound size={16} aria-hidden="true" />
            رمز ثابت
          </a>
        </div>

        {initialMode === "otp" ? (
          <div className="auth-flow">
            <form className="form-stack" onSubmit={requestOtp}>
              <label htmlFor="phone">شماره موبایل</label>
              <input
                id="phone"
                name="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="09123456789"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                required
              />
              <button type="submit" disabled={pending}>
                {pending ? "در حال ارسال..." : "ارسال کد"}
              </button>
            </form>

            {otpSent ? (
              <form className="form-stack" onSubmit={verifyOtp}>
                <label htmlFor="code">کد یک‌بار مصرف</label>
                <input
                  id="code"
                  name="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123456"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  required
                />
                <button type="submit" disabled={pending}>
                  تایید و ورود
                </button>
              </form>
            ) : null}
          </div>
        ) : (
          <form className="form-stack" method="post" action="/api/auth/login" onSubmit={submitPassword}>
            <label htmlFor="username">نام کاربری</label>
            <input id="username" name="username" value={username} onChange={(event) => setUsername(event.target.value)} required />
            <label htmlFor="password">رمز عبور</label>
            <input id="password" name="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
            <button type="submit" disabled={pending}>
              <ShieldCheck size={16} aria-hidden="true" />
              ورود
            </button>
          </form>
        )}

        {message ? <p className="form-message success">{message}</p> : null}
        {error ? <p className="form-message error">{error}</p> : null}
        <p className="auth-switch">
          حساب ندارید؟ <Link href="/register">ثبت‌نام کنید</Link>
        </p>
      </section>
    </main>
  );
}
