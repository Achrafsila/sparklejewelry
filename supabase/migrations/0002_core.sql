-- Shared helpers: admin check, business errors, request idempotency.

create or replace function public.is_admin() returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.admins where user_id = auth.uid())
$$;

-- Raises a business error the client maps to a French message.
create or replace function public._fail(p_code text, p_detail jsonb default null) returns void
language plpgsql
as $$
begin
  raise exception using errcode = 'P0001', message = p_code, detail = coalesce(p_detail::text, '');
end $$;

create or replace function public.assert_admin() returns void
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    perform public._fail('NON_AUTORISE');
  end if;
end $$;

-- Registers a request. Returns null when the request is new, or the stored result
-- when the same request already ran. A concurrent duplicate waits for the first one.
create or replace function public.begin_request(p_request_id uuid, p_fn text) returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_fn text;
  v_result jsonb;
begin
  if p_request_id is null then
    perform public._fail('VALEUR_INVALIDE', jsonb_build_object('field', 'request_id'));
  end if;
  insert into public.request_log (request_id, fn) values (p_request_id, p_fn)
  on conflict (request_id) do nothing;
  if found then
    return null;
  end if;
  select fn, result into v_fn, v_result from public.request_log where request_id = p_request_id;
  if v_fn <> p_fn then
    perform public._fail('VALEUR_INVALIDE', jsonb_build_object('field', 'request_id'));
  end if;
  return coalesce(v_result, '{}'::jsonb);
end $$;

create or replace function public.finish_request(p_request_id uuid, p_result jsonb) returns jsonb
language sql
set search_path = public, pg_temp
as $$
  update public.request_log set result = p_result where request_id = p_request_id;
  select p_result;
$$;
