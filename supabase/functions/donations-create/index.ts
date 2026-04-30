// donations-create — creates a Stripe Checkout Session for a tip and
// inserts a `donations` row in 'pending' status with the resulting
// payment_intent id so the webhook can later mark it paid.
//
// Body:
//   {
//     creator_id: string,
//     amount_cents: number,
//     message?: string | null,
//     success_url: string,
//     cancel_url: string,
//   }
//
// Returns:
//   { url: string }   // Stripe Checkout URL to redirect the donor to
//
// We use Checkout (not direct PaymentIntents) because it's the cheapest path
// to a hosted UI that handles cards, Apple Pay, etc. with zero PCI scope.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const STRIPE_API = 'https://api.stripe.com/v1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface CreateBody {
  creator_id: string
  amount_cents: number
  message?: string | null
  success_url: string
  cancel_url: string
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'method not allowed' }, 405)

  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')
  if (!stripeKey) return jsonResponse({ error: 'STRIPE_SECRET_KEY not configured' }, 500)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  // Application fee in basis points (e.g. 500 = 5%). Default 5%.
  const feeBps = parseInt(Deno.env.get('PLATFORM_FEE_BPS') || '500', 10)

  const auth = req.headers.get('Authorization')
  if (!auth) return jsonResponse({ error: 'missing authorization' }, 401)
  const userClient = createClient(supabaseUrl, anon, { global: { headers: { Authorization: auth } } })
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return jsonResponse({ error: 'invalid token' }, 401)

  const admin = createClient(supabaseUrl, serviceKey)

  let body: CreateBody
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'invalid json' }, 400)
  }
  if (!body.creator_id || !body.amount_cents || body.amount_cents < 100) {
    return jsonResponse({ error: 'creator_id + amount_cents (>= 100) required' }, 400)
  }
  if (body.creator_id === user.id) {
    return jsonResponse({ error: 'cannot tip yourself' }, 400)
  }

  // Look up the creator's Stripe account so we can apply the destination charge.
  const { data: account } = await admin
    .from('creator_stripe_accounts')
    .select('stripe_account_id, charges_enabled')
    .eq('user_id', body.creator_id)
    .maybeSingle()

  if (!account?.stripe_account_id || !account.charges_enabled) {
    return jsonResponse({
      error: 'Creator has not finished Stripe onboarding yet. Try again later.',
    }, 400)
  }

  // Insert pending donation row first so we have an id to attach as metadata.
  const { data: donation, error: insertErr } = await admin
    .from('donations')
    .insert({
      donor_id: user.id,
      creator_id: body.creator_id,
      amount_cents: body.amount_cents,
      message: body.message ?? null,
      status: 'pending',
    })
    .select()
    .single()

  if (insertErr || !donation) {
    return jsonResponse({ error: insertErr?.message ?? 'donation insert failed' }, 500)
  }

  const applicationFee = Math.floor((body.amount_cents * feeBps) / 10_000)

  const params = new URLSearchParams()
  params.append('mode', 'payment')
  params.append('success_url', body.success_url)
  params.append('cancel_url', body.cancel_url)
  params.append('payment_intent_data[application_fee_amount]', String(applicationFee))
  params.append('payment_intent_data[transfer_data][destination]', account.stripe_account_id)
  params.append('payment_intent_data[metadata][donation_id]', donation.id)
  params.append('payment_intent_data[metadata][donor_id]', user.id)
  params.append('payment_intent_data[metadata][creator_id]', body.creator_id)
  params.append('line_items[0][price_data][currency]', 'usd')
  params.append('line_items[0][price_data][unit_amount]', String(body.amount_cents))
  params.append('line_items[0][price_data][product_data][name]', `Tip from @${user.email?.split('@')[0] ?? 'fan'}`)
  params.append('line_items[0][quantity]', '1')

  const res = await fetch(`${STRIPE_API}/checkout/sessions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${stripeKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  })
  if (!res.ok) {
    const text = await res.text()
    await admin.from('donations').update({ status: 'failed' }).eq('id', donation.id)
    return jsonResponse({ error: `stripe error: ${text}` }, 502)
  }
  const session = await res.json()

  // Persist the PaymentIntent id so the webhook can update the row later.
  await admin
    .from('donations')
    .update({ stripe_payment_intent_id: session.payment_intent })
    .eq('id', donation.id)

  return jsonResponse({ url: session.url })
})

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
}
