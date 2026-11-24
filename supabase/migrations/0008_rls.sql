-- Access rules. Only the admin reads anything; stock and money change only through functions.

do $$
declare
  t text;
begin
  foreach t in array array[
    'settings', 'admins', 'request_log', 'products', 'variants', 'receipts', 'receipt_lines',
    'offers', 'offer_items', 'customers', 'orders', 'order_lines', 'order_items', 'order_events',
    'stock_movements', 'payouts', 'payout_orders', 'ad_spend'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    if t <> 'request_log' then
      execute format('grant select on public.%I to authenticated', t);
      execute format('create policy admin_read on public.%I for select to authenticated using (public.is_admin())', t);
    end if;
  end loop;
end $$;

revoke all on all sequences in schema public from anon, authenticated;

-- Plain metadata the admin edits directly (never quantities, costs or order states).
grant insert, update on public.offers to authenticated;
grant insert, update, delete on public.offer_items to authenticated;
grant insert, update on public.customers to authenticated;
grant update on public.settings to authenticated;
grant insert, update, delete on public.ad_spend to authenticated;
grant update (photo_path, archived) on public.variants to authenticated;

create policy admin_insert on public.offers for insert to authenticated with check (public.is_admin());
create policy admin_update on public.offers for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_insert on public.offer_items for insert to authenticated with check (public.is_admin());
create policy admin_update on public.offer_items for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_delete on public.offer_items for delete to authenticated using (public.is_admin());
create policy admin_insert on public.customers for insert to authenticated with check (public.is_admin());
create policy admin_update on public.customers for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_update on public.settings for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_insert on public.ad_spend for insert to authenticated with check (public.is_admin());
create policy admin_update on public.ad_spend for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_delete on public.ad_spend for delete to authenticated using (public.is_admin());
create policy admin_update on public.variants for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- Functions: nothing for anon; the admin API for authenticated; internals stay private.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to authenticated;
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (p.proname like '\_%' or p.proname in ('begin_request', 'finish_request', 'place_site_order'))
  loop
    execute format('revoke execute on function %s from authenticated', f.sig);
  end loop;
end $$;
alter default privileges in schema public revoke execute on functions from public, anon;

-- The future shop's server calls this with the service_role key.
grant execute on function public.place_site_order(uuid, jsonb) to service_role;
