/**
 * SmashHub mass announcement script
 *
 * Sends an email to all users with profiles via Gmail SMTP.
 *
 * Setup:
 * 1. Create a Gmail account for SmashHub
 * 2. Enable 2FA, create an App Password: https://support.google.com/accounts/answer/185833
 * 3. Set env vars: GMAIL_USER, GMAIL_APP_PASSWORD, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Usage:
 *   npx tsx scripts/send-announcement.ts "Your announcement message here"
 *   npm run send-announcement -- "Your announcement message here"
 */

import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'

const message = process.argv[2]
if (!message) {
  console.error('Usage: npx tsx scripts/send-announcement.ts "Your message here"')
  process.exit(1)
}

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const gmailUser = process.env.GMAIL_USER
const gmailAppPassword = process.env.GMAIL_APP_PASSWORD

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}
if (!gmailUser || !gmailAppPassword) {
  console.error('Missing GMAIL_USER or GMAIL_APP_PASSWORD (use Gmail App Password, not regular password)')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false }
})

async function main() {
  const { data: { users }, error } = await supabase.auth.admin.listUsers({ perPage: 1000 })
  if (error) {
    console.error('Failed to fetch users:', error.message)
    process.exit(1)
  }
  const emails = (users ?? []).map((u) => u.email).filter((e): e is string => !!e)
  if (emails.length === 0) {
    console.log('No users with emails found.')
    process.exit(0)
  }

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
      user: gmailUser,
      pass: gmailAppPassword
    }
  })

  const subject = process.env.ANNOUNCEMENT_SUBJECT ?? 'SmashHub Announcement'
  const from = process.env.GMAIL_FROM ?? `SmashHub <${gmailUser}>`

  const results = await transporter.sendMail({
    from,
    to: emails,
    subject,
    text: message,
    html: `<pre style="font-family:sans-serif;white-space:pre-wrap">${escapeHtml(message)}</pre>`
  })

  console.log(`Sent to ${emails.length} recipients. MessageId: ${results.messageId}`)
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
