// stripe-connect-link — creates a Stripe Connect Express onboarding link
// for the calling creator. Called from CreatorPayoutsCard.
//
// Required env vars (set with `supabase secrets set`):
//   STRIPE_SECRET_KEY     — sk_test_... or sk_live_...
//   APP_URL               — e.g. https://reelone.app (fallback for return URL)
//
// The function:
//   1. Authenticates the caller via the JWT.
//   2. Looks up `creator_stripe_accounts` row; creates the Stripe account
//      if none exists; persists the Stripe account id.
//   3. Creates an Account Link with onboarding intent and returns its URL.
//
// We deliberately keep the function self-contained (one file, no shared lib)
// so it deploys cleanly with `supabase functions deploy stripe-connect-link`.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const STRIPE_API = 'https://api.stripe.com/v1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface ConnectLinkBody {
  return_url?: string
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method not allowed' }, 405)
  }

  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')
  if (!stripeKey) return jsonResponse({ error: 'STRIPE_SECRET_KEY not configured' }, 500)
  const appUrl = Deno.env.get('APP_URL') || 'http://localhost:5889'

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const auth = req.headers.get('Authorization')
  if (!auth) return jsonResponse({ error: 'missing authorization' }, 401)

  // User-scoped client for identity check.
  const userClient = createClient(supabaseUrl, anon, { global: { headers: { Authorization: auth } } })
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return jsonResponse({ error: 'invalid token' }, 401)

  // Service-role client for writes that bypass RLS.
  const admin = createClient(supabaseUrl, serviceKey)

  let body: ConnectLinkBody = {}
  try { body = await req.json() } catch { /* default empty */ }

  // 1. Find or create the Stripe account record.
  const { data: existing } = await admin
    .from('creator_stripe_accounts')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()

  let accountId: string | undefined = existing?.stripe_account_id
  if (!accountId) {
    const accountRes = await stripeFetch(stripeKey, '/accounts', new URLSearchParams({
      type: 'express',
      'capabilities[transfers][requested]': 'true',
      'metadata[user_id]': user.id,
      email: user.email ?? '',
    }))
    if (!accountRes.ok) {
      const text = await accountRes.text()
      return jsonResponse({ error: `stripe account create failed: ${text}` }, 502)
    }
    const acc = await accountRes.json()
    accountId = acc.id as string

    await admin.from('creator_stripe_accounts').upsert({
      user_id: user.id,
      stripe_account_id: accountId,
      charges_enabled: false,
      payouts_enabled: false,
      updated_at: new Date().toISOString(),
    })
  }

  // 2. Create an account link.
  const linkRes = await stripeFetch(stripeKey, '/account_links', new URLSearchParams({
    account: accountId!,
    refresh_url: body.return_url || `${appUrl}/dashboard`,
    return_url: body.return_url || `${appUrl}/dashboard`,
    type: 'account_onboarding',
  }))
  if (!linkRes.ok) {
    const text = await linkRes.text()
    return jsonResponse({ error: `stripe account link failed: ${text}` }, 502)
  }
  const link = await linkRes.json()
  return jsonResponse({ url: link.url })
})

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
}

function stripeFetch(key: string, path: string, params: URLSearchParams): Promise<Response> {
  return fetch(`${STRIPE_API}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  })
}
