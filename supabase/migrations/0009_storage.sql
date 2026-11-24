-- Photo storage on Supabase: public read (catalogue photos), admin-only writes.
-- Skipped locally, where the dev stub stores files under .local/storage.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('photos', 'photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do nothing;

    execute $p$create policy "photos admin insert" on storage.objects for insert to authenticated
      with check (bucket_id = 'photos' and public.is_admin())$p$;
    execute $p$create policy "photos admin update" on storage.objects for update to authenticated
      using (bucket_id = 'photos' and public.is_admin()) with check (bucket_id = 'photos' and public.is_admin())$p$;
    execute $p$create policy "photos admin delete" on storage.objects for delete to authenticated
      using (bucket_id = 'photos' and public.is_admin())$p$;
  end if;
end $$;
