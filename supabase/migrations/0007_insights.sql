-- Global search, dashboard, backup export and prototype import.

create or replace function public.search_all(p_query text) returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  q text := trim(coalesce(p_query, ''));
  v_phone text := public.normalize_phone(p_query);
  v_like text;
  v_key text;
  v_handle text;
begin
  perform public.assert_admin();
  if length(q) < 2 then
    return jsonb_build_object('orders', '[]'::jsonb, 'variants', '[]'::jsonb, 'payouts', '[]'::jsonb);
  end if;
  v_like := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  v_key := '%' || public.norm_key(q) || '%';
  v_handle := '%' || ltrim(q, '@') || '%';

  return jsonb_build_object(
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', o.id, 'number', o.number, 'customer_name', o.customer_name,
          'status', o.status, 'channel', o.channel, 'created_at', o.created_at) order by o.created_at desc)
      from (
        select * from public.orders o
        where o.number ilike v_like
           or o.customer_name ilike v_like
           or o.customer_instagram ilike v_handle
           or (v_phone is not null and o.customer_phone = v_phone)
           or o.tracking ilike v_like
        order by o.created_at desc
        limit 8
      ) o), '[]'::jsonb),
    'variants', coalesce((
      select jsonb_agg(jsonb_build_object(
          'variant_id', x.id, 'sku', x.sku, 'name', x.name, 'photo_path', x.photo_path,
          'available_qty', x.available_qty) order by x.sku)
      from (
        select v.id, v.sku, public.variant_name(p.name, v.label) as name, v.photo_path, v.available_qty
        from public.variants v join public.products p on p.id = v.product_id
        where v.sku ilike v_like or public.norm_key(public.variant_name(p.name, v.label)) like v_key
        order by v.sku
        limit 8
      ) x), '[]'::jsonb),
    'payouts', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', p.id, 'reference', p.reference, 'carrier', p.carrier, 'received_on', p.received_on,
          'amount_received_cents', p.amount_received_cents) order by p.received_on desc)
      from (
        select * from public.payouts where reference ilike v_like order by received_on desc limit 8
      ) p), '[]'::jsonb)
  );
end $$;

-- Sales are counted on the delivery date, cash on the payout date, returns on the report date.
create or replace function public.dashboard(p_from date, p_to date, p_channel text default null) returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_settings public.settings;
  v_result jsonb;
begin
  perform public.assert_admin();
  if p_from is null or p_to is null or p_to < p_from then
    perform public._fail('VALEUR_INVALIDE', jsonb_build_object('field', 'period'));
  end if;
  if p_channel is not null and p_channel not in ('instagram', 'site') then
    perform public._fail('VALEUR_INVALIDE', jsonb_build_object('field', 'channel'));
  end if;
  select * into v_settings from public.settings;

  with
  ord as (
    select o.*,
      coalesce((select sum(l.unit_price_cents * l.qty) from public.order_lines l where l.order_id = o.id), 0)::bigint as items_total,
      coalesce((select sum(i.qty * coalesce(i.unit_cost, 0)) from public.order_items i where i.order_id = o.id), 0) as cogs,
      coalesce((select sum(coalesce(i.returned_damaged, 0) * coalesce(i.unit_cost, 0)) from public.order_items i where i.order_id = o.id), 0) as losses,
      coalesce(o.packaging_cost_cents, v_settings.packaging_cost_cents, 0) as packaging
    from public.orders o
    where p_channel is null or o.channel::text = p_channel
  ),
  delivered as (
    select * from ord
    where status in ('livree', 'payee')
      and (delivered_at at time zone 'Africa/Casablanca')::date between p_from and p_to
  ),
  returned as (
    select * from ord
    where status in ('retour_attendu', 'retour_recu')
      and (return_reported_at at time zone 'Africa/Casablanca')::date between p_from and p_to
  ),
  outstanding as (
    select * from ord o
    where status in ('livree', 'retour_attendu', 'retour_recu')
      and not exists (select 1 from public.payout_orders po where po.order_id = o.id)
  ),
  period_payouts as (
    select * from public.payouts where received_on between p_from and p_to
  ),
  period_payout_orders as (
    select po.* from public.payout_orders po
    join period_payouts p on p.id = po.payout_id
    join ord o on o.id = po.order_id
  ),
  months as (
    select m::date as m
    from generate_series(date_trunc('month', p_from), date_trunc('month', p_to), interval '1 month') m
  ),
  ads as (
    select months.m, a.amount_cents,
      (least(p_to, (months.m + interval '1 month - 1 day')::date) - greatest(p_from, months.m) + 1)::numeric
        / extract(day from (months.m + interval '1 month - 1 day'))::numeric as ratio
    from months left join public.ad_spend a on a.month = months.m
  ),
  figures as (
    select
      (select count(*) from delivered)::int as delivered_count,
      (select coalesce(sum(items_total), 0) from delivered)::bigint as items_revenue,
      (select coalesce(sum(shipping_fee_cents), 0) from delivered)::bigint as shipping_billed,
      (select coalesce(sum(cogs), 0) from delivered) as cogs,
      (select coalesce(sum(coalesce(transport_cost_cents, 0)), 0) from delivered)::bigint as transport,
      (select coalesce(sum(packaging), 0) from delivered)::bigint as packaging,
      (select count(*) from returned)::int as returns_count,
      (select coalesce(sum(coalesce(return_fee_cents, 0)), 0) from returned)::bigint as returns_fees,
      (select coalesce(sum(coalesce(transport_cost_cents, 0) + coalesce(return_fee_cents, 0) + packaging), 0) from returned)::bigint as return_costs,
      (select coalesce(sum(losses), 0) from returned) as losses,
      (select coalesce(sum(public.order_expected_cents(id)), 0) from outstanding)::bigint as expected_payouts,
      case when p_channel is null
        then (select coalesce(sum(amount_received_cents), 0) from period_payouts)
        else (select coalesce(sum(received_cents), 0) from period_payout_orders)
      end::bigint as cash_received,
      case when p_channel is null
        then (select coalesce(sum(p.amount_received_cents - coalesce(
                (select sum(po.expected_cents) from public.payout_orders po where po.payout_id = p.id), 0)), 0)
              from period_payouts p)
        else (select coalesce(sum(received_cents - expected_cents), 0) from period_payout_orders)
      end::bigint as gaps,
      (select coalesce(round(sum(coalesce(amount_cents, 0) * ratio)), 0) from ads)::bigint as ad_spend,
      (select count(*) from ads where amount_cents is null)::int as ad_months_missing,
      (select count(*) from (select id from delivered union all select id from returned) x
         join public.orders o on o.id = x.id where o.packaging_cost_cents is null)::int as packaging_missing,
      (select count(*) from public.variants where not cost_known)::int as cost_unknown
  )
  select jsonb_build_object(
    'delivered_count', f.delivered_count,
    'items_revenue_cents', f.items_revenue,
    'shipping_billed_cents', f.shipping_billed,
    'avg_basket_cents', case when f.delivered_count > 0 then round(f.items_revenue::numeric / f.delivered_count)::bigint end,
    'cash_received_cents', f.cash_received,
    'expected_payouts_cents', f.expected_payouts,
    'returns', jsonb_build_object(
      'count', f.returns_count,
      'rate', case when f.delivered_count + f.returns_count > 0
        then round(f.returns_count::numeric / (f.delivered_count + f.returns_count), 4) else 0 end,
      'fees_cents', f.returns_fees),
    'gaps_cents', f.gaps,
    'margin', jsonb_build_object(
      'items_revenue_cents', f.items_revenue,
      'shipping_billed_cents', f.shipping_billed,
      'cogs_cents', round(f.cogs)::bigint,
      'transport_cents', f.transport,
      'packaging_cents', f.packaging,
      'return_costs_cents', f.return_costs,
      'losses_cents', round(f.losses)::bigint,
      'ad_spend_cents', f.ad_spend,
      'estimated_cents', round(f.items_revenue + f.shipping_billed - f.cogs - f.transport - f.packaging
        - f.return_costs - f.losses - case when p_channel is null then f.ad_spend else 0 end)::bigint),
    'missing', (
      select coalesce(jsonb_agg(jsonb_build_object('code', code, 'count', n)), '[]'::jsonb)
      from (values
        ('packaging_unset', case when v_settings.packaging_cost_cents is null then f.packaging_missing else 0 end),
        ('ad_spend_missing', f.ad_months_missing),
        ('variant_cost_unknown', f.cost_unknown)
      ) as m(code, n)
      where n > 0),
    'low_stock', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'variant_id', v.id, 'sku', v.sku, 'name', public.variant_name(p.name, v.label),
          'available_qty', v.available_qty) order by v.available_qty, v.sku), '[]'::jsonb)
      from public.variants v join public.products p on p.id = v.product_id
      where not v.archived and v.available_qty <= v_settings.low_stock_threshold)
  ) into v_result
  from figures f;
  return v_result;
end $$;

create or replace function public.export_all() returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v jsonb := jsonb_build_object('version', 1, 'exported_at', now());
  v_part jsonb;
  t text;
begin
  perform public.assert_admin();
  v := v || jsonb_build_object('settings', (select to_jsonb(s) from public.settings s));
  foreach t in array array[
    'products', 'variants', 'receipts', 'receipt_lines', 'offers', 'offer_items', 'customers', 'orders',
    'order_lines', 'order_items', 'order_events', 'stock_movements', 'payouts', 'payout_orders', 'ad_spend'
  ] loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from public.%I x', t) into v_part;
    v := v || jsonb_build_object(t, v_part);
  end loop;
  return v;
end $$;

-- Imports the localStorage export of the HTML prototype: references, stock, arrivals, offers.
-- Orders are test data and are ignored; base64 photos are skipped (they belong in Storage).
create or replace function public.import_prototype(p_request_id uuid, p_data jsonb) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_prev jsonb;
  v_conflicts jsonb;
  v_rec jsonb;
  v_line jsonb;
  v_sku text;
  v_product uuid;
  v_variant uuid;
  v_receipt uuid;
  v_offer uuid;
  v_cost numeric;
  v_phys int;
  v_kind public.offer_kind;
  v_variants int := 0;
  v_receipts int := 0;
  v_offers int := 0;
  v_photos int := 0;
begin
  perform public.assert_admin();
  v_prev := public.begin_request(p_request_id, 'import_prototype');
  if v_prev is not null then
    return v_prev;
  end if;

  select jsonb_agg(distinct upper(trim(x ->> 'sku'))) into v_conflicts
  from jsonb_array_elements(coalesce(p_data -> 'variants', '[]'::jsonb)) x
  where exists (select 1 from public.variants v where v.sku = upper(trim(x ->> 'sku')));
  if v_conflicts is not null then
    perform public._fail('IMPORT_CONFLIT', jsonb_build_object('skus', v_conflicts));
  end if;

  for v_rec in select value from jsonb_array_elements(coalesce(p_data -> 'variants', '[]'::jsonb)) loop
    v_sku := upper(trim(coalesce(v_rec ->> 'sku', '')));
    if v_sku !~ '^[A-Z0-9][A-Z0-9-]*$' then
      perform public._fail('VALEUR_INVALIDE', jsonb_build_object('field', 'sku', 'sku', v_rec ->> 'sku'));
    end if;
    select id into v_product from public.products where public.norm_key(name) = public.norm_key(v_rec ->> 'model');
    if v_product is null then
      insert into public.products (name) values (trim(v_rec ->> 'model')) returning id into v_product;
    end if;
    select sum((l ->> 'qty')::numeric * (l ->> 'cost')::numeric) / nullif(sum((l ->> 'qty')::numeric), 0)
    into v_cost
    from jsonb_array_elements(coalesce(p_data -> 'receipts', '[]'::jsonb)) r,
         jsonb_array_elements(coalesce(r -> 'lines', '[]'::jsonb)) l
    where upper(l ->> 'sku') = v_sku;
    v_phys := greatest(coalesce((v_rec ->> 'physical')::int, 0), 0);
    insert into public.variants (product_id, sku, label, physical_qty, avg_cost, cost_known)
    values (v_product, v_sku, nullif(trim(coalesce(v_rec ->> 'variant', '')), ''), v_phys,
            coalesce(v_cost, 0), v_cost is not null)
    returning id into v_variant;
    if v_phys > 0 then
      insert into public.stock_movements (variant_id, kind, physical_delta, unit_cost, note)
      values (v_variant, 'import', v_phys, v_cost, 'Import du prototype');
    end if;
    if coalesce(v_rec ->> 'photo', '') <> '' then
      v_photos := v_photos + 1;
    end if;
    v_variants := v_variants + 1;
  end loop;

  for v_rec in select value from jsonb_array_elements(coalesce(p_data -> 'receipts', '[]'::jsonb)) loop
    insert into public.receipts (supplier, received_on)
    values (coalesce(nullif(trim(v_rec ->> 'supplier'), ''), 'Prototype'),
            coalesce(nullif(v_rec ->> 'received', '')::date, current_date))
    returning id into v_receipt;
    for v_line in select value from jsonb_array_elements(coalesce(v_rec -> 'lines', '[]'::jsonb)) loop
      insert into public.receipt_lines (receipt_id, variant_id, qty, unit_cost_cents)
      select v_receipt, v.id, (v_line ->> 'qty')::int, (v_line ->> 'cost')::int
      from public.variants v where v.sku = upper(v_line ->> 'sku');
    end loop;
    v_receipts := v_receipts + 1;
  end loop;

  for v_rec in select value from jsonb_array_elements(coalesce(p_data -> 'offers', '[]'::jsonb)) loop
    v_kind := case v_rec ->> 'type' when 'fixed' then 'fixed_trio' when 'custom' then 'custom_trio' else 'unit' end;
    insert into public.offers (name, kind, price_cents, on_instagram, on_site, allow_repeat)
    values (trim(v_rec ->> 'title'), v_kind, coalesce((v_rec ->> 'price')::int, 0),
            coalesce((v_rec ->> 'instagram')::boolean, true), coalesce((v_rec ->> 'site')::boolean, false),
            coalesce((v_rec ->> 'repeat')::boolean, false))
    returning id into v_offer;
    insert into public.offer_items (offer_id, variant_id, qty)
    select v_offer, v.id, case when v_kind = 'fixed_trio' then count(*)::int else 1 end
    from jsonb_array_elements_text(coalesce(v_rec -> 'skus', '[]'::jsonb)) s
    join public.variants v on v.sku = upper(s)
    group by v.id;
    v_offers := v_offers + 1;
  end loop;

  return public.finish_request(p_request_id, jsonb_build_object(
    'variants', v_variants, 'receipts', v_receipts, 'offers', v_offers, 'photos_skipped', v_photos,
    'orders_ignored', jsonb_array_length(coalesce(p_data -> 'orders', '[]'::jsonb))));
end $$;
