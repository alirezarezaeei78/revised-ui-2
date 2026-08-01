import { NextResponse } from "next/server";
import { sessionCookieName, sessionCookieOptions } from "@/src/lib/session";
import { rateLimit, signSession, verifyPassword } from "@/src/lib/authStore";

function getClientKey(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

async function readCredentials(request: Request) {
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const body = await request.json().catch(() => null);
    return {
      isFormPost: false,
      username: String(body?.username ?? "").trim(),
      password: String(body?.password ?? "")
    };
  }

  const formData = await request.formData().catch(() => null);
  return {
    isFormPost: true,
    username: String(formData?.get("username") ?? "").trim(),
    password: String(formData?.get("password") ?? "")
  };
}

function formRedirect(request: Request, path: string) {
  const host = request.headers.get("host");
  const protocol = request.headers.get("x-forwarded-proto") || "http";
  const baseUrl = host ? `${protocol}://${host}` : request.url;
  return NextResponse.redirect(new URL(path, baseUrl), { status: 303 });
}

function failedLoginResponse(request: Request, isFormPost: boolean, error: string, status: number) {
  if (!isFormPost) {
    return NextResponse.json({ ok: false, error }, { status });
  }

  const searchParams = new URLSearchParams({ mode: "password", error });
  return formRedirect(request, `/login?${searchParams.toString()}`);
}

export async function POST(request: Request) {
  const { isFormPost, username, password } = await readCredentials(request);

  const limited = rateLimit(`login:${getClientKey(request)}:${username}`, 12, 15 * 60 * 1000);
  if (!limited.ok) {
    return failedLoginResponse(request, isFormPost, "تعداد تلاش‌ها زیاد است. چند دقیقه دیگر دوباره تلاش کنید.", 429);
  }

  if (!username || !password) {
    return failedLoginResponse(request, isFormPost, "نام کاربری و رمز عبور الزامی است.", 400);
  }

  let result: Awaited<ReturnType<typeof verifyPassword>>;
  try {
    result = await verifyPassword(username, password);
  } catch (error) {
    console.error("Password login failed before credentials could be verified", error);
    return failedLoginResponse(
      request,
      isFormPost,
      "سرویس ورود به پایگاه داده متصل نیست. تنظیمات DATABASE_URL را بررسی کنید.",
      503
    );
  }
  if (!result.ok) {
    return failedLoginResponse(request, isFormPost, result.error, 401);
  }

  const response = isFormPost
    ? formRedirect(request, "/calculators")
    : NextResponse.json({ ok: true, role: result.user.role });
  response.cookies.set(sessionCookieName, signSession(result.user), sessionCookieOptions());
  return response;
}
