-- Tracks month-end attendance+exam report emails sent to guardians, so the
-- admin UI can show what's already gone out and avoid duplicate sends once
-- this moves from manual testing to automated sending.
create table monthly_reports (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  month date not null, -- normalized to the 1st of the month
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (student_id, month)
);

create index on monthly_reports (student_id);

alter table monthly_reports enable row level security;

create policy monthly_reports_admin_all on monthly_reports for all
  using (is_admin())
  with check (is_admin());
