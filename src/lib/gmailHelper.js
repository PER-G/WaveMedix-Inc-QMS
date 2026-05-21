// ═══ Gmail Notification Helper ═══
// Sends approval-workflow notifications using the signed-in user's Gmail
// (via the gmail.send scope). Only used when Adobe Sign is NOT configured —
// when Adobe Sign is active, Adobe Sign handles all transactional emails.

import { google } from "googleapis";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://wave-medix-inc-qms.vercel.app";
const APP_NAME = "WAVEMEDIX QMS";

function getGmailClient(accessToken) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.gmail({ version: "v1", auth });
}

// Encode a string in base64url (Gmail API requires this for `raw`)
function b64url(str) {
  return Buffer.from(str, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// Build a raw RFC-822 MIME message
function buildMime({ to, from, subject, html, text }) {
  const boundary = `=_NextPart_${Date.now()}`;
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ].join("\r\n");

  const body = [
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 7bit",
    "",
    text,
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: 7bit",
    "",
    html,
    "",
    `--${boundary}--`,
  ].join("\r\n");

  return `${headers}\r\n\r\n${body}`;
}

export async function sendEmail(accessToken, { from, to, subject, html, text }) {
  if (!accessToken) throw new Error("Gmail send requires accessToken");
  if (!to) throw new Error("Gmail send requires `to`");
  const gmail = getGmailClient(accessToken);
  const raw = b64url(buildMime({ to, from, subject, html, text: text || stripHtml(html) }));
  const res = await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw },
  });
  return res.data;
}

function stripHtml(s) {
  return (s || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

// ───── Template renderer ─────
function shell(title, bodyHtml) {
  return `<!doctype html>
<html><body style="margin:0;padding:0;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;background:#f4f8fc;color:#0F2B3C;">
  <div style="max-width:560px;margin:0 auto;padding:24px;">
    <div style="background:#0F2B3C;color:#fff;padding:14px 18px;border-radius:8px 8px 0 0;display:flex;align-items:center;gap:10px;">
      <div style="display:inline-block;background:#10B981;width:32px;height:32px;border-radius:6px;text-align:center;line-height:32px;font-size:18px;">&#9889;</div>
      <div>
        <div style="font-weight:700;font-size:14px;letter-spacing:0.5px;">${APP_NAME}</div>
        <div style="font-size:11px;color:#86efac;">Quality Management System</div>
      </div>
    </div>
    <div style="background:#fff;border:1px solid #e2e8f0;border-top:none;padding:22px 22px 18px;border-radius:0 0 8px 8px;">
      <h2 style="margin:0 0 12px;font-size:16px;color:#0F2B3C;">${title}</h2>
      ${bodyHtml}
    </div>
    <div style="font-size:11px;color:#94a3b8;text-align:center;margin-top:14px;line-height:1.6;">
      This is an automated notification from the Wavemedix QMS.<br>
      Open the app: <a href="${APP_URL}" style="color:#028090;">${APP_URL}</a>
    </div>
  </div>
</body></html>`;
}

function button(href, label) {
  return `<div style="margin:14px 0;"><a href="${href}" style="display:inline-block;background:#028090;color:#fff;padding:9px 18px;border-radius:6px;font-size:13px;font-weight:600;text-decoration:none;">${label}</a></div>`;
}

function meta(rows) {
  const trs = rows
    .filter(([, v]) => v)
    .map(([k, v]) => `<tr><td style="padding:4px 10px 4px 0;color:#64748b;font-size:12px;vertical-align:top;width:120px;">${k}</td><td style="padding:4px 0;color:#0F2B3C;font-size:12px;">${v}</td></tr>`)
    .join("");
  return `<table cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 6px;">${trs}</table>`;
}

// ───── High-level notification helpers ─────

export function tmplPendingSignature({ docName, role, authorName, submittedAt, version }) {
  return {
    subject: `[Action required] Please sign — ${docName}`,
    html: shell(
      `Your signature is required`,
      `<p style="font-size:13px;line-height:1.55;color:#334155;margin:0 0 8px;">
        Hi, a document is waiting for your <strong>${role}</strong> signature in the Wavemedix QMS.
      </p>
      ${meta([
        ["Document", docName],
        ["Your role", role],
        ["Submitted by", authorName],
        ["Submitted at", submittedAt],
        ["Version", version],
      ])}
      ${button(`${APP_URL}/?tab=approvals`, "Open in QMS App")}
      <p style="font-size:11px;color:#94a3b8;margin:12px 0 0;">Signatures use SHA-256 document hashing for audit-trail integrity (ISO 13485 §4.2.5, FDA 21 CFR Part 11).</p>`
    ),
  };
}

export function tmplCompleted({ docName, version }) {
  return {
    subject: `[Approved] ${docName} fully signed`,
    html: shell(
      `Document fully approved`,
      `<p style="font-size:13px;line-height:1.55;color:#334155;margin:0 0 6px;">
        All three signatories have approved the document. It is now released as a controlled QMS record.
      </p>
      ${meta([["Document", docName], ["Version", version], ["Status", "<span style='color:#059669;font-weight:600;'>APPROVED</span>"]])}
      ${button(`${APP_URL}/?tab=approvals`, "View in QMS App")}`
    ),
  };
}

export function tmplRejected({ docName, rejectorName, reason }) {
  return {
    subject: `[Rejected] ${docName}`,
    html: shell(
      `Approval request rejected`,
      `<p style="font-size:13px;line-height:1.55;color:#334155;margin:0 0 6px;">
        Your approval request for <strong>${docName}</strong> was rejected.
      </p>
      ${meta([["Rejected by", rejectorName], ["Reason", reason || "(no reason given)"]])}
      ${button(`${APP_URL}/?tab=approvals`, "Open in QMS App")}`
    ),
  };
}

export function tmplAdobeStarted({ docName, authorName, version }) {
  return {
    subject: `[Adobe Sign] Signing in progress — ${docName}`,
    html: shell(
      `Adobe Sign workflow started`,
      `<p style="font-size:13px;line-height:1.55;color:#334155;margin:0 0 6px;">
        An Adobe Sign agreement was created. The first signer will receive an email
        from <strong>Adobe Sign</strong> shortly to sign the document. After each
        signature, the next signer is automatically notified by Adobe.
      </p>
      ${meta([["Document", docName], ["Submitted by", authorName], ["Version", version]])}
      ${button(`${APP_URL}/?tab=approvals`, "Track status in QMS App")}`
    ),
  };
}

export function tmplCompletedSigned({ docName, signedFileLink }) {
  return {
    subject: `[Signed PDF] ${docName} — ready for archive`,
    html: shell(
      `Signed PDF available`,
      `<p style="font-size:13px;line-height:1.55;color:#334155;margin:0 0 6px;">
        All signatures have been collected. The signed PDF is ready in Google Drive.
      </p>
      ${signedFileLink ? button(signedFileLink, "Open signed PDF in Drive") : ""}
      ${button(`${APP_URL}/?tab=approvals`, "View in QMS App")}`
    ),
  };
}
