import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = getSupabaseAdmin();
    const { data, error } = await db
      .from("conversations")
      .select("id,subject,status,last_message_at,customers(id,name,email,notes),messages(id,direction,text_body,subject,status,created_at,from_email)")
      .order("last_message_at", { ascending: false });
    if (error) throw error;
    return NextResponse.json(
      { conversations: data ?? [] },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } },
    );
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "تعذر تحميل المحادثات" }, { status: 500 });
  }
}

