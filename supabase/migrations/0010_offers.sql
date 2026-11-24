-- Offers are saved in one transaction (offer + composition), so a failure never leaves an offer without pieces.

create or replace function public.save_offer(p_request_id uuid, p_offer jsonb) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_prev jsonb;
  v_id uuid := (p_offer ->> 'id')::uuid;
  v_kind public.offer_kind := (p_offer ->> 'kind')::public.offer_kind;
  v_existing public.offer_kind;
  v_name text := trim(coalesce(p_offer ->> 'name', ''));
  v_price int := (p_offer ->> 'price_cents')::int;
  v_items jsonb := coalesce(p_offer -> 'items', '[]'::jsonb);
  v_repeat boolean := coalesce((p_offer ->> 'allow_repeat')::boolean, false);
  v_total int;
  v_distinct int;
begin
  perform public.assert_admin();
  v_prev := public.begin_request(p_request_id, 'save_offer');
  if v_prev is not null then
    return v_prev;
  end if;

  if v_name = '' then
    perform public._fail('VALEUR_INVALIDE', jsonb_build_object('field', 'name'));
  end if;
  if v_price is null or v_price < 0 then
    perform public._fail('VALEUR_INVALIDE', jsonb_build_object('field', 'price_cents'));
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_items) i
    where not exists (select 1 from public.variants v where v.id = (i ->> 'variant_id')::uuid)
       or coalesce((i ->> 'qty')::int, 1) < 1
       or (i ->> 'price_cents')::int < 0
  ) then
    perform public._fail('VALEUR_INVALIDE', jsonb_build_object('field', 'items'));
  end if;

  select coalesce(sum(coalesce((i ->> 'qty')::int, 1)), 0), count(distinct i ->> 'variant_id')
  into v_total, v_distinct
  from jsonb_array_elements(v_items) i;

  if (v_kind = 'unit' and v_distinct < 1)
     or (v_kind = 'fixed_trio' and v_total <> 3)
     or (v_kind = 'custom_trio' and (v_distinct < 1 or (not v_repeat and v_distinct < 3)))
     or v_distinct <> jsonb_array_length(v_items) then
    perform public._fail('VALEUR_INVALIDE', jsonb_build_object('field', 'items'));
  end if;

  if v_id is null then
    insert into public.offers (name, kind, price_cents, photo_path, on_instagram, on_site, allow_repeat)
    values (v_name, v_kind, v_price, nullif(p_offer ->> 'photo_path', ''),
            coalesce((p_offer ->> 'on_instagram')::boolean, true), coalesce((p_offer ->> 'on_site')::boolean, false),
            v_kind = 'custom_trio' and v_repeat)
    returning id into v_id;
  else
    select kind into v_existing from public.offers where id = v_id for update;
    if not found then
      perform public._fail('VALEUR_INVALIDE', jsonb_build_object('field', 'id'));
    end if;
    if v_existing <> v_kind then
      perform public._fail('VALEUR_INVALIDE', jsonb_build_object('field', 'kind'));
    end if;
    update public.offers set
      name = v_name,
      price_cents = v_price,
      photo_path = coalesce(nullif(p_offer ->> 'photo_path', ''), photo_path),
      on_instagram = coalesce((p_offer ->> 'on_instagram')::boolean, on_instagram),
      on_site = coalesce((p_offer ->> 'on_site')::boolean, on_site),
      allow_repeat = v_kind = 'custom_trio' and v_repeat,
      updated_at = now()
    where id = v_id;
    delete from public.offer_items where offer_id = v_id;
  end if;

  insert into public.offer_items (offer_id, variant_id, qty, price_cents)
  select v_id, (i ->> 'variant_id')::uuid,
         case when v_kind = 'fixed_trio' then coalesce((i ->> 'qty')::int, 1) else 1 end,
         case when v_kind = 'unit' then (i ->> 'price_cents')::int end
  from jsonb_array_elements(v_items) i;

  return public.finish_request(p_request_id, jsonb_build_object('offer_id', v_id));
end $$;

revoke execute on function public.save_offer(uuid, jsonb) from public, anon;
grant execute on function public.save_offer(uuid, jsonb) to authenticated;
