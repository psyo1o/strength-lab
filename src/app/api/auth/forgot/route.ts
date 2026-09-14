import { NextResponse } from "next/server";
import { allowThrottle, appPublicUrl, FORGOT_GENERIC, requestPasswordReset } from "@/lib/auth";
import { sendPasswordResetEmail, smtpConfigured } from "@/lib/mail";
import { requestIp } from "@/lib/request-ip";

export const runtime = "nodejs";

const HOUR = 60 * 60 * 1000;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const email = String(body.email ?? "");
  const ip = requestIp(req);
  const allowed =
    allowThrottle(`forgot-email:${email.trim().toLowerCase()}`, 5, HOUR) &&
    allowThrottle(`forgot-ip:${ip}`, 15, HOUR);
  let resetUrl: string | undefined;
  if (allowed) {
    const { token } = requestPasswordReset(email);
    if (token) {
      const url = `${appPublicUrl()}/reset-password?token=${encodeURIComponent(token)}`;
      if (smtpConfigured()) {
        try {
          await sendPasswordResetEmail(email.trim().toLowerCase(), url);
        } catch {
          resetUrl = url;
        }
      } else {
        resetUrl = url;
      }
    }
  }
  return NextResponse.json({ ok: true, message: FORGOT_GENERIC, resetUrl });
}
