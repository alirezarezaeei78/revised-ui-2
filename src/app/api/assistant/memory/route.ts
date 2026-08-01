import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/session";
import {
  addUserMemory,
  deleteUserMemory,
  getUserMemories,
  isSensitiveMemoryFact,
  learnFromUserMessage,
  sanitizeMemoryFact
} from "@/src/lib/chatbot/memory-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "برای استفاده از حافظه وارد حساب شوید." }, { status: 401 });
  return NextResponse.json({ ok: true, items: await getUserMemories(session.id) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "برای استفاده از حافظه وارد حساب شوید." }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { fact?: unknown };
  const fact = sanitizeMemoryFact(body.fact);
  if (!fact) return NextResponse.json({ error: "متن حافظه خالی است." }, { status: 400 });
  if (isSensitiveMemoryFact(fact)) {
    return NextResponse.json({ error: "رمز، توکن، کلید و اطلاعات پرداخت در حافظه ذخیره نمی‌شوند." }, { status: 400 });
  }
  const item = await addUserMemory(session.id, fact);
  return NextResponse.json({ ok: true, item }, { status: 201 });
}

export async function PUT(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ ok: true, learned: 0 });
  const body = await request.json().catch(() => ({})) as { message?: unknown };
  const message = sanitizeMemoryFact(body.message);
  if (!message || isSensitiveMemoryFact(message)) return NextResponse.json({ ok: true, learned: 0 });
  const learned = await learnFromUserMessage(session.id, message);
  return NextResponse.json({ ok: true, learned: learned.length });
}

export async function DELETE(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "برای استفاده از حافظه وارد حساب شوید." }, { status: 401 });
  const id = request.nextUrl.searchParams.get("id")?.trim() || undefined;
  const deleted = await deleteUserMemory(session.id, id);
  return NextResponse.json({ ok: true, deleted });
}
