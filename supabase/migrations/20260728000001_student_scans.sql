-- QR check-in/check-out at the gate, recorded from a scanning station.
--
-- Kept separate from the existing `attendance` table on purpose: that one is a
-- teacher's daily present/absent/late judgement, while this is a raw record of
-- when a student physically arrived and left. Merging them would lose the
-- distinction between "marked present by a teacher" and "scanned in at 8:02".

-- The scanning station logs in as its own account rather than sharing a
-- teacher's, so gate scans are attributable and the station can be locked down
-- to just this one screen.
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('admin', 'teacher', 'attendance'));

create table if not exists student_scans (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  -- Local calendar date of the scan, so "today's scans" is a plain equality
  -- test that doesn't drift with the server's timezone.
  scan_date date not null,
  check_in_at timestamptz,
  check_out_at timestamptz,
  recorded_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  -- One row per student per day: the first scan sets check_in_at and any later
  -- scan updates check_out_at, so a student can't accumulate duplicate rows by
  -- scanning repeatedly.
  unique (student_id, scan_date)
);

create index if not exists student_scans_date_idx on student_scans (scan_date desc);

alter table student_scans enable row level security;

-- Admins and the attendance station can record scans; teachers can see them
-- (useful when a parent asks what time a child arrived) but not write them.
create policy student_scans_select on student_scans for select
  using (
    exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.role in ('admin', 'teacher', 'attendance')
    )
  );

create policy student_scans_insert on student_scans for insert
  with check (
    exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.role in ('admin', 'attendance')
    )
  );

create policy student_scans_update on student_scans for update
  using (
    exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.role in ('admin', 'attendance')
    )
  );

-- The scanning station needs to resolve a scanned id to a student name and
-- class, so it must be able to read those rows.
drop policy if exists students_select_attendance on students;
create policy students_select_attendance on students for select
  using (
    exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.role = 'attendance'
    )
  );

drop policy if exists classes_select_attendance on classes;
create policy classes_select_attendance on classes for select
  using (
    exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.role = 'attendance'
    )
  );

-- Realtime pushes each scan to the station's screen without polling.
alter publication supabase_realtime add table student_scans;
