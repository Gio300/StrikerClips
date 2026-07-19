// redeem-code — a signed-in user redeems a comp/promo code to get a full (Pro)
// month with no charge. Runs with the service role so codes stay server-side
// and grants are tamper-proof.
//
// Body:   { code: string }
// Returns { ok: true, tier: string, expires_at: string }  on success
//         { error: string }                                on failure
//
// Grant model: sets user_metadata.reelone_tier + reelone_tier_expires. The
// frontend `useEntitlements` hook respects the expiry (see 013 migration notes).

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const auth = req.headers.get('Authorization')
  if (!auth) return json({ error: 'sign in to redeem a code' }, 401)
  const userClient = createClient(supabaseUrl, anon, { global: { headers: { Authorization: auth } } })
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return json({ error: 'invalid session' }, 401)

  let body: { code?: string }
  try { body = await req.json() } catch { return json({ error: 'invalid json' }, 400) }
  const code = (body.code ?? '').trim().toUpperCase()
  if (!code) return json({ error: 'enter a code' }, 400)

  const admin = createClient(supabaseUrl, serviceKey)

  const { data: rc } = await admin
    .from('redeem_codes')
    .select('code, tier, months, max_uses, uses, active, expires_at')
    .eq('code', code)
    .maybeSingle()

  if (!rc || !rc.active) return json({ error: 'that code is not valid' }, 404)
  if (rc.expires_at && new Date(rc.expires_at) < new Date()) return json({ error: 'that code has expired' }, 410)
  if (rc.uses >= rc.max_uses) return json({ error: 'that code has already been used' }, 409)

  // Already redeemed by this user?
  const { data: prior } = await admin
    .from('code_redemptions')
    .select('id')
    .eq('code', code)
    .eq('user_id', user.id)
    .maybeSingle()
  if (prior) return json({ error: 'you already redeemed this code' }, 409)

  // Compute grant expiry: extend from the later of (now, current expiry).
  const md = (user.user_metadata ?? {}) as Record<string, unknown>
  const currentExpiryRaw = typeof md.reelone_tier_expires === 'string' ? md.reelone_tier_expires : null
  const base = currentExpiryRaw && new Date(currentExpiryRaw) > new Date() ? new Date(currentExpiryRaw) : new Date()
  const expires = new Date(base)
  expires.setMonth(expires.getMonth() + (rc.months ?? 1))

  // Grant the tier.
  const { error: updErr } = await admin.auth.admin.updateUserById(user.id, {
    user_metadata: { ...md, reelone_tier: rc.tier, reelone_tier_expires: expires.toISOString() },
  })
  if (updErr) return json({ error: 'could not apply grant, try again' }, 500)

  // Record redemption + bump uses (best-effort; grant already applied).
  await admin.from('code_redemptions').insert({
    code, user_id: user.id, tier_granted: rc.tier, grant_expires_at: expires.toISOString(),
  })
  await admin.from('redeem_codes').update({ uses: rc.uses + 1 }).eq('code', code)

  return json({ ok: true, tier: rc.tier, expires_at: expires.toISOString() })
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
}
