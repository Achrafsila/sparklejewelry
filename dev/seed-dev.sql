-- Local development only: the test admin account used by the dev stub and the E2E tests.
-- Its sign-in details live in dev/users.json.
insert into auth.users (id, email)
values ('00000000-0000-4000-8000-000000000001', 'admin@sparkle.test')
on conflict do nothing;

insert into public.admins (user_id)
values ('00000000-0000-4000-8000-000000000001')
on conflict do nothing;
