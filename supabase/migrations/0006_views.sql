-- Read models for the admin UI (RLS applies through security_invoker) and the future shop.

create view public.v_stock with (security_invoker = true) as
select
  v.id as variant_id,
  v.product_id,
  p.name as product_name,
  v.label,
  public.variant_name(p.name, v.label) as name,
  v.sku,
  v.photo_path,
  v.physical_qty,
  v.reserved_qty,
  v.available_qty,
  v.avg_cost,
  v.cost_known,
  (v.available_qty <= s.low_stock_threshold) as is_low,
  v.archived,
  v.created_at,
  coalesce((
    select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name) order by o.name)
    from public.offer_items oi join public.offers o on o.id = oi.offer_id
    where oi.variant_id = v.id and not o.archived), '[]'::jsonb) as offers
from public.variants v
join public.products p on p.id = v.product_id
cross join public.settings s;

-- Cheapest active unit price of a reference (used to show the value of a trio).
create or replace function public.min_unit_price(p_variant uuid) returns int
language sql stable
set search_path = public, pg_temp
as $$
  select min(coalesce(oi.price_cents, o.price_cents))
  from public.offer_items oi join public.offers o on o.id = oi.offer_id
  where oi.variant_id = p_variant and o.kind = 'unit' and not o.archived
$$;

create view public.v_offers with (security_invoker = true) as
select
  o.id,
  o.name,
  o.kind,
  o.price_cents,
  o.photo_path,
  o.on_instagram,
  o.on_site,
  o.allow_repeat,
  o.archived,
  o.created_at,
  o.updated_at,
  coalesce(jsonb_agg(jsonb_build_object(
      'variant_id', v.id, 'sku', v.sku, 'name', public.variant_name(p.name, v.label),
      'product_name', p.name, 'label', v.label, 'photo_path', v.photo_path,
      'qty', oi.qty, 'price_cents', oi.price_cents, 'available_qty', v.available_qty
    ) order by p.name, v.label) filter (where v.id is not null), '[]'::jsonb) as items,
  case o.kind
    when 'unit' then coalesce(sum(v.available_qty), 0)::int
    when 'fixed_trio' then coalesce(min(v.available_qty / oi.qty), 0)::int
    else (count(*) filter (where v.available_qty > 0))::int
  end as sellable,
  case when o.kind = 'fixed_trio' and bool_and(public.min_unit_price(v.id) is not null)
    then sum(oi.qty * public.min_unit_price(v.id))::int
  end as unit_sum_cents
from public.offers o
left join public.offer_items oi on oi.offer_id = o.id
left join public.variants v on v.id = oi.variant_id
left join public.products p on p.id = v.product_id
group by o.id;

create view public.v_orders with (security_invoker = true) as
select
  o.*,
  t.items_total_cents,
  t.items_total_cents + o.shipping_fee_cents as total_cents,
  public.order_expected_cents(o.id) as expected_cents,
  po.payout_id,
  pay.reference as payout_reference,
  pay.received_on as payout_received_on,
  po.received_cents,
  po.received_cents - po.expected_cents as gap_cents,
  coalesce((
    select jsonb_agg(jsonb_build_object(
        'id', l.id, 'position', l.position, 'offer_id', l.offer_id, 'offer_name', l.offer_name,
        'offer_kind', l.offer_kind, 'unit_price_cents', l.unit_price_cents, 'qty', l.qty) order by l.position)
    from public.order_lines l where l.order_id = o.id), '[]'::jsonb) as lines,
  coalesce((
    select jsonb_agg(jsonb_build_object(
        'id', i.id, 'line_id', i.line_id, 'variant_id', i.variant_id, 'sku', i.sku, 'name', i.name,
        'qty', i.qty, 'picked', i.picked, 'photo_path', var.photo_path, 'unit_cost', i.unit_cost,
        'returned_resalable', i.returned_resalable, 'returned_damaged', i.returned_damaged) order by i.sku)
    from public.order_items i join public.variants var on var.id = i.variant_id
    where i.order_id = o.id), '[]'::jsonb) as items
from public.orders o
cross join lateral (
  select coalesce(sum(l.unit_price_cents * l.qty), 0)::int as items_total_cents
  from public.order_lines l where l.order_id = o.id
) t
left join public.payout_orders po on po.order_id = o.id
left join public.payouts pay on pay.id = po.payout_id;

create view public.v_payouts with (security_invoker = true) as
select
  p.id,
  p.carrier,
  p.received_on,
  p.reference,
  p.amount_received_cents,
  p.created_at,
  coalesce(sum(po.expected_cents), 0)::int as expected_cents,
  (p.amount_received_cents - coalesce(sum(po.expected_cents), 0))::int as gap_cents,
  count(po.order_id)::int as order_count
from public.payouts p
left join public.payout_orders po on po.payout_id = p.id
group by p.id;

create view public.v_receipts with (security_invoker = true) as
select
  r.id,
  r.supplier,
  r.received_on,
  r.created_at,
  coalesce(jsonb_agg(jsonb_build_object(
      'variant_id', l.variant_id, 'sku', v.sku, 'name', public.variant_name(p.name, v.label),
      'qty', l.qty, 'unit_cost_cents', l.unit_cost_cents) order by v.sku), '[]'::jsonb) as lines,
  coalesce(sum(l.qty * l.unit_cost_cents), 0)::int as total_cents
from public.receipts r
left join public.receipt_lines l on l.receipt_id = r.id
left join public.variants v on v.id = l.variant_id
left join public.products p on p.id = v.product_id
group by r.id;

-- Future shop: active site offers only, availability capped so exact stock is not exposed.
create view public.shop_catalog as
select
  o.id,
  o.name,
  o.kind,
  o.price_cents,
  o.photo_path,
  o.allow_repeat,
  jsonb_agg(jsonb_build_object(
      'variant_id', v.id, 'sku', v.sku, 'name', public.variant_name(p.name, v.label),
      'photo_path', v.photo_path, 'qty', oi.qty, 'price_cents', oi.price_cents,
      'available_qty', least(v.available_qty, 10)) order by p.name, v.label) as items,
  least(case o.kind
    when 'unit' then sum(v.available_qty)
    when 'fixed_trio' then min(v.available_qty / oi.qty)
    else count(*) filter (where v.available_qty > 0)
  end, 10)::int as sellable
from public.offers o
join public.offer_items oi on oi.offer_id = o.id
join public.variants v on v.id = oi.variant_id and not v.archived
join public.products p on p.id = v.product_id
where o.on_site and not o.archived
group by o.id;

revoke all on public.v_stock, public.v_offers, public.v_orders, public.v_payouts, public.v_receipts from anon;
grant select on public.v_stock, public.v_offers, public.v_orders, public.v_payouts, public.v_receipts to authenticated;
revoke all on public.shop_catalog from anon, authenticated;
grant select on public.shop_catalog to service_role;
