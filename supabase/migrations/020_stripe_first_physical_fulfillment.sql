-- TKO forged artifact -> physical merchandise, Stripe-first.
--
-- TKO owns the AI-assisted creator experience, checkout, order state, payout
-- ledger and provider orchestration. Shopify receives a mirrored draft product
-- and an externally-paid order after Stripe confirms payment. The print
-- provider receives a DRAFT order until a separate safety release.

create table if not exists public.physical_merch_products (
  id uuid primary key default uuid_generate_v4(),
  artifact_id uuid not null references public.artifacts(id) on delete restrict,
  seller_user_id uuid not null references public.profiles(id) on delete restrict,
  seller_type text not null default 'creator' check (seller_type in ('creator','clan')),
  clan_id uuid references public.servers(id) on delete set null,
  title text not null,
  description text not null default '',
  product_type text not null default 'tshirt' check (product_type in ('tshirt')),
  artwork_url text not null,
  ai_brief jsonb not null default '{}',
  print_specs jsonb not null default '{}',
  status text not null default 'pending_review'
    check (status in ('draft','pending_review','approved','active','paused','rejected','error')),
  shopify_shop_domain text,
  shopify_product_gid text unique,
  fulfillment_provider text not null default 'printful',
  provider_template_id text,
  sale_price_cents integer not null check (sale_price_cents between 2500 and 15000),
  manufacturing_cents integer not null default 1200 check (manufacturing_cents >= 0),
  shipping_cents integer not null default 499 check (shipping_cents >= 0),
  payment_fee_cents integer not null default 150 check (payment_fee_cents >= 0),
  refund_reserve_cents integer not null default 200 check (refund_reserve_cents >= 0),
  creator_share_percent integer not null default 50 check (creator_share_percent between 0 and 100),
  last_error text,
  ip_attested_at timestamptz not null,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (artifact_id, product_type)
);
create index if not exists physical_merch_products_seller_idx
  on public.physical_merch_products(seller_user_id, status, created_at desc);

create table if not exists public.physical_merch_variants (
  id uuid primary key default uuid_generate_v4(),
  physical_product_id uuid not null references public.physical_merch_products(id) on delete cascade,
  size text not null check (size in ('S','M','L','XL','2XL')),
  color text not null default 'Black',
  sku text not null unique,
  shopify_variant_gid text unique,
  provider_variant_id text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (physical_product_id, size, color)
);

create table if not exists public.physical_merch_orders (
  id uuid primary key default uuid_generate_v4(),
  buyer_id uuid not null references public.profiles(id) on delete restrict,
  status text not null default 'checkout_pending'
    check (status in (
      'checkout_pending','paid','shopify_pending','provider_draft',
      'fulfillment_held','submitted','in_production','shipped','delivered',
      'cancelled','refunded','failed'
    )),
  currency text not null default 'usd',
  item_subtotal_cents integer not null check (item_subtotal_cents >= 0),
  shipping_charge_cents integer not null default 0 check (shipping_charge_cents >= 0),
  tax_cents integer not null default 0 check (tax_cents >= 0),
  total_cents integer not null check (total_cents >= 0),
  refunded_cents integer not null default 0 check (refunded_cents >= 0),
  shipping_name text,
  shipping_email text,
  shipping_address jsonb not null default '{}',
  stripe_customer_id text,
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text unique,
  stripe_charge_id text,
  shopify_order_gid text unique,
  shopify_order_name text,
  provider text not null default 'printful',
  provider_order_id text unique,
  provider_status text,
  provider_cost_cents integer,
  provider_confirmed_at timestamptz,
  tracking_company text,
  tracking_number text,
  tracking_url text,
  idempotency_key text not null unique,
  dry_run boolean not null default false,
  hold_reason text,
  last_error text,
  paid_at timestamptz,
  shipped_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  refunded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists physical_merch_orders_buyer_idx
  on public.physical_merch_orders(buyer_id, created_at desc);
create index if not exists physical_merch_orders_status_idx
  on public.physical_merch_orders(status, updated_at);

create table if not exists public.physical_merch_order_items (
  id uuid primary key default uuid_generate_v4(),
  order_id uuid not null references public.physical_merch_orders(id) on delete cascade,
  physical_product_id uuid not null references public.physical_merch_products(id) on delete restrict,
  variant_id uuid not null references public.physical_merch_variants(id) on delete restrict,
  seller_user_id uuid not null references public.profiles(id) on delete restrict,
  quantity integer not null default 1 check (quantity between 1 and 10),
  unit_price_cents integer not null check (unit_price_cents >= 0),
  manufacturing_cents integer not null default 0 check (manufacturing_cents >= 0),
  provider_shipping_cents integer not null default 0 check (provider_shipping_cents >= 0),
  payment_fee_cents integer not null default 0 check (payment_fee_cents >= 0),
  refund_reserve_cents integer not null default 0 check (refund_reserve_cents >= 0),
  creator_share_percent integer not null check (creator_share_percent between 0 and 100),
  creator_share_cents integer not null default 0 check (creator_share_cents >= 0),
  platform_share_cents integer not null default 0 check (platform_share_cents >= 0),
  shopify_line_item_gid text unique,
  created_at timestamptz not null default now(),
  unique (order_id, variant_id)
);

create table if not exists public.physical_merch_events (
  id uuid primary key default uuid_generate_v4(),
  provider text not null,
  topic text not null,
  provider_event_id text not null,
  order_id uuid references public.physical_merch_orders(id) on delete set null,
  payload jsonb not null default '{}',
  status text not null default 'pending' check (status in ('pending','processing','processed','failed')),
  attempts integer not null default 0,
  next_attempt_at timestamptz,
  locked_at timestamptz,
  processed_at timestamptz,
  error text,
  received_at timestamptz not null default now(),
  unique (provider, provider_event_id)
);
create index if not exists physical_merch_events_pending_idx
  on public.physical_merch_events(status, next_attempt_at, received_at);

create table if not exists public.physical_merch_earnings (
  id uuid primary key default uuid_generate_v4(),
  order_item_id uuid not null unique references public.physical_merch_order_items(id) on delete restrict,
  seller_user_id uuid not null references public.profiles(id) on delete restrict,
  amount_cents integer not null check (amount_cents >= 0),
  status text not null default 'held' check (status in ('held','available','transferred','reversed')),
  available_at timestamptz,
  stripe_transfer_id text unique,
  transferred_at timestamptz,
  reversed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists physical_merch_earnings_seller_idx
  on public.physical_merch_earnings(seller_user_id, status, available_at);

-- No broad RLS policy is intentional. Customer order, address, provider-cost
-- and creator-earning data is exposed only by authenticated trusted API routes.
alter table public.physical_merch_products enable row level security;
alter table public.physical_merch_variants enable row level security;
alter table public.physical_merch_orders enable row level security;
alter table public.physical_merch_order_items enable row level security;
alter table public.physical_merch_events enable row level security;
alter table public.physical_merch_earnings enable row level security;
