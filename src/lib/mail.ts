import { createTransport } from "nodemailer";

export function smtpConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST);
}

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<boolean> {
  const host = process.env.SMTP_HOST;
  if (!host) return false;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER || "";
  const pass = process.env.SMTP_PASS || "";
  const from = process.env.SMTP_FROM || user || "noreply@localhost";
  const secure = process.env.SMTP_SECURE === "1" || port === 465;
  const transporter = createTransport({
    host,
    port,
    secure,
    auth: user ? { user, pass } : undefined,
  });
  await transporter.sendMail({
    from,
    to,
    subject: "비밀번호 재설정",
    text: `비밀번호를 바꾸려면 이 링크를 여세요. 1시간만 유효합니다.\n\n${resetUrl}\n`,
  });
  return true;
}
