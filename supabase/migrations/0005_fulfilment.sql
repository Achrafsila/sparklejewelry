-- Fulfilment: picking, shipping, delivery, cancellation, returns, carrier payouts.

create or replace function public.set_item_picked(p_item_id uuid, p_picked boolean) returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_order uuid;
begin
  perform public.assert_admin();
  select order_id into v_order from public.order_items where id = p_item_id;
  if v_order is null then
    perform public._fail('VALEUR_INVALIDE', jsonb_build_object('field', 'item_id'));
  end if;
  perform public._lock_order(v_order, array['confirmee']::public.order_status[]);
  update public.order_items set picked = coalesce(p_picked, false) where id = p_item_id;
end $$;

create or replace function public.mark_prepared(p_request_id uuid, p_order_id uuid) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_prev jsonb;
begin
  perform public.assert_admin();
  v_prev := public.begin_request(p_request_id, 'mark_prepared');
  if v_prev is not null then
    return v_prev;
  end if;
  perform public._lock_order(p_order_id, array['confirmee']::public.order_status[]);
  if exists (select 1 from public.order_items where order_id = p_order_id and not picked) then
    perform public._fail('VALEUR_INVALIDE', jsonb_build_object('field', 'picked'));
  end if;
  update public.orders set prepared_at = now() where id = p_order_id;
  perform public._set_status(p_order_id, 'preparee');
  return public.finish_request(p_request_id, jsonb_build_object('order_id', p_order_id, 'status', 'preparee'));
end $$;

-- Physical and reserved quantities go down in the same update: availability does not drop twice.
create or replace function public.ship_order(
  p_request_id uuid, p_order_id uuid, p_carrier text, p_tracking text, p_transport_cost_cents int
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_prev jsonb;
  v_carrier text := trim(coalesce(p_carrier, ''));
  v_ids uuid[];
begin
  perform public.assert_admin();
  v_prev := public.begin_request(p_request_id, 'ship_order');
  if v_prev is not null then
    return v_prev;
  end if;
  perform public._lock_order(p_order_id, array['preparee']::public.order_status[]);
  if v_carrier = '' then
    perform public._fail('VALEUR_INVALIDE', jsonb_build_object('field', 'carrier'));
  end if;
  if p_transport_cost_cents is null or p_transport_cost_cents < 0 then
    perform public._fail('VALEUR_INVALIDE', jsonb_build_object('field', 'transport_cost_cents'));
  end if;

  v_ids := array(select n.variant_id from public.order_needs(p_order_id) n);
  perform public._lock_variants(v_ids);

  update public.order_items i set unit_cost = var.avg_cost
  from public.variants var where var.id = i.variant_id and i.order_id = p_order_id;
  insert into public.stock_movements (variant_id, kind, physical_delta, reserved_delta, unit_cost, order_id)
  select n.variant_id, 'expedition', -n.qty, -n.qty, var.avg_cost, p_order_id
  from public.order_needs(p_order_id) n join public.variants var on var.id = n.variant_id;
  update public.variants var
  set physical_qty = var.physical_qty - n.qty, reserved_qty = var.reserved_qty - n.qty
  from public.order_needs(p_order_id) n where var.id = n.variant_id;

  update public.orders set
    carrier = v_carrier,
    tracking = nullif(trim(coalesce(p_tracking, '')), ''),
    transport_cost_cents = p_transport_cost_cents,
    packaging_cost_cents = (select packaging_cost_cents from public.settings),
    shipped_at = now()
  where id = p_order_id;
  update public.settings set carriers = carriers || v_carrier
  where not exists (select 1 from unnest(carriers) c where public.norm_key(c) = public.norm_key(v_carrier));
  perform public._set_status(p_order_id, 'en_livraison');
  return public.finish_request(p_request_id, jsonb_build_object('order_id', p_order_id, 'status', 'en_livraison'));
end $$;

create or replace function public.cancel_order(p_request_id uuid, p_order_id uuid) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_prev jsonb;
begin
  perform public.assert_admin();
  v_prev := public.begin_request(p_request_id, 'cancel_order');
  if v_prev is not null then
    return v_prev;
  end if;
  perform public._lock_order(p_order_id, array['confirmee', 'preparee']::public.order_status[]);
  perform public._lock_variants(array(select n.variant_id from public.order_needs(p_order_id) n));
  insert into public.stock_movements (variant_id, kind, reserved_delta, order_id)
  select n.variant_id, 'liberation', -n.qty, p_order_id from public.order_needs(p_order_id) n;
  update public.variants var set reserved_qty = var.reserved_qty - n.qty
  from public.order_needs(p_order_id) n where var.id = n.variant_id;
  update public.orders set cancelled_at = now() where id = p_order_id;
  perform public._set_status(p_order_id, 'annulee');
  return public.finish_request(p_request_id, jsonb_build_object('order_id', p_order_id, 'status', 'annulee'));
end $$;

create or replace function public.mark_delivered(p_request_id uuid, p_order_id uuid) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_prev jsonb;
begin
  perform public.assert_admin();
  v_prev := public.begin_request(p_request_id, 'mark_delivered');
  if v_prev is not null then
    return v_prev;
  end if;
  perform public._lock_order(p_order_id, array['en_livraison']::public.order_status[]);
  update public.orders set delivered_at = now() where id = p_order_id;
  perform public._set_status(p_order_id, 'livree');
  return public.finish_request(p_request_id, jsonb_build_object('order_id', p_order_id, 'status', 'livree'));
end $$;

create or replace function public.report_return(p_request_id uuid, p_order_id uuid, p_return_fee_cents int default null)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_prev jsonb;
begin
  perform public.assert_admin();
  v_prev := public.begin_request(p_request_id, 'report_return');
  if v_prev is not null then
    return v_prev;
  end if;
  perform public._lock_order(p_order_id, array['en_livraison']::public.order_status[]);
  if p_return_fee_cents < 0 then
    perform public._fail('VALEUR_INVALIDE', jsonb_build_object('field', 'return_fee_cents'));
  end if;
  update public.orders set return_reported_at = now(), return_fee_cents = p_return_fee_cents where id = p_order_id;
  perform public._set_status(p_order_id, 'retour_attendu');
  return public.finish_request(p_request_id, jsonb_build_object('order_id', p_order_id, 'status', 'retour_attendu'));
end $$;

-- Resalable pieces go back at the cost frozen at shipment; damaged ones are recorded as a loss.
create or replace function public.receive_return(
  p_request_id uuid, p_order_id uuid, p_items jsonb, p_return_fee_cents int
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_prev jsonb;
  v_item public.order_items;
  v_damaged int;
  v_resalable int;
  v_phys int;
  v_avg numeric;
begin
  perform public.assert_admin();
  v_prev := public.begin_request(p_request_id, 'receive_return');
  if v_prev is not null then
    return v_prev;
  end if;
  perform public._lock_order(p_order_id, array['retour_attendu']::public.order_status[]);
  if p_return_fee_cents is null or p_return_fee_cents < 0 then
    perform public._fail('VALEUR_INVALIDE', jsonb_build_object('field', 'return_fee_cents'));
  end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x
    where not exists (select 1 from public.order_items i where i.id = (x ->> 'item_id')::uuid and i.order_id = p_order_id)
  ) then
    perform public._fail('VALEUR_INVALIDE', jsonb_build_object('field', 'items'));
  end if;

  perform public._lock_variants(array(select n.variant_id from public.order_needs(p_order_id) n));

  for v_item in select * from public.order_items where order_id = p_order_id order by id loop
    select coalesce(max((x ->> 'damaged_qty')::int), 0) into v_damaged
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x where (x ->> 'item_id')::uuid = v_item.id;
    if v_damaged < 0 or v_damaged > v_item.qty then
      perform public._fail('RETOUR_INCOHERENT', jsonb_build_object('item_id', v_item.id));
    end if;
    v_resalable := v_item.qty - v_damaged;
    update public.order_items set returned_resalable = v_resalable, returned_damaged = v_damaged where id = v_item.id;

    if v_resalable > 0 then
      select physical_qty, avg_cost into v_phys, v_avg from public.variants where id = v_item.variant_id;
      update public.variants set
        physical_qty = physical_qty + v_resalable,
        avg_cost = case when v_phys <= 0 then coalesce(v_item.unit_cost, v_avg)
          else (v_phys * v_avg + v_resalable * coalesce(v_item.unit_cost, v_avg)) / (v_phys + v_resalable) end
      where id = v_item.variant_id;
      insert into public.stock_movements (variant_id, kind, physical_delta, unit_cost, order_id)
      values (v_item.variant_id, 'retour_revendable', v_resalable, v_item.unit_cost, p_order_id);
    end if;
    if v_damaged > 0 then
      insert into public.stock_movements (variant_id, kind, physical_delta, unit_cost, order_id, note)
      values (v_item.variant_id, 'retour_perte', 0, v_item.unit_cost, p_order_id,
        v_damaged || ' pièce(s) abîmée(s) au retour');
    end if;
  end loop;

  update public.orders set return_received_at = now(), return_fee_cents = p_return_fee_cents where id = p_order_id;
  perform public._set_status(p_order_id, 'retour_recu');
  return public.finish_request(p_request_id, jsonb_build_object('order_id', p_order_id, 'status', 'retour_recu'));
end $$;

-- What the carrier owes for one order, net of its fees (negative for a return).
create or replace function public.order_expected_cents(p_order_id uuid) returns int
language sql stable security definer
set search_path = public, pg_temp
as $$
  select case
    when o.status in ('en_livraison', 'livree', 'payee') then
      (case when o.payment_method = 'prepaid' then 0
            else coalesce((select sum(l.unit_price_cents * l.qty) from public.order_lines l where l.order_id = o.id), 0)
                 + o.shipping_fee_cents end)
      - coalesce(o.transport_cost_cents, 0)
    when o.status in ('retour_attendu', 'retour_recu') then
      -(coalesce(o.transport_cost_cents, 0) + coalesce(o.return_fee_cents, 0))
  end::int
  from public.orders o
  where o.id = p_order_id and public.is_admin()
$$;

create or replace function public.record_payout(
  p_request_id uuid, p_carrier text, p_received_on date, p_reference text, p_amount_cents int, p_orders jsonb
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_prev jsonb;
  v_payout uuid;
  v_entry jsonb;
  v_order public.orders;
  v_expected int;
  v_total int := 0;
begin
  perform public.assert_admin();
  v_prev := public.begin_request(p_request_id, 'record_payout');
  if v_prev is not null then
    return v_prev;
  end if;
  if coalesce(trim(p_carrier), '') = '' then
    perform public._fail('VALEUR_INVALIDE', jsonb_build_object('field', 'carrier'));
  end if;
  if p_received_on is null then
    perform public._fail('VALEUR_INVALIDE', jsonb_build_object('field', 'received_on'));
  end if;
  if p_amount_cents is null then
    perform public._fail('VALEUR_INVALIDE', jsonb_build_object('field', 'amount_cents'));
  end if;
  if jsonb_typeof(p_orders) is distinct from 'array' or jsonb_array_length(p_orders) = 0 then
    perform public._fail('VALEUR_INVALIDE', jsonb_build_object('field', 'orders'));
  end if;

  insert into public.payouts (carrier, received_on, reference, amount_received_cents)
  values (trim(p_carrier), p_received_on, trim(coalesce(p_reference, '')), p_amount_cents)
  returning id into v_payout;

  for v_entry in
    select value from jsonb_array_elements(p_orders) order by value ->> 'order_id'
  loop
    select * into v_order from public.orders where id = (v_entry ->> 'order_id')::uuid for update;
    if not found then
      perform public._fail('VALEUR_INVALIDE', jsonb_build_object('field', 'order_id'));
    end if;
    if exists (select 1 from public.payout_orders where order_id = v_order.id) then
      perform public._fail('COMMANDE_DEJA_RATTACHEE', jsonb_build_object('order_id', v_order.id, 'number', v_order.number));
    end if;
    if v_order.status not in ('livree', 'retour_attendu', 'retour_recu') then
      perform public._fail('ETAT_INVALIDE', jsonb_build_object('order_id', v_order.id, 'status', v_order.status));
    end if;
    if public.norm_key(v_order.carrier) <> public.norm_key(p_carrier) then
      perform public._fail('VALEUR_INVALIDE', jsonb_build_object('order_id', v_order.id, 'field', 'carrier'));
    end if;
    v_expected := public.order_expected_cents(v_order.id);
    insert into public.payout_orders (payout_id, order_id, expected_cents, received_cents)
    values (v_payout, v_order.id, v_expected, coalesce((v_entry ->> 'received_cents')::int, v_expected));
    v_total := v_total + v_expected;
    if v_order.status = 'livree' then
      update public.orders set paid_at = now() where id = v_order.id;
      perform public._set_status(v_order.id, 'payee');
    end if;
  end loop;

  return public.finish_request(p_request_id, jsonb_build_object(
    'payout_id', v_payout, 'expected_cents', v_total, 'received_cents', p_amount_cents,
    'gap_cents', p_amount_cents - v_total));
end $$;
