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
    let conversationSubject = String(body.subject || "محادثة جديدة");
    if (conversationId) {
      const { data: conversation } = await db.from("conversations").select("thread_token,subject").eq("id", conversationId).single();
      threadToken = conversation?.thread_token || "";
      conversationSubject = conversation?.subject || conversationSubject;
    } else {
      let { data: customer } = await db.from("customers").select("id").eq("company_id", company.id).eq("email", to).maybeSingle();
      if (!customer) {
        const created = await db.from("customers").insert({ company_id: company.id, email: to, name: body.name || to.split("@")[0], notes: body.customerCompany || null }).select("id").single();
        if (created.error) throw created.error;
        customer = created.data;
      }
      const existing = await db.from("conversations").select("id,thread_token,subject").eq("company_id", company.id).eq("customer_id", customer.id).neq("status", "closed").order("last_message_at", { ascending: false }).limit(1).maybeSingle();
      if (existing.data) {
        conversationId = existing.data.id;
        threadToken = existing.data.thread_token;
        conversationSubject = existing.data.subject;
      } else {
        const created = await db.from("conversations").insert({ company_id: company.id, customer_id: customer.id, subject: conversationSubject }).select("id,thread_token").single();
        if (created.error) throw created.error;
        conversationId = created.data.id;
        threadToken = created.data.thread_token;
      }
    }

    const replyTo = `reply+${threadToken}@${inboundDomain}`;
    const lastInbound = await db.from("messages").select("internet_message_id").eq("conversation_id", conversationId).eq("direction", "inbound").not("internet_message_id", "is", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
    const referenceId = lastInbound.data?.internet_message_id || undefined;
    const subject = body.conversationId && !/^re:/i.test(conversationSubject) ? `Re: ${conversationSubject}` : conversationSubject;
    const sent = await getResend().emails.send({
      from: fromEmail, to, subject, text, replyTo,
      headers: referenceId ? { "In-Reply-To": referenceId, References: referenceId } : undefined,
    });
    if (sent.error) throw new Error(sent.error.message);
    const saved = await db.from("messages").insert({
      company_id: company.id, conversation_id: conversationId, direction: "outbound", sender_type: "employee",
      from_email: fromEmail, to_emails: [to], subject, text_body: text,
      provider_message_id: sent.data?.id || null, in_reply_to: referenceId || null, status: "sent"
    }).select("id").single();
    if (saved.error) throw saved.error;
    await db.from("conversations").update({ last_message_at: new Date().toISOString() }).eq("id", conversationId);
    return NextResponse.json({ ok: true, conversationId, messageId: saved.data.id, providerId: sent.data?.id });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "تعذر إرسال البريد" }, { status: 500 });
  }
}
