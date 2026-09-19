import { NextRequest, NextResponse } from "next/server";
import { getResend, fromEmail, inboundDomain } from "@/lib/resend";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const to = String(body.to || "").trim().toLowerCase();
    const text = String(body.text || "").trim();
    if (!to || !text) return NextResponse.json({ error: "البريد والرسالة مطلوبان" }, { status: 400 });

    const db = getSupabaseAdmin();
    const { data: company } = await db.from("companies").select("id").eq("slug", "khait-demo").single();
    if (!company) throw new Error("Demo company is missing");

    let conversationId = body.conversationId ? String(body.conversationId) : "";
    let threadToken = "";
    if (conversationId) {
      const { data: conversation } = await db.from("conversations").select("thread_token").eq("id", conversationId).single();
      threadToken = conversation?.thread_token || "";
    } else {
      let { data: customer } = await db.from("customers").select("id").eq("company_id", company.id).eq("email", to).maybeSingle();
      if (!customer) {
        const created = await db.from("customers").insert({ company_id: company.id, email: to, name: body.name || to.split("@")[0], notes: body.customerCompany || null }).select("id").single();
        if (created.error) throw created.error;
        customer = created.data;
      }
      const created = await db.from("conversations").insert({ company_id: company.id, customer_id: customer.id, subject: body.subject || "محادثة جديدة" }).select("id,thread_token").single();
      if (created.error) throw created.error;
      conversationId = created.data.id;
      threadToken = created.data.thread_token;
    }

    const replyTo = `reply+${threadToken}@${inboundDomain}`;
    const sent = await getResend().emails.send({ from: fromEmail, to, subject: body.subject || "رسالة من خيط", text, replyTo });
    if (sent.error) throw new Error(sent.error.message);
    const saved = await db.from("messages").insert({
      company_id: company.id, conversation_id: conversationId, direction: "outbound", sender_type: "employee",
      from_email: fromEmail, to_emails: [to], subject: body.subject || null, text_body: text,
      provider_message_id: sent.data?.id || null, status: "sent"
    }).select("id").single();
    if (saved.error) throw saved.error;
    await db.from("conversations").update({ last_message_at: new Date().toISOString() }).eq("id", conversationId);
    return NextResponse.json({ ok: true, conversationId, messageId: saved.data.id, providerId: sent.data?.id });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "تعذر إرسال البريد" }, { status: 500 });
  }
}

