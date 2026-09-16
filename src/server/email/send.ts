import { ConfigurationError, runtime } from "../runtime";

export type EmailContent = { to: string; subject: string; text: string; html: string };
type Copy = { id: string; en: string };
export type EmailTemplate = { subject: string; heading: Copy; body: Copy; action: Copy; url: string; footnote: Copy };

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);

export function renderEmail(template: EmailTemplate): { subject: string; text: string; html: string } {
  const { heading, body, action, url, footnote } = template;
  const text = [heading.id, "", body.id, "", `${action.id}: ${url}`, "", footnote.id, "", "---", "", heading.en, "", body.en, "", `${action.en}: ${url}`, "", footnote.en].join("\n");
  const block = (copy: Copy, lang: "id" | "en") => `<div lang="${lang}" style="margin:0 0 28px"><h1 style="margin:0 0 12px;font-size:20px;font-weight:600;color:#1f201d">${escapeHtml(heading[lang])}</h1><p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#44463f">${escapeHtml(copy[lang])}</p><a href="${escapeHtml(url)}" style="display:inline-block;padding:11px 20px;border-radius:8px;background:#5d7350;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none">${escapeHtml(action[lang])}</a><p style="margin:16px 0 0;font-size:12px;line-height:1.5;color:#74776e">${escapeHtml(footnote[lang])}</p></div>`;
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#faf9f6;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif"><div style="max-width:520px;margin:0 auto;padding:28px;border:1px solid #e8e9e1;border-top:4px solid #5d7350;border-radius:12px;background:#ffffff">${block(body, "id")}<hr style="border:0;border-top:1px solid #e8e9e1;margin:0 0 28px">${block(body, "en")}<p style="margin:0;font-size:12px;color:#74776e;word-break:break-all">${escapeHtml(url)}</p></div></body></html>`;
  return { subject: template.subject, text, html };
}

export async function sendEmail({ to, subject, text, html }: EmailContent): Promise<void> {
  const { EMAIL, EMAIL_FROM } = runtime();
  if (!EMAIL || !EMAIL_FROM || EMAIL_FROM.includes("REPLACE_WITH")) throw new ConfigurationError("EMAIL binding or EMAIL_FROM is not configured.");
  await EMAIL.send({ from: EMAIL_FROM, to, subject, text, html });
}
