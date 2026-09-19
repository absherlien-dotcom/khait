import { Resend } from "resend";

export function getResend() {
  if (!process.env.RESEND_API_KEY) throw new Error("Resend is not configured");
  return new Resend(process.env.RESEND_API_KEY);
}

export const inboundDomain = process.env.RESEND_INBOUND_DOMAIN || "eoosteucor.resend.app";
export const fromEmail = process.env.RESEND_FROM_EMAIL || "Khait <onboarding@resend.dev>";

