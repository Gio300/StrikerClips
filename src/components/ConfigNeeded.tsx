/**
 * Shown instead of a blank white page when Supabase config is missing.
 * This is the graceful-failure half of the white-screen fix: a deploy with no
 * Supabase keys now renders actionable instructions rather than nothing.
 */
export default function ConfigNeeded() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0a0a0f',
        color: '#e5e7eb',
        fontFamily: 'system-ui, sans-serif',
        padding: '24px',
      }}
    >
      <div style={{ maxWidth: 560, lineHeight: 1.55 }}>
        <div style={{ fontSize: 13, letterSpacing: 2, color: '#f43f5e', fontWeight: 700 }}>KILLCAM</div>
        <h1 style={{ fontSize: 24, margin: '8px 0 12px' }}>Configuration required</h1>
        <p style={{ color: '#9ca3af', marginBottom: 16 }}>
          The app loaded, but Supabase is not configured for this deployment yet, so it can’t sign
          you in or load data. Set these two values and reload:
        </p>
        <ul style={{ color: '#cbd5e1', fontSize: 14, marginBottom: 16 }}>
          <li><code>SUPABASE_URL</code> — your Supabase project URL (https://…supabase.co)</li>
          <li><code>SUPABASE_ANON_KEY</code> — the project’s public anon key</li>
        </ul>
        <p style={{ color: '#6b7280', fontSize: 13 }}>
          On Cloud Run these are container env vars (injected at startup into
          <code> /runtime-config.js</code>). Locally, put <code>VITE_SUPABASE_URL</code> and
          <code> VITE_SUPABASE_ANON_KEY</code> in <code>.env.local</code>. No rebuild is needed on
          Cloud Run — the anon key is read at runtime.
        </p>
      </div>
    </div>
  )
}
