-- Deleting a reference or an offer from the back-office.
--
-- An offer is erased: past orders already keep its name, format and price
-- (order_lines.offer_id becomes null).
-- A reference that no order ever used is erased with its arrival lines and movements,
-- so a mistyped arrival line disappears completely.
-- A reference that appears in an order is withdrawn instead: archived and its remaining
-- pieces written off, so the orders that contain it keep their history.

create or replace function public.delete_offer(p_request_id uuid, p_offer_id uuid) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_prev jsonb;
begin
  perform public.assert_admin();
  v_prev := public.begin_request(p_request_id, 'delete_offer');
  if v_prev is not null then
    return v_prev;
  end if;

  delete from public.offers where id = p_offer_id;
  if not found then
    perform public._fail('INTROUVABLE');
  end if;

  return public.finish_request(p_request_id, jsonb_build_object('deleted', true));
end $$;

create or replace function public.delete_variant(p_request_id uuid, p_variant_id uuid) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_prev jsonb;
  v public.variants;
  v_offers jsonb;
  v_receipts uuid[];
begin
  perform public.assert_admin();
  v_prev := public.begin_request(p_request_id, 'delete_variant');
  if v_prev is not null then
    return v_prev;
  end if;

  perform public._lock_variants(array[p_variant_id]);
  select * into v from public.variants where id = p_variant_id;
  if not found then
    perform public._fail('INTROUVABLE');
  end if;

  select jsonb_agg(o.name order by o.name) into v_offers
  from public.offers o
  where not o.archived
    and exists (select 1 from public.offer_items oi where oi.offer_id = o.id and oi.variant_id = p_variant_id);
  if v_offers is not null then
    perform public._fail('REFERENCE_DANS_OFFRES', jsonb_build_object('offers', v_offers));
  end if;

  if v.reserved_qty > 0 then
    perform public._fail('REFERENCE_RESERVEE', jsonb_build_object('reserved', v.reserved_qty));
  end if;

  -- Already in an order: keep the row for the order history, take it out of the stock.
  if exists (select 1 from public.order_items where variant_id = p_variant_id) then
    if v.physical_qty <> 0 then
      insert into public.stock_movements (variant_id, kind, physical_delta, unit_cost, note)
      values (p_variant_id, 'correction', -v.physical_qty, v.avg_cost, 'Référence supprimée');
    end if;
    update public.variants set archived = true, physical_qty = 0 where id = p_variant_id;
    return public.finish_request(p_request_id, jsonb_build_object('mode', 'archived'));
  end if;

  -- Never ordered: erase it everywhere, including an arrival left without lines.
  select array_agg(distinct receipt_id) into v_receipts from public.receipt_lines where variant_id = p_variant_id;
  delete from public.offer_items where variant_id = p_variant_id;
  delete from public.stock_movements where variant_id = p_variant_id;
  delete from public.receipt_lines where variant_id = p_variant_id;
  delete from public.receipts r
  where r.id = any(coalesce(v_receipts, '{}'))
    and not exists (select 1 from public.receipt_lines l where l.receipt_id = r.id);
  delete from public.variants where id = p_variant_id;
  delete from public.products p
  where p.id = v.product_id
    and not exists (select 1 from public.variants x where x.product_id = p.id);

  return public.finish_request(p_request_id, jsonb_build_object('mode', 'deleted'));
end $$;

-- A new arrival of a withdrawn reference puts it back in the stock.
create or replace function public._unarchive_received_variant() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  update public.variants set archived = false where id = new.variant_id and archived;
  return new;
end $$;

drop trigger if exists receipt_lines_unarchive on public.receipt_lines;
create trigger receipt_lines_unarchive
after insert on public.receipt_lines
for each row execute function public._unarchive_received_variant();

revoke execute on function public.delete_offer(uuid, uuid) from public, anon;
revoke execute on function public.delete_variant(uuid, uuid) from public, anon;
revoke execute on function public._unarchive_received_variant() from public, anon, authenticated;
grant execute on function public.delete_offer(uuid, uuid) to authenticated;
grant execute on function public.delete_variant(uuid, uuid) to authenticated;
