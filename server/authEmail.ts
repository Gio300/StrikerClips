import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2'
import { randomBytes } from 'node:crypto'

export interface PasswordResetEmail {
  to: string
  resetUrl: string
  brandName: string
}

export interface RosterInviteEmail {
  to: string
  inviteUrl: string
  brandName: string
  clanName: string
  rosterName: string
  inviterName: string
  expiresAt: string
}

export interface TransactionalEmail {
  to: string
  brandName: string
  subject: string
  text: string
  html: string
}

function cleanBrand(value: string): string {
  return String(value || 'TKO').replace(/[\r\n<>]/g, '').trim().slice(0, 80) || 'TKO'
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function cleanHeader(value: string, label: string): string {
  const cleaned = String(value || '').trim()
  if (!cleaned || /[\r\n]/.test(cleaned)) throw new Error(`${label} is invalid`)
  return cleaned
}

function gmailConfig(): { clientId: string; clientSecret: string; refreshToken: string } | null {
  const clientId = String(process.env.GMAIL_CLIENT_ID || '').trim()
  const clientSecret = String(process.env.GMAIL_CLIENT_SECRET || '').trim()
  const refreshToken = String(process.env.GMAIL_REFRESH_TOKEN || '').trim()
  const present = [clientId, clientSecret, refreshToken].filter(Boolean).length
  if (present === 0) return null
  if (present !== 3) {
    throw new Error('Gmail sender is only partially configured')
  }
  return { clientId, clientSecret, refreshToken }
}

function mailBodies(message: PasswordResetEmail, brand: string): { text: string; html: string } {
  const resetUrl = String(message.resetUrl).replace(/[\r\n]/g, '')
  return {
    text: `A password reset was requested for your ${brand} account.\n\n${resetUrl}\n\nThis link expires in 20 minutes and works once. If you did not request it, you can ignore this email.`,
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#171717">
      <h1 style="font-size:24px">Reset your ${escapeHtml(brand)} password</h1>
      <p>A password reset was requested for your ${escapeHtml(brand)} account.</p>
      <p><a href="${escapeHtml(resetUrl)}" style="display:inline-block;background:#e44720;color:#fff;padding:12px 18px;text-decoration:none;border-radius:6px;font-weight:700">Choose a new password</a></p>
      <p style="color:#666;font-size:13px">This link expires in 20 minutes and works once. If you did not request it, you can ignore this email.</p>
    </div>`,
  }
}

function gmailRawMessage(message: TransactionalEmail, from: string, brand: string): string {
  const to = cleanHeader(message.to, 'email recipient')
  const sender = cleanHeader(from, 'AUTH_EMAIL_FROM')
  const subject = cleanHeader(message.subject, 'email subject')
  const boundary = `tko_${randomBytes(12).toString('hex')}`
  const raw = [
    `To: ${to}`,
    `From: ${brand} <${sender}>`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    message.text,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    message.html,
    '',
    `--${boundary}--`,
    '',
  ].join('\r\n')
  return Buffer.from(raw, 'utf8').toString('base64url')
}

async function sendWithGmail(
  message: TransactionalEmail,
  from: string,
  brand: string,
  config: NonNullable<ReturnType<typeof gmailConfig>>,
): Promise<void> {
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  const tokenBody = await tokenResponse.json().catch(() => ({})) as {
    access_token?: string
    error_description?: string
  }
  if (!tokenResponse.ok || !tokenBody.access_token) {
    throw new Error(`Gmail OAuth refresh failed (HTTP ${tokenResponse.status})`)
  }

  const sendResponse = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${tokenBody.access_token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ raw: gmailRawMessage(message, from, brand) }),
  })
  if (!sendResponse.ok) {
    throw new Error(`Gmail send failed (HTTP ${sendResponse.status})`)
  }
}

export async function sendPasswordResetEmail(message: PasswordResetEmail): Promise<void> {
  const brand = cleanBrand(message.brandName)
  const bodies = mailBodies(message, brand)
  await sendTransactionalEmail({
    to: message.to,
    brandName: brand,
    subject: `Reset your ${brand} password`,
    text: bodies.text,
    html: bodies.html,
  })
}

export async function sendRosterInviteEmail(message: RosterInviteEmail): Promise<void> {
  const brand = cleanBrand(message.brandName)
  const clan = cleanBrand(message.clanName)
  const roster = cleanBrand(message.rosterName)
  const inviter = cleanBrand(message.inviterName)
  const inviteUrl = String(message.inviteUrl || '').replace(/[\r\n]/g, '')
  const expires = new Date(message.expiresAt)
  const expiresLabel = Number.isFinite(expires.getTime())
    ? expires.toLocaleString('en-US', { timeZone: 'UTC', timeZoneName: 'short' })
    : 'in seven days'
  await sendTransactionalEmail({
    to: message.to,
    brandName: brand,
    subject: `${inviter} invited you to ${clan}`,
    text: `${inviter} invited you to join the ${roster} competition roster for ${clan}.\n\n${inviteUrl}\n\nThis invitation expires ${expiresLabel}.`,
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#171717">
      <h1 style="font-size:24px">Join ${escapeHtml(roster)}</h1>
      <p><strong>${escapeHtml(inviter)}</strong> invited you to the ${escapeHtml(clan)} competition roster.</p>
      <p><a href="${escapeHtml(inviteUrl)}" style="display:inline-block;background:#e44720;color:#fff;padding:12px 18px;text-decoration:none;border-radius:6px;font-weight:700">Review invitation</a></p>
      <p style="color:#666;font-size:13px">This invitation expires ${escapeHtml(expiresLabel)}. The invitation only works for this email address.</p>
    </div>`,
  })
}

export async function sendTransactionalEmail(message: TransactionalEmail): Promise<void> {
  const from = String(process.env.AUTH_EMAIL_FROM || 'gio@tensorverse.ai').trim()
  if (!from) throw new Error('AUTH_EMAIL_FROM is not configured')

  const brand = cleanBrand(message.brandName)
  const gmail = gmailConfig()
  if (gmail) {
    await sendWithGmail(message, from, brand, gmail)
    return
  }

  const client = new SESv2Client({
    region: process.env.AUTH_EMAIL_REGION || process.env.AWS_REGION || 'us-east-1',
  })

  await client.send(new SendEmailCommand({
    FromEmailAddress: `${brand} <${from}>`,
    Destination: { ToAddresses: [message.to] },
    Content: {
      Simple: {
        Subject: { Data: cleanHeader(message.subject, 'email subject'), Charset: 'UTF-8' },
        Body: {
          Text: {
            Charset: 'UTF-8',
            Data: message.text,
          },
          Html: {
            Charset: 'UTF-8',
            Data: message.html,
          },
        },
      },
    },
  }))
}
