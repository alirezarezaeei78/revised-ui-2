import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/session";
import {
  deleteVerifiedDatasheet,
  listVerifiedDatasheets,
  upsertVerifiedDatasheet
} from "@/src/lib/catalog/datasheet-repository";

async function adminSession() {
  const session = await getCurrentSession();
  return session?.role === "admin" ? session : null;
}

export async function GET(request: NextRequest) {
  if (!await adminSession()) return NextResponse.json({ error: "دسترسی فقط برای مدیر مجاز است." }, { status: 403 });
  return NextResponse.json({ items: await listVerifiedDatasheets(request.nextUrl.searchParams.get("q") || "") });
}

export async function POST(request: NextRequest) {
  if (!await adminSession()) return NextResponse.json({ error: "دسترسی فقط برای مدیر مجاز است." }, { status: 403 });
  try {
    const body = await request.json();
    return NextResponse.json({ ok: true, item: await upsertVerifiedDatasheet(body) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "ثبت دیتاشیت ناموفق بود." }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  if (!await adminSession()) return NextResponse.json({ error: "دسترسی فقط برای مدیر مجاز است." }, { status: 403 });
  const partNumber = request.nextUrl.searchParams.get("partNumber") || "";
  if (!partNumber.trim()) return NextResponse.json({ error: "Part Number لازم است." }, { status: 400 });
  return NextResponse.json({ ok: true, deleted: await deleteVerifiedDatasheet(partNumber) });
}
