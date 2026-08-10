import { afterEach, describe, expect, it, vi } from 'vitest'

import { sendPasswordResetEmail } from './authEmail'

const ENV_KEYS = ['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN', 'AUTH_EMAIL_FROM'] as const
const original = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))

afterEach(() => {
  vi.unstubAllGlobals()
  for (const key of ENV_KEYS) {
    const value = original[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('password reset email delivery', () => {
  it('uses the Gmail send-only refresh token without exposing it in the message', async () => {
    process.env.GMAIL_CLIENT_ID = 'client-id'
    process.env.GMAIL_CLIENT_SECRET = 'client-secret'
    process.env.GMAIL_REFRESH_TOKEN = 'refresh-secret'
    process.env.AUTH_EMAIL_FROM = 'sender@example.com'

    const requests: Array<{ url: string; init: RequestInit }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      requests.push({ url, init })
      if (String(url).includes('oauth2.googleapis.com')) {
        return new Response(JSON.stringify({ access_token: 'short-lived-access' }), { status: 200 })
      }
      return new Response(JSON.stringify({ id: 'sent-message' }), { status: 200 })
    }))

    await sendPasswordResetEmail({
      to: 'player@example.com',
      resetUrl: 'https://shinobistrikerleague.com/reset-password?token=one-time-code',
      brandName: 'Shinobi Striker League',
    })

    expect(requests.map((request) => request.url)).toEqual([
      'https://oauth2.googleapis.com/token',
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
    ])
    expect(String(requests[0].init.body)).toContain('refresh_token=refresh-secret')
    expect(String(requests[1].init.headers)).not.toContain('refresh-secret')
    const payload = JSON.parse(String(requests[1].init.body)) as { raw: string }
    const raw = Buffer.from(payload.raw, 'base64url').toString('utf8')
    expect(raw).toContain('Reset your Shinobi Striker League password')
    expect(raw).toContain('one-time-code')
    expect(raw).not.toContain('refresh-secret')
  })

  it('fails closed when only part of the Gmail credential is configured', async () => {
    process.env.GMAIL_CLIENT_ID = 'client-id'
    delete process.env.GMAIL_CLIENT_SECRET
    delete process.env.GMAIL_REFRESH_TOKEN

    await expect(sendPasswordResetEmail({
      to: 'player@example.com',
      resetUrl: 'https://tko.cam/reset-password?token=x',
      brandName: 'TKO',
    })).rejects.toThrow('partially configured')
  })
})
