import nodemailer from 'nodemailer';
import { config } from '../config/env.js';
import { logger } from '../config/logger.js';

/**
 * Transactional email. With SMTP configured, mail is delivered through it.
 * Without SMTP, messages are rendered but not delivered. In development/tests the message
 * (including its link) is logged and kept in an in-memory outbox for tests; in production
 * only the fact of non-delivery is logged, because the links are bearer secrets.
 * Flows that depend on email (invitations) also expose the link to the inviter in the UI,
 * so the product stays usable without SMTP — nothing pretends to have been delivered.
 */
const transport = config.mail.smtp
  ? nodemailer.createTransport(config.mail.smtp)
  : nodemailer.createTransport({ jsonTransport: true });

const OUTBOX_LIMIT = 50;
export const outbox = [];

export function isEmailDeliveryConfigured() {
  return Boolean(config.mail.smtp);
}

const escapeHtml = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

function layout({ heading, body, ctaLabel, ctaUrl, footer }) {
  return `<!doctype html><html><body style="margin:0;background:#f4f5fb;font-family:Inter,Segoe UI,Arial,sans-serif;color:#0f172a">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
  <table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border-radius:16px;padding:32px">
    <tr><td style="font-size:18px;font-weight:700;color:#4f46e5">SocialHub</td></tr>
    <tr><td style="padding-top:20px;font-size:22px;font-weight:700">${escapeHtml(heading)}</td></tr>
    <tr><td style="padding-top:12px;font-size:15px;line-height:1.6;color:#334155">${body}</td></tr>
    <tr><td style="padding-top:24px"><a href="${escapeHtml(ctaUrl)}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px">${escapeHtml(ctaLabel)}</a></td></tr>
    <tr><td style="padding-top:24px;font-size:12px;line-height:1.6;color:#64748b">${escapeHtml(footer)}<br>If the button does not work, open: ${escapeHtml(ctaUrl)}</td></tr>
  </table></td></tr></table></body></html>`;
}

export async function sendMail({ to, subject, text, html, meta = {} }) {
  const info = await transport.sendMail({ from: config.mail.from, to, subject, text, html });
  const delivered = isEmailDeliveryConfigured();
  if (!delivered) {
    if (config.isProduction) {
      // Links in these emails are bearer secrets (password reset, invitations): never log
      // or retain them in production.
      logger.warn({ to, subject, kind: meta.kind }, 'Email not delivered: SMTP is not configured');
    } else {
      outbox.push({ to, subject, text, html, meta, at: new Date() });
      if (outbox.length > OUTBOX_LIMIT) outbox.shift();
      logger.info(
        { to, subject, ...meta },
        'Email not delivered (SMTP not configured); link logged for development',
      );
    }
  }
  return { delivered, messageId: info.messageId };
}

export function sendInvitationEmail({ to, workspaceName, inviterName, roleLabel, url, expiresAt }) {
  const heading = `Join ${workspaceName} on SocialHub`;
  const text = `${inviterName} invited you to join "${workspaceName}" as ${roleLabel}.\n\nAccept the invitation: ${url}\n\nThis link expires on ${expiresAt.toUTCString()}.`;
  return sendMail({
    to,
    subject: `${inviterName} invited you to ${workspaceName}`,
    text,
    html: layout({
      heading,
      body: `<strong>${escapeHtml(inviterName)}</strong> invited you to join <strong>${escapeHtml(workspaceName)}</strong> as <strong>${escapeHtml(roleLabel)}</strong>.`,
      ctaLabel: 'Accept invitation',
      ctaUrl: url,
      footer: `This invitation expires on ${expiresAt.toUTCString()}. If you were not expecting it, you can ignore this email.`,
    }),
    meta: { kind: 'invitation', url },
  });
}

export function sendPasswordResetEmail({ to, name, url, ttlMinutes }) {
  const text = `Hi ${name},\n\nReset your SocialHub password: ${url}\n\nThis link expires in ${ttlMinutes} minutes. If you did not request it, ignore this email.`;
  return sendMail({
    to,
    subject: 'Reset your SocialHub password',
    text,
    html: layout({
      heading: 'Reset your password',
      body: `Hi ${escapeHtml(name)}, we received a request to reset your SocialHub password.`,
      ctaLabel: 'Choose a new password',
      ctaUrl: url,
      footer: `This link expires in ${ttlMinutes} minutes and can be used once. If you did not request a reset, no action is needed.`,
    }),
    meta: { kind: 'password_reset', url },
  });
}
