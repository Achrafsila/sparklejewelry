-- Orders: customer recognition, offer resolution, drafts, atomic confirmation, site orders.

-- Moroccan numbers only: returns +2125/6/7XXXXXXXX or null.
create or replace function public.normalize_phone(p text) returns text
language plpgsql immutable
as $$
declare
  v text := regexp_replace(coalesce(p, ''), '[\s().-]', '', 'g');
begin
  if v ~ '^\+212[5-7][0-9]{8}$' then
    return v;
  elsif v ~ '^00212[5-7][0-9]{8}$' then
    return '+' || substr(v, 3);
  elsif v ~ '^212[5-7][0-9]{8}$' then
    return '+' || v;
  elsif v ~ '^0[5-7][0-9]{8}$' then
    return '+212' || substr(v, 2);
  end if;
  return null;
end $$;

create or replace function public._set_status(p_order_id uuid, p_to public.order_status, p_note text default null)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_from public.order_status;
begin
  select status into v_from from public.orders where id = p_order_id;
  update public.orders set status = p_to, updated_at = now() where id = p_order_id;
  insert into public.order_events (order_id, from_status, to_status, note) values (p_order_id, v_from, p_to, p_note);
end $$;

-- Locks an order and checks its status; raises ETAT_INVALIDE otherwise.
create or replace function public._lock_order(p_order_id uuid, p_allowed public.order_status[])
returns public.orders
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v public.orders;
begin
  select * into v from public.orders where id = p_order_id for update;
  if not found then
    perform public._fail('VALEUR_INVALIDE', jsonb_build_object('field', 'order_id'));
  end if;
  if not (v.status = any (p_allowed)) then
    perform public._fail('ETAT_INVALIDE', jsonb_build_object('status', v.status));
  end if;
  return v;
end $$;

-- Creates or updates the customer card from a valid phone; returns null otherwise.
create or replace function public._upsert_customer(p_customer jsonb) returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_phone text := public.normalize_phone(p_customer ->> 'phone');
  v_id uuid;
begin
  if v_phone is null then
    return null;
  end if;
  insert into public.customers (name, phone, instagram, city, address)
  values (
    coalesce(trim(p_customer ->> 'name'), ''),
    v_phone,
    nullif(trim(coalesce(p_customer ->> 'instagram', '')), ''),
    coalesce(trim(p_customer ->> 'city'), ''),
    coalesce(trim(p_customer ->> 'address'), ''))
  on conflict (phone) do update set
    name = coalesce(nullif(excluded.name, ''), customers.name),
    instagram = coalesce(excluded.instagram, customers.instagram),
    city = coalesce(nullif(excluded.city, ''), customers.city),
    address = coalesce(nullif(excluded.address, ''), customers.address),
    updated_at = now()
  returning id into v_id;
  return v_id;
end $$;

-- Replaces the lines of an order with what the offers say today (prices, names, composition).
create or replace function public._resolve_lines(p_order_id uuid, p_lines jsonb, p_channel public.order_channel)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_line jsonb;
  v_idx int := 0;
  v_offer public.offers;
  v_qty int;
  v_line_id uuid;
  v_variant uuid;
  v_price int;
  v_picks uuid[];
  v_count int;
begin
  delete from public.order_lines where order_id = p_order_id;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    return;
  end if;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    select * into v_offer from public.offers where id = (v_line ->> 'offer_id')::uuid and not archived;
    if not found or (p_channel = 'site' and not v_offer.on_site) then
      perform public._fail('OFFRE_INVALIDE', jsonb_build_object('line', v_idx, 'field', 'offer_id'));
    end if;
    v_qty := (v_line ->> 'qty')::int;
    if v_qty is null or v_qty < 1 then
      perform public._fail('VALEUR_INVALIDE', jsonb_build_object('line', v_idx, 'field', 'qty'));
    end if;

    if v_offer.kind = 'unit' then
      select count(*) into v_count from public.offer_items where offer_id = v_offer.id;
      if v_count = 1 and v_line ->> 'variant_id' is null then
        select variant_id into v_variant from public.offer_items where offer_id = v_offer.id;
      else
        v_variant := (v_line ->> 'variant_id')::uuid;
      end if;
      select coalesce(oi.price_cents, v_offer.price_cents) into v_price
      from public.offer_items oi where oi.offer_id = v_offer.id and oi.variant_id = v_variant;
      if not found then
        perform public._fail('OFFRE_INVALIDE', jsonb_build_object('line', v_idx, 'field', 'variant_id'));
      end if;
      insert into public.order_lines (order_id, position, offer_id, offer_name, offer_kind, unit_price_cents, qty)
      values (p_order_id, v_idx, v_offer.id, v_offer.name, v_offer.kind, v_price, v_qty)
      returning id into v_line_id;
      insert into public.order_items (order_id, line_id, variant_id, sku, name, qty)
      select p_order_id, v_line_id, v.id, v.sku, public.variant_name(p.name, v.label), v_qty
      from public.variants v join public.products p on p.id = v.product_id where v.id = v_variant;

    elsif v_offer.kind = 'fixed_trio' then
      insert into public.order_lines (order_id, position, offer_id, offer_name, offer_kind, unit_price_cents, qty)
      values (p_order_id, v_idx, v_offer.id, v_offer.name, v_offer.kind, v_offer.price_cents, v_qty)
      returning id into v_line_id;
      insert into public.order_items (order_id, line_id, variant_id, sku, name, qty)
      select p_order_id, v_line_id, v.id, v.sku, public.variant_name(p.name, v.label), oi.qty * v_qty
      from public.offer_items oi
      join public.variants v on v.id = oi.variant_id
      join public.products p on p.id = v.product_id
      where oi.offer_id = v_offer.id;

    else -- custom_trio: always one trio per line
      v_picks := array(select (x)::uuid from jsonb_array_elements_text(coalesce(v_line -> 'picks', '[]'::jsonb)) x);
      if coalesce(array_length(v_picks, 1), 0) <> 3 then
        perform public._fail('TRIO_INVALIDE', jsonb_build_object('line', v_idx, 'reason', 'count'));
      end if;
      if exists (
        select 1 from unnest(v_picks) pick
        where not exists (select 1 from public.offer_items oi where oi.offer_id = v_offer.id and oi.variant_id = pick)
      ) then
        perform public._fail('TRIO_INVALIDE', jsonb_build_object('line', v_idx, 'reason', 'non_eligible'));
      end if;
      if not v_offer.allow_repeat and (select count(distinct pick) from unnest(v_picks) pick) <> 3 then
        perform public._fail('TRIO_INVALIDE', jsonb_build_object('line', v_idx, 'reason', 'repeat'));
      end if;
      insert into public.order_lines (order_id, position, offer_id, offer_name, offer_kind, unit_price_cents, qty)
      values (p_order_id, v_idx, v_offer.id, v_offer.name, v_offer.kind, v_offer.price_cents, 1)
      returning id into v_line_id;
      insert into public.order_items (order_id, line_id, variant_id, sku, name, qty)
      select p_order_id, v_line_id, v.id, v.sku, public.variant_name(p.name, v.label), count(*)
      from unnest(v_picks) pick
      join public.variants v on v.id = pick
      join public.products p on p.id = v.product_id
      group by v.id, v.sku, p.name, v.label;
    end if;
    v_idx := v_idx + 1;
  end loop;
end $$;

-- Writes the order header and lines; used by drafts and site orders.
create or replace function public._write_order(p_order_id uuid, p_order jsonb, p_channel public.order_channel)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_customer jsonb := coalesce(p_order -> 'customer', '{}'::jsonb);
  v_fee int := coalesce((p_order ->> 'shipping_fee_cents')::int, 0);
begin
  if v_fee < 0 then
    perform public._fail('VALEUR_INVALIDE', jsonb_build_object('field', 'shipping_fee_cents'));
  end if;
  update public.orders set
    customer_id = public._upsert_customer(v_customer),
    customer_name = coalesce(trim(v_customer ->> 'name'), ''),
    customer_phone = coalesce(public.normalize_phone(v_customer ->> 'phone'), trim(coalesce(v_customer ->> 'phone', ''))),
    customer_instagram = nullif(trim(coalesce(v_customer ->> 'instagram', '')), ''),
    customer_city = coalesce(trim(v_customer ->> 'city'), ''),
    customer_address = coalesce(trim(v_customer ->> 'address'), ''),
    shipping_fee_cents = v_fee,
    payment_method = case when p_order ->> 'payment_method' = 'prepaid' then 'prepaid' else 'cod' end,
    updated_at = now()
  where id = p_order_id;
  perform public._resolve_lines(p_order_id, p_order -> 'lines', p_channel);
end $$;

create or replace function public.order_needs(p_order_id uuid)
returns table (variant_id uuid, qty int)
language sql stable
set search_path = public, pg_temp
as $$
  select i.variant_id, sum(i.qty)::int from public.order_items i where i.order_id = p_order_id group by i.variant_id
$$;

-- Reserves every piece of a draft, all or nothing.
create or replace function public._confirm(p_order_id uuid) returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v public.orders;
  v_ids uuid[];
  v_short jsonb;
  v_before jsonb;
begin
  v := public._lock_order(p_order_id, array['brouillon']::public.order_status[]);
  if trim(v.customer_name) = '' then
    perform public._fail('VALEUR_INVALIDE', jsonb_build_object('field', 'customer_name'));
  elsif public.normalize_phone(v.customer_phone) is null then
    perform public._fail('VALEUR_INVALIDE', jsonb_build_object('field', 'customer_phone'));
  elsif trim(v.customer_city) = '' then
    perform public._fail('VALEUR_INVALIDE', jsonb_build_object('field', 'customer_city'));
  elsif trim(v.customer_address) = '' then
    perform public._fail('VALEUR_INVALIDE', jsonb_build_object('field', 'customer_address'));
  end if;

  v_ids := array(select n.variant_id from public.order_needs(p_order_id) n);
  if coalesce(array_length(v_ids, 1), 0) = 0 then
    perform public._fail('PANIER_VIDE');
  end if;
  perform public._lock_variants(v_ids);

  select jsonb_agg(jsonb_build_object(
      'variant_id', var.id, 'sku', var.sku, 'name', public.variant_name(p.name, var.label),
      'need', n.qty, 'available', var.available_qty) order by var.sku)
  into v_short
  from public.order_needs(p_order_id) n
  join public.variants var on var.id = n.variant_id
  join public.products p on p.id = var.product_id
  where n.qty > var.available_qty;
  if v_short is not null then
    perform public._fail('STOCK_INSUFFISANT', v_short);
  end if;

  v_before := public._available_snapshot(v_ids);
  update public.variants var set reserved_qty = var.reserved_qty + n.qty
  from public.order_needs(p_order_id) n where var.id = n.variant_id;
  insert into public.stock_movements (variant_id, kind, reserved_delta, order_id)
  select n.variant_id, 'reservation', n.qty, p_order_id from public.order_needs(p_order_id) n;

  update public.orders set confirmed_at = now() where id = p_order_id;
  perform public._set_status(p_order_id, 'confirmee');
  return jsonb_build_object('order_id', p_order_id, 'number', v.number, 'status', 'confirmee',
    'alerts', public._alerts(v_before));
end $$;

create or replace function public.save_order_draft(p_request_id uuid, p_order jsonb) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_prev jsonb;
  v_id uuid := (p_order ->> 'id')::uuid;
  v_number text;
begin
  perform public.assert_admin();
  v_prev := public.begin_request(p_request_id, 'save_order_draft');
  if v_prev is not null then
    return v_prev;
  end if;
  if v_id is null then
    insert into public.orders (channel, status) values ('instagram', 'brouillon') returning id into v_id;
    insert into public.order_events (order_id, to_status) values (v_id, 'brouillon');
  else
    perform public._lock_order(v_id, array['brouillon']::public.order_status[]);
  end if;
  perform public._write_order(v_id, p_order, 'instagram');
  select number into v_number from public.orders where id = v_id;
  return public.finish_request(p_request_id, jsonb_build_object('order_id', v_id, 'number', v_number));
end $$;

create or replace function public.delete_draft(p_order_id uuid) returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_admin();
  perform public._lock_order(p_order_id, array['brouillon']::public.order_status[]);
  delete from public.orders where id = p_order_id;
end $$;

create or replace function public.confirm_order(p_request_id uuid, p_order_id uuid) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_prev jsonb;
begin
  perform public.assert_admin();
  v_prev := public.begin_request(p_request_id, 'confirm_order');
  if v_prev is not null then
    return v_prev;
  end if;
  return public.finish_request(p_request_id, public._confirm(p_order_id));
end $$;

-- For the future shop's server (service_role only): create and confirm in one transaction.
create or replace function public.place_site_order(p_request_id uuid, p_order jsonb) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_prev jsonb;
  v_id uuid;
  v_result jsonb;
begin
  v_prev := public.begin_request(p_request_id, 'place_site_order');
  if v_prev is not null then
    return v_prev;
  end if;
  insert into public.orders (channel, status) values ('site', 'brouillon') returning id into v_id;
  insert into public.order_events (order_id, to_status) values (v_id, 'brouillon');
  perform public._write_order(v_id, p_order, 'site');
  v_result := public._confirm(v_id);
  return public.finish_request(p_request_id, jsonb_build_object(
    'order_id', v_id, 'number', v_result ->> 'number', 'status', v_result ->> 'status'));
end $$;
