-- Front-desk attendance (barcode scanner) account.
--
--   Email:    attendance@maktab.edu.pk
--   Password: Maktab@Scan2026
--
-- Paste this whole file into the Supabase SQL Editor and run it. It creates the
-- login, confirms the email, and gives it the 'attendance' role in one go — no
-- dashboard clicking needed.
--
-- Run it AFTER the migrations in supabase/migrations/ (the 'attendance' role
-- only exists once 20260727000001_student_cards_barcode_attendance.sql has run).
--
-- Safe to re-run: an existing account is left in place and only has its
-- password and role re-asserted, so this doubles as a password reset.

do $$
declare
  v_email    text := 'attendance@maktab.edu.pk';
  v_password text := 'Maktab@Scan2026';
  v_name     text := 'Attendance Desk';
  v_uid      uuid;
  v_hash     text;
  v_existing boolean;
begin
  -- Supabase Auth stores a bcrypt hash, which is what crypt()/gen_salt('bf')
  -- produce — the same scheme GoTrue itself uses to verify a password.
  v_hash := crypt(v_password, gen_salt('bf'));

  select id into v_uid from auth.users where lower(email) = lower(v_email);
  v_existing := v_uid is not null;

  if v_existing then
    update auth.users
      set encrypted_password = v_hash,
          email_confirmed_at = coalesce(email_confirmed_at, now()),
          banned_until       = null,
          deleted_at         = null,
          updated_at         = now()
      where id = v_uid;
    raise notice 'Existing account %: password reset.', v_email;
  else
    v_uid := gen_random_uuid();

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
      v_email, v_hash, now(),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      jsonb_build_object('full_name', v_name),
      now(), now(),
      '', '', '', ''
    );
    raise notice 'Created account %.', v_email;
  end if;

  -- GoTrue also expects an identity row for the email provider. Its columns
  -- were renamed across versions (the old text `id` became `provider_id`, and
  -- `id` became a uuid), so pick the shape this project actually has.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'auth' and table_name = 'identities' and column_name = 'provider_id'
  ) then
    execute $q$
      insert into auth.identities (id, user_id, provider_id, identity_data, provider,
                                   last_sign_in_at, created_at, updated_at)
      values (gen_random_uuid(), $1, $1::text,
              jsonb_build_object('sub', $1::text, 'email', $2, 'email_verified', true),
              'email', now(), now(), now())
      on conflict (provider_id, provider) do nothing
    $q$ using v_uid, v_email;
  else
    execute $q$
      insert into auth.identities (id, user_id, identity_data, provider,
                                   last_sign_in_at, created_at, updated_at)
      values ($1::text, $1,
              jsonb_build_object('sub', $1::text, 'email', $2, 'email_verified', true),
              'email', now(), now(), now())
      on conflict do nothing
    $q$ using v_uid, v_email;
  end if;

  -- The app reads the role from public.profiles, not from auth.
  insert into public.profiles (id, role, full_name, email, must_reset_password)
  values (v_uid, 'attendance', v_name, v_email, false)
  on conflict (id) do update
    set role = 'attendance',
        full_name = excluded.full_name,
        email = excluded.email,
        must_reset_password = false;
end;
$$;

-- Should return exactly one row: the kiosk login, email confirmed, role
-- 'attendance', with a matching email-provider identity.
select
  p.email,
  p.role,
  p.full_name,
  (u.email_confirmed_at is not null)                as email_confirmed,
  (u.encrypted_password is not null)                as has_password,
  (select count(*) from auth.identities i where i.user_id = u.id) as identities
from public.profiles p
join auth.users u on u.id = p.id
where p.role = 'attendance';
