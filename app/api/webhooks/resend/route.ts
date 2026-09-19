import { NextRequest, NextResponse } from "next/server";
import { getResend, inboundDomain } from "@/lib/resend";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

function headerValue(headers: unknown, name: string) {
  if (!headers || typeof headers !== "object") return null;
  const entries = Object.entries(headers as Record<string, unknown>);
  const value = entries.find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
  return typeof value === "string" ? value : null;
}

function cleanReply(text: string | null | undefined) {
  if (!text) return null;
  return text
    .split(/\r?\n(?=(?:On [\s\S]+wrote:|في [\s\S]+ كتب:|[-_]{2,}\s*(?:Original Message|الرسالة الأصلية)))/i)[0]
    .split(/\r?\n\s*>/)[0]
    .trim();
}

export async function POST(request: NextRequest) {
  const raw = await request.text();
  try {
    const secret = process.env.RESEND_WEBHOOK_SECRET;
    if (!secret) return NextResponse.json({ error: "Webhook secret is missing" }, { status: 503 });
    const event = getResend().webhooks.verify({
      payload: raw,
      headers: {
        id: request.headers.get("svix-id") || "",
        timestamp: request.headers.get("svix-timestamp") || "",
        signature: request.headers.get("svix-signature") || "",
      },
      webhookSecret: secret,
    }) as { type: string; data: { email_id?: string } };
    if (event.type !== "email.received" || !event.data.email_id) return NextResponse.json({ ok: true });

    const received = await getResend().emails.receiving.get(event.data.email_id);
    if (received.error || !received.data) throw new Error(received.error?.message || "Email body unavailable");
    const email = received.data;
    const from = String(email.from || "").match(/<([^>]+)>/)?.[1] || String(email.from || "");
    const recipients = Array.isArray(email.to) ? email.to : [email.to];
    const token = recipients.join(" ").match(new RegExp(`reply\\+([0-9a-f-]+)@${inboundDomain.replaceAll(".", "\\.")}`, "i"))?.[1];
    const db = getSupabaseAdmin();
    const { data: company } = await db.from("companies").select("id").eq("slug", "khait-demo").single();
    if (!company) throw new Error("Demo company is missing");

    let conversationId: string | undefined;
    if (token) {
      const found = await db.from("conversations").select("id").eq("thread_token", token).maybeSingle();
      conversationId = found.data?.id;
    }
    if (!conversationId) {
      let { data: customer } = await db.from("customers").select("id").eq("company_id", company.id).eq("email", from.toLowerCase()).maybeSingle();
      if (!customer) {
        const created = await db.from("customers").insert({ company_id: company.id, email: from.toLowerCase(), name: String(email.from || from).replace(/<.*>/, "").trim() || from }).select("id").single();
        if (created.error) throw created.error;
        customer = created.data;
      }
      const created = await db.from("conversations").insert({ company_id: company.id, customer_id: customer.id, subject: email.subject || "(بدون موضوع)" }).select("id").single();
      if (created.error) throw created.error;
      conversationId = created.data.id;
    }
    const messageId = headerValue(email.headers, "message-id");
    const inReplyTo = headerValue(email.headers, "in-reply-to");
    const inserted = await db.from("messages").insert({
      company_id: company.id, conversation_id: conversationId, direction: "inbound", sender_type: "customer",
      from_email: from.toLowerCase(), to_emails: recipients, cc_emails: email.cc || [], subject: email.subject || null,
      text_body: cleanReply(email.text), html_body: email.html || null, provider_message_id: event.data.email_id,
      internet_message_id: messageId, in_reply_to: inReplyTo,
      attachments: email.attachments || [], status: "received"
    });
    if (inserted.error && inserted.error.code !== "23505") throw inserted.error;
    await db.from("conversations").update({ last_message_at: new Date().toISOString() }).eq("id", conversationId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Resend webhook failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Webhook failed" }, { status: 400 });
  }
}
