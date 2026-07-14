-- Adds: per-student fee override + admission/security fee tracking,
-- teacher (staff) attendance, and the course-breakdown planner.

alter table students add column if not exists fee_override numeric(10, 2) check (fee_override is null or fee_override >= 0);
alter table students add column if not exists admission_fee_amount numeric(10, 2) not null default 0 check (admission_fee_amount >= 0);
alter table students add column if not exists admission_fee_paid boolean not null default false;
alter table students add column if not exists security_fee_amount numeric(10, 2) not null default 0 check (security_fee_amount >= 0);
alter table students add column if not exists security_fee_paid boolean not null default false;

-- Teacher (staff) attendance — mirrors the student attendance table but for staff.
create table if not exists teacher_attendance (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references teachers(id) on delete cascade,
  date date not null,
  status text not null check (status in ('present', 'absent', 'late')),
  marked_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (teacher_id, date)
);

create index if not exists teacher_attendance_teacher_id_idx on teacher_attendance (teacher_id);
create index if not exists teacher_attendance_date_idx on teacher_attendance (date);

alter table teacher_attendance enable row level security;

create policy teacher_attendance_select on teacher_attendance for select
  using (is_admin() or teacher_id = auth.uid());

create policy teacher_attendance_admin_write on teacher_attendance for insert
  with check (is_admin());

create policy teacher_attendance_admin_update on teacher_attendance for update
  using (is_admin())
  with check (is_admin());

create policy teacher_attendance_admin_delete on teacher_attendance for delete
  using (is_admin());

-- Course breakdown planner: one plan per subject (a teacher's pacing schedule
-- for the chapters they'll cover), broken into weekly/biweekly/monthly slots.
create table if not exists course_breakdowns (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references subjects(id) on delete cascade,
  planner_type text not null check (planner_type in ('weekly', 'biweekly', 'monthly')),
  total_chapters int not null check (total_chapters > 0),
  start_date date not null,
  end_date date not null check (end_date > start_date),
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists course_breakdowns_subject_id_idx on course_breakdowns (subject_id);

create table if not exists course_breakdown_slots (
  id uuid primary key default gen_random_uuid(),
  course_breakdown_id uuid not null references course_breakdowns(id) on delete cascade,
  slot_number int not null,
  slot_start date not null,
  slot_end date not null,
  chapters text,
  is_done boolean not null default false,
  unique (course_breakdown_id, slot_number)
);

alter table course_breakdowns enable row level security;
alter table course_breakdown_slots enable row level security;

create policy course_breakdowns_select on course_breakdowns for select
  using (is_admin() or subject_id in (select teacher_subject_ids()));

create policy course_breakdowns_insert on course_breakdowns for insert
  with check (subject_id in (select teacher_subject_ids()));

create policy course_breakdowns_update on course_breakdowns for update
  using (subject_id in (select teacher_subject_ids()))
  with check (subject_id in (select teacher_subject_ids()));

create policy course_breakdowns_delete on course_breakdowns for delete
  using (is_admin() or subject_id in (select teacher_subject_ids()));

create policy course_breakdown_slots_select on course_breakdown_slots for select
  using (
    is_admin()
    or course_breakdown_id in (select id from course_breakdowns where subject_id in (select teacher_subject_ids()))
  );

create policy course_breakdown_slots_insert on course_breakdown_slots for insert
  with check (
    course_breakdown_id in (select id from course_breakdowns where subject_id in (select teacher_subject_ids()))
  );

create policy course_breakdown_slots_update on course_breakdown_slots for update
  using (
    course_breakdown_id in (select id from course_breakdowns where subject_id in (select teacher_subject_ids()))
  )
  with check (
    course_breakdown_id in (select id from course_breakdowns where subject_id in (select teacher_subject_ids()))
  );

create policy course_breakdown_slots_delete on course_breakdown_slots for delete
  using (
    is_admin()
    or course_breakdown_id in (select id from course_breakdowns where subject_id in (select teacher_subject_ids()))
  );
