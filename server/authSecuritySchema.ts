import type { Pool } from 'pg'

export const AUTH_SECURITY_STATEMENTS = [
  {
    name: 'password reset tokens',
    sql: `create table if not exists public.password_reset_tokens (
      token_hash text primary key,
      user_id uuid not null references public.users(id) on delete cascade,
      expires_at timestamptz not null,
      used_at timestamptz,
      created_at timestamptz not null default now()
    )`,
  },
  {
    name: 'password reset lookup index',
    sql: `create index if not exists password_reset_tokens_user_created_idx
      on public.password_reset_tokens(user_id, created_at desc)`,
  },
  {
    name: 'session transfer tokens',
    sql: `create table if not exists public.auth_transfer_tokens (
      token_hash text primary key,
      user_id uuid not null references public.users(id) on delete cascade,
      target_origin text not null,
      return_path text not null default '/',
      expires_at timestamptz not null,
      used_at timestamptz,
      created_at timestamptz not null default now()
    )`,
  },
  {
    name: 'session transfer expiry index',
    sql: `create index if not exists auth_transfer_tokens_expiry_idx
      on public.auth_transfer_tokens(expires_at)`,
  },
] as const

export async function applyAuthSecuritySchema(pool: Pick<Pool, 'query'>): Promise<void> {
  for (const statement of AUTH_SECURITY_STATEMENTS) {
    await pool.query(statement.sql)
  }
}
