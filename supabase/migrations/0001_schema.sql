-- Sparkle back-office: tables.
-- Amounts are integer cents (MAD). Average and frozen unit costs are numeric cents.

create schema if not exists extensions;
create extension if not exists unaccent with schema extensions;

create or replace function public.norm_key(p text) returns text
language sql immutable parallel safe
set search_path = ''
as $$
  select lower(regexp_replace(trim(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(p, ''))), '\s+', ' ', 'g'))
$$;

create or replace function public.format_order_number(n bigint) returns text
language sql immutable parallel safe
as $$
  select 'SPK-' || lpad(n::text, greatest(4, length(n::text)), '0')
$$;

create type public.offer_kind as enum ('unit', 'fixed_trio', 'custom_trio');
create type public.order_channel as enum ('instagram', 'site');
create type public.order_status as enum (
  'brouillon', 'confirmee', 'preparee', 'en_livraison', 'livree', 'payee',
  'retour_attendu', 'retour_recu', 'annulee'
);
create type public.movement_kind as enum (
  'arrivage', 'reservation', 'liberation', 'expedition',
  'retour_revendable', 'retour_perte', 'correction', 'import'
);

create table public.settings (
  id boolean primary key default true check (id),
  low_stock_threshold int not null default 5 check (low_stock_threshold >= 0),
  packaging_cost_cents int check (packaging_cost_cents >= 0),
  default_shipping_fee_cents int check (default_shipping_fee_cents >= 0),
  carriers text[] not null default '{}',
  updated_at timestamptz not null default now()
);
insert into public.settings default values;

create table public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);

create table public.request_log (
  request_id uuid primary key,
  fn text not null,
  result jsonb,
  created_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now()
);
create unique index products_name_key on public.products (public.norm_key(name));

create table public.variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id),
  sku text not null check (sku ~ '^[A-Z0-9][A-Z0-9-]*$'),
  label text,
  label_key text generated always as (public.norm_key(coalesce(label, ''))) stored,
  photo_path text,
  physical_qty int not null default 0,
  reserved_qty int not null default 0,
  available_qty int generated always as (physical_qty - reserved_qty) stored,
  avg_cost numeric(12, 4) not null default 0 check (avg_cost >= 0),
  cost_known boolean not null default true,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  constraint variants_quantities check (reserved_qty >= 0 and reserved_qty <= physical_qty),
  constraint variants_product_label unique (product_id, label_key)
);
create unique index variants_sku_key on public.variants (sku);
create index variants_product on public.variants (product_id);

create table public.receipts (
  id uuid primary key default gen_random_uuid(),
  supplier text not null check (length(trim(supplier)) > 0),
  received_on date not null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create table public.receipt_lines (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.receipts (id) on delete cascade,
  variant_id uuid not null references public.variants (id),
  qty int not null check (qty > 0),
  unit_cost_cents int not null check (unit_cost_cents >= 0)
);
create index receipt_lines_variant on public.receipt_lines (variant_id);

create table public.offers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  kind public.offer_kind not null,
  price_cents int not null check (price_cents >= 0),
  photo_path text,
  on_instagram boolean not null default true,
  on_site boolean not null default false,
  allow_repeat boolean not null default false,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.offer_items (
  offer_id uuid not null references public.offers (id) on delete cascade,
  variant_id uuid not null references public.variants (id),
  qty int not null default 1 check (qty > 0),
  price_cents int check (price_cents >= 0),
  primary key (offer_id, variant_id)
);
create index offer_items_variant on public.offer_items (variant_id);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null unique,
  instagram text,
  city text not null default '',
  address text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create sequence public.order_number_seq;

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  number text not null unique default public.format_order_number(nextval('public.order_number_seq')),
  channel public.order_channel not null default 'instagram',
  status public.order_status not null default 'brouillon',
  customer_id uuid references public.customers (id),
  customer_name text not null default '',
  customer_phone text not null default '',
  customer_instagram text,
  customer_city text not null default '',
  customer_address text not null default '',
  payment_method text not null default 'cod' check (payment_method in ('cod', 'prepaid')),
  shipping_fee_cents int not null default 0 check (shipping_fee_cents >= 0),
  carrier text,
  tracking text,
  transport_cost_cents int check (transport_cost_cents >= 0),
  packaging_cost_cents int check (packaging_cost_cents >= 0),
  return_fee_cents int check (return_fee_cents >= 0),
  confirmed_at timestamptz,
  prepared_at timestamptz,
  shipped_at timestamptz,
  delivered_at timestamptz,
  paid_at timestamptz,
  return_reported_at timestamptz,
  return_received_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index orders_status on public.orders (status);
create index orders_customer on public.orders (customer_id);

create table public.order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  position int not null,
  offer_id uuid references public.offers (id) on delete set null,
  offer_name text not null,
  offer_kind public.offer_kind not null,
  unit_price_cents int not null check (unit_price_cents >= 0),
  qty int not null check (qty > 0)
);
create index order_lines_order on public.order_lines (order_id);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  line_id uuid not null references public.order_lines (id) on delete cascade,
  variant_id uuid not null references public.variants (id),
  sku text not null,
  name text not null,
  qty int not null check (qty > 0),
  picked boolean not null default false,
  unit_cost numeric(12, 4),
  returned_resalable int,
  returned_damaged int
);
create index order_items_order on public.order_items (order_id);
create index order_items_variant on public.order_items (variant_id);

create table public.order_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders (id) on delete cascade,
  from_status public.order_status,
  to_status public.order_status not null,
  note text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index order_events_order on public.order_events (order_id);

create table public.stock_movements (
  id bigint generated always as identity primary key,
  variant_id uuid not null references public.variants (id),
  kind public.movement_kind not null,
  physical_delta int not null default 0,
  reserved_delta int not null default 0,
  unit_cost numeric(12, 4),
  order_id uuid references public.orders (id) on delete set null,
  receipt_id uuid references public.receipts (id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index stock_movements_variant on public.stock_movements (variant_id);

create table public.payouts (
  id uuid primary key default gen_random_uuid(),
  carrier text not null check (length(trim(carrier)) > 0),
  received_on date not null,
  reference text not null default '',
  amount_received_cents int not null,
  created_at timestamptz not null default now()
);

create table public.payout_orders (
  payout_id uuid not null references public.payouts (id) on delete cascade,
  order_id uuid not null unique references public.orders (id),
  expected_cents int not null,
  received_cents int not null,
  primary key (payout_id, order_id)
);

create table public.ad_spend (
  month date primary key check (extract(day from month) = 1),
  amount_cents int not null check (amount_cents >= 0),
  note text,
  updated_at timestamptz not null default now()
);
