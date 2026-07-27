-- Front-desk attendance (barcode scanner) account.
--
-- Run this in the Supabase SQL Editor AFTER creating the auth user in the
-- dashboard: Authentication -> Users -> Add user
--   Email:    attendance@maktab.edu.pk
--   Password: Maktab@Scan2026
--   Auto Confirm User: ON
--
-- (Creating the auth user through the dashboard rather than by inserting into
-- auth.users directly keeps this working across Supabase Auth versions.)
--
-- This is idempotent — re-running it just re-asserts the role.

insert into profiles (id, role, full_name, email, must_reset_password)
select id, 'attendance', 'Attendance Desk', email, false
from auth.users
where email = 'attendance@maktab.edu.pk'
on conflict (id) do update
  set role = 'attendance',
      full_name = 'Attendance Desk',
      must_reset_password = false;

-- Sanity check — should return exactly one row with role = 'attendance'.
select id, role, full_name, email from profiles where role = 'attendance';
