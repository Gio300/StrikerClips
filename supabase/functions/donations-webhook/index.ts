// donations-webhook — Stripe webhook receiver. Marks donations as paid /
// failed and updates `creator_stripe_accounts` charges_enabled / payouts
// flags when an account.updated event fires.
//
// Configure the Stripe webhook endpoint to point at:
//   https://<project-ref>.supabase.co/functions/v1/donations-webhook
//
// Required secrets:
//   STRIPE_SECRET_KEY
//   STRIPE_WEBHOOK_SECRET
//
// Notable: we verify the Stripe signature manually (Web Crypto). We don't
// pull in the heavy stripe SDK because Deno cold-starts get expensive.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'stripe-signature, content-type',
  'Access-Control-Allow-Methods': 'POST',
}

serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 })

  const sig = req.headers.get('stripe-signature')
  const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET')
  if (!sig || !secret) {
    return new Response('missing signature or secret', { status: 400 })
  }

  const body = await req.text()
  const verified = await verifyStripeSig(body, sig, secret)
  if (!verified) return new Response('signature verification failed', { status: 400 })

  let event: { type: string; data: { object: Record<string, unknown> } }
  try {
    event = JSON.parse(body)
  } catch {
    return new Response('invalid json', { status: 400 })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(supabaseUrl, serviceKey)

  switch (event.type) {
    case 'checkout.session.completed':
    case 'payment_intent.succeeded': {
      const obj = event.data.object as Record<string, unknown>
      const piId = (obj.payment_intent as string | undefined) ?? (obj.id as string | undefined)
      const chargeId = (obj.latest_charge as string | undefined) ?? null
      if (piId) {
        await admin
          .from('donations')
          .update({
            status: 'paid',
            paid_at: new Date().toISOString(),
            stripe_charge_id: chargeId,
          })
          .eq('stripe_payment_intent_id', piId)
      }
      break
    }
    case 'payment_intent.payment_failed':
    case 'checkout.session.expired': {
      const obj = event.data.object as Record<string, unknown>
      const piId = (obj.payment_intent as string | undefined) ?? (obj.id as string | undefined)
      if (piId) {
        await admin
          .from('donations')
          .update({ status: 'failed' })
          .eq('stripe_payment_intent_id', piId)
      }
      break
    }
    case 'account.updated': {
      const obj = event.data.object as Record<string, unknown>
      const accountId = obj.id as string
      const chargesEnabled = Boolean(obj.charges_enabled)
      const payoutsEnabled = Boolean(obj.payouts_enabled)
      const onboarded = chargesEnabled && payoutsEnabled
      await admin
        .from('creator_stripe_accounts')
        .update({
          charges_enabled: chargesEnabled,
          payouts_enabled: payoutsEnabled,
          onboarded_at: onboarded ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        })
        .eq('stripe_account_id', accountId)
      break
    }
    default:
      // Ignore other events; Stripe will retry if we 200.
      break
  }

  return new Response('ok', { status: 200, headers: corsHeaders })
})

/**
 * Verify a Stripe webhook signature using the v1 scheme (HMAC-SHA256 of
 * `${timestamp}.${payload}` against the endpoint secret). Returns true if
 * any of the included v1 signatures match.
 */
async function verifyStripeSig(payload: string, header: string, secret: string): Promise<boolean> {
  const parts = Object.fromEntries(
    header.split(',').map((kv) => kv.trim().split('=')),
  ) as Record<string, string>
  const timestamp = parts.t
  const sigs = header.split(',').filter((kv) => kv.startsWith('v1=')).map((kv) => kv.slice(3))
  if (!timestamp || sigs.length === 0) return false

  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const macBuf = await crypto.subtle.sign('HMAC', key, enc.encode(`${timestamp}.${payload}`))
  const mac = bufToHex(new Uint8Array(macBuf))
  return sigs.some((s) => safeEq(s, mac))
}

function bufToHex(buf: Uint8Array): string {
  return Array.from(buf).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function safeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}
