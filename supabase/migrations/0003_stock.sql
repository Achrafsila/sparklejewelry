-- Stock: arrivals with weighted average cost, manual corrections, low-stock alerts.

create or replace function public.variant_name(p_product text, p_label text) returns text
language sql immutable parallel safe
as $$
  select p_product || coalesce(' ' || nullif(trim(p_label), ''), '')
$$;

-- Locks variants in a fixed order so concurrent operations never deadlock.
create or replace function public._lock_variants(p_ids uuid[]) returns void
language sql
set search_path = public, pg_temp
as $$
  select 1 from public.variants where id = any (p_ids) order by id for update;
$$;

-- Snapshot of available quantities, used to detect low-stock crossings.
create or replace function public._available_snapshot(p_ids uuid[]) returns jsonb
language sql stable
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_object_agg(id, available_qty), '{}'::jsonb) from public.variants where id = any (p_ids)
$$;

-- Variants whose availability went from above the threshold to at or below it.
create or replace function public._alerts(p_before jsonb) returns jsonb
language sql stable
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'variant_id', v.id,
      'sku', v.sku,
      'name', public.variant_name(p.name, v.label),
      'before', b.value::int,
      'after', v.available_qty,
      'offers', coalesce((
        select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name) order by o.name)
        from public.offer_items oi join public.offers o on o.id = oi.offer_id
        where oi.variant_id = v.id and not o.archived), '[]'::jsonb)
    ) order by v.sku), '[]'::jsonb)
  from jsonb_each_text(p_before) b
  join public.variants v on v.id = b.key::uuid
  join public.products p on p.id = v.product_id
  cross join public.settings s
  where b.value::int > s.low_stock_threshold and v.available_qty <= s.low_stock_threshold
$$;

create or replace function public.suggest_sku(p_model text, p_label text) returns text
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_base text;
  v_candidate text;
  v_n int := 1;
begin
  perform public.assert_admin();
  v_base := upper(regexp_replace(
    regexp_replace(
      extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(p_model, '') || ' ' || coalesce(p_label, '')),
      '[^A-Za-z0-9]+', '-', 'g'),
    '(^-+|-+$)', '', 'g'));
  if v_base = '' then
    v_base := 'REF';
  end if;
  v_candidate := v_base;
  while exists (select 1 from public.variants where sku = v_candidate) loop
    v_n := v_n + 1;
    v_candidate := v_base || '-' || v_n;
  end loop;
  return v_candidate;
end $$;

create or replace function public.validate_receipt(
  p_request_id uuid, p_supplier text, p_received_on date, p_lines jsonb
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_prev jsonb;
  v_receipt uuid;
  v_line jsonb;
  v_idx int := 0;
  v_variant uuid;
  v_product uuid;
  v_sku text;
  v_name text;
  v_label text;
  v_qty int;
  v_cost int;
  v_phys int;
  v_avg numeric;
  v_known boolean;
  v_ids uuid[] := '{}';
begin
  perform public.assert_admin();
  v_prev := public.begin_request(p_request_id, 'validate_receipt');
  if v_prev is not null then
    return v_prev;
  end if;

  if coalesce(trim(p_supplier), '') = '' then
    perform public._fail('VALEUR_INVALIDE', jsonb_build_object('field', 'supplier'));
  end if;
  if p_received_on is null then
    perform public._fail('VALEUR_INVALIDE', jsonb_build_object('field', 'received_on'));
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then
    perform public._fail('VALEUR_INVALIDE', jsonb_build_object('field', 'lines'));
  end if;

  insert into public.receipts (supplier, received_on) values (trim(p_supplier), p_received_on)
  returning id into v_receipt;

  perform public._lock_variants(array(
    select (l ->> 'variant_id')::uuid from jsonb_array_elements(p_lines) l where l ->> 'variant_id' is not null));

  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_qty := (v_line ->> 'qty')::int;
    v_cost := (v_line ->> 'unit_cost_cents')::int;
    if v_qty is null or v_qty <= 0 then
      perform public._fail('VALEUR_INVALIDE', jsonb_build_object('line', v_idx, 'field', 'qty'));
    end if;
    if v_cost is null or v_cost < 0 then
      perform public._fail('VALEUR_INVALIDE', jsonb_build_object('line', v_idx, 'field', 'unit_cost_cents'));
    end if;

    if v_line ->> 'variant_id' is not null then
      v_variant := (v_line ->> 'variant_id')::uuid;
      if not exists (select 1 from public.variants where id = v_variant) then
        perform public._fail('VALEUR_INVALIDE', jsonb_build_object('line', v_idx, 'field', 'variant_id'));
      end if;
    else
      v_name := trim(coalesce(v_line ->> 'product_name', ''));
      if v_name = '' then
        perform public._fail('VALEUR_INVALIDE', jsonb_build_object('line', v_idx, 'field', 'product_name'));
      end if;
      v_label := nullif(trim(coalesce(v_line ->> 'label', '')), '');
      v_sku := upper(trim(coalesce(v_line ->> 'sku', '')));
      if v_sku = '' then
        v_sku := public.suggest_sku(v_name, v_label);
      end if;
      if v_sku !~ '^[A-Z0-9][A-Z0-9-]*$' then
        perform public._fail('VALEUR_INVALIDE', jsonb_build_object('line', v_idx, 'field', 'sku'));
      end if;
      if exists (select 1 from public.variants where sku = v_sku) then
        perform public._fail('SKU_EXISTE', jsonb_build_object('line', v_idx, 'sku', v_sku));
      end if;
      select id into v_product from public.products where public.norm_key(name) = public.norm_key(v_name);
      if v_product is null then
        insert into public.products (name) values (v_name) returning id into v_product;
      elsif exists (
        select 1 from public.variants
        where product_id = v_product and label_key = public.norm_key(coalesce(v_label, ''))
      ) then
        perform public._fail('MODELE_VARIANTE_EXISTE',
          jsonb_build_object('line', v_idx, 'product_name', v_name, 'label', v_label));
      end if;
      insert into public.variants (product_id, sku, label, photo_path)
      values (v_product, v_sku, v_label, nullif(v_line ->> 'photo_path', ''))
      returning id into v_variant;
    end if;

    -- Weighted average: pieces of unknown cost (imports) take the cost of this arrival.
    select physical_qty, avg_cost, cost_known into v_phys, v_avg, v_known
    from public.variants where id = v_variant;
    update public.variants
    set physical_qty = physical_qty + v_qty,
        avg_cost = case
          when v_phys <= 0 or not v_known then v_cost
          else (v_phys * v_avg + v_qty * v_cost) / (v_phys + v_qty)
        end,
        cost_known = true
    where id = v_variant;

    insert into public.receipt_lines (receipt_id, variant_id, qty, unit_cost_cents)
    values (v_receipt, v_variant, v_qty, v_cost);
    insert into public.stock_movements (variant_id, kind, physical_delta, unit_cost, receipt_id)
    values (v_variant, 'arrivage', v_qty, v_cost, v_receipt);

    v_ids := v_ids || v_variant;
    v_idx := v_idx + 1;
  end loop;

  return public.finish_request(p_request_id,
    jsonb_build_object('receipt_id', v_receipt, 'variant_ids', to_jsonb(v_ids)));
end $$;

create or replace function public.adjust_stock(
  p_request_id uuid, p_variant_id uuid, p_delta int, p_reason text
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_prev jsonb;
  v_before jsonb;
  v_phys int;
  v_res int;
  v_avg numeric;
begin
  perform public.assert_admin();
  v_prev := public.begin_request(p_request_id, 'adjust_stock');
  if v_prev is not null then
    return v_prev;
  end if;
  if coalesce(trim(p_reason), '') = '' then
    perform public._fail('VALEUR_INVALIDE', jsonb_build_object('field', 'reason'));
  end if;
  if p_delta is null or p_delta = 0 then
    perform public._fail('VALEUR_INVALIDE', jsonb_build_object('field', 'delta'));
  end if;

  perform public._lock_variants(array[p_variant_id]);
  select physical_qty, reserved_qty, avg_cost into v_phys, v_res, v_avg from public.variants where id = p_variant_id;
  if not found then
    perform public._fail('VALEUR_INVALIDE', jsonb_build_object('field', 'variant_id'));
  end if;
  if v_phys + p_delta < v_res then
    perform public._fail('VALEUR_INVALIDE',
      jsonb_build_object('field', 'delta', 'minimum', v_res - v_phys));
  end if;

  v_before := public._available_snapshot(array[p_variant_id]);
  update public.variants set physical_qty = physical_qty + p_delta where id = p_variant_id
  returning physical_qty into v_phys;
  insert into public.stock_movements (variant_id, kind, physical_delta, unit_cost, note)
  values (p_variant_id, 'correction', p_delta, v_avg, trim(p_reason));

  return public.finish_request(p_request_id, jsonb_build_object(
    'variant_id', p_variant_id, 'physical_qty', v_phys, 'alerts', public._alerts(v_before)));
end $$;
