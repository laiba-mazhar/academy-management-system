-- Check-in / check-out on the attendance desk.
--
-- Until now a scan was a single event: the first card of the day inserted
-- 'present' and every later scan was a no-op ("already marked"). That could not
-- answer any of the questions the office actually asks — when did the student
-- arrive, how late were they, did they stay, and what do we do about the child
-- who forgot to scan in and only scanned on the way out.
--
-- The register keeps ONE row per student per day (the unique (student_id, date)
-- constraint stands) and the status vocabulary is deliberately unchanged —
-- 'present' | 'absent' | 'late'. Every report in the app counts present OR late
-- as attended, so adding times and a review flag alongside them changes no
-- existing percentage, PDF, or monthly summary.
--
-- What a scan means is decided by what is already on the row:
--   * no row yet, and it is still plausibly arrival time  -> check-in
--   * no row yet, but arrival time is long past           -> check-out, with the
--     check-in recorded as missing rather than invented
--   * row already has a check-in                          -> check-out (moves
--     later on each re-scan, so the last card of the day wins)

-- 1) Tunables. These are academy policy, not engineering constants, so they sit
--    next to the existing defaulter threshold where an admin can edit them.
alter table attendance_settings
  add column if not exists timezone text not null default 'Asia/Karachi',
  add column if not exists default_start_time time not null default '08:00',
  add column if not exists grace_minutes int not null default 15
    check (grace_minutes >= 0),
  add column if not exists very_late_minutes int not null default 60
    check (very_late_minutes >= 0),
  add column if not exists arrival_cutoff_minutes int not null default 180
    check (arrival_cutoff_minutes > 0),
  add column if not exists min_stay_minutes int not null default 45
    check (min_stay_minutes >= 0),
  add column if not exists rescan_window_seconds int not null default 90
    check (rescan_window_seconds >= 0);

comment on column attendance_settings.grace_minutes is
  'Minutes after the scheduled start still counted as on time.';
comment on column attendance_settings.very_late_minutes is
  'Past this many minutes late, the arrival is flagged for the office.';
comment on column attendance_settings.arrival_cutoff_minutes is
  'Past this many minutes after the scheduled start, a first scan is read as a departure, not an arrival.';
comment on column attendance_settings.min_stay_minutes is
  'A day shorter than this between check-in and check-out is flagged as a short stay.';
comment on column attendance_settings.rescan_window_seconds is
  'A second read of the same card inside this window is a scanner bounce, not a check-out.';

-- 2) The register grows times and a review reason.
alter table attendance
  add column if not exists check_in_at timestamptz,
  add column if not exists check_out_at timestamptz,
  add column if not exists late_minutes int;

alter table attendance drop constraint if exists attendance_review_reason_check;
alter table attendance
  add column if not exists review_reason text;
alter table attendance
  add constraint attendance_review_reason_check
  check (review_reason is null or review_reason in ('no_check_in', 'very_late', 'short_stay'));

comment on column attendance.review_reason is
  'Set when the office should look at this row. A missing check-OUT is not stored here — it is simply check_in_at is not null and check_out_at is null, which is only meaningful once the day is over.';

-- Rows written before this migration only ever recorded an arrival, and only
-- when somebody was actually there.
update attendance
  set check_in_at = created_at
  where check_in_at is null and status <> 'absent';

create index if not exists attendance_review_reason_idx
  on attendance (date) where review_reason is not null;

-- 3) The scheduled window for a class on a given weekday. A class can have
--    several timetable rows in a day; the day starts at the earliest and ends
--    at the latest. Returns nulls when the class has no timetable for that day,
--    and the caller falls back to the academy default.
create or replace function public.class_day_window(p_class_id uuid, p_date date)
returns table (starts_at time, ends_at time)
language sql
stable
set search_path = public
as $$
  select min(start_time), max(end_time)
  from timetable
  where class_id = p_class_id
    and day_of_week = extract(dow from p_date)::smallint;
$$;

-- 4) The scan RPC, now two-directional. The signature is unchanged so the
--    existing grant and the kiosk's call site keep working. p_status is retained
--    only for that compatibility and is no longer read: the status is now
--    derived from when the card was actually presented, and a desk operator
--    typing a status would only be guessing at what the clock already knows.
create or replace function public.scan_student_attendance(
  p_barcode text,
  p_local_date date default null,
  p_status text default 'present'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_code text;
  v_student students%rowtype;
  v_class_name text;
  v_date date;
  v_existing attendance%rowtype;
  v_action text;
  v_status text;
  v_review text;
  v_check_in timestamptz;
  v_check_out timestamptz;
  v_late_minutes int;
  v_minutes_present int;
  -- settings
  v_tz text;
  v_default_start time;
  v_grace int;
  v_very_late int;
  v_cutoff int;
  v_min_stay int;
  v_rescan int;
  -- schedule
  v_sched_start time;
  v_sched_end time;
  v_start time;
  v_local_now timestamp;
  v_last timestamptz;
  v_overdue_total numeric := 0;
  v_overdue_months text[] := '{}';
  v_due_now numeric := 0;
  v_admission_due numeric := 0;
  v_security_due numeric := 0;
begin
  select role into v_role from profiles where id = auth.uid();
  if v_role is null or v_role not in ('admin', 'attendance') then
    raise exception 'Not authorized to record barcode attendance';
  end if;

  v_code := upper(btrim(coalesce(p_barcode, '')));
  if v_code = '' then
    return jsonb_build_object('ok', false, 'error', 'empty',
      'message', 'Scan a student card, or type its number.');
  end if;

  select * into v_student from students where barcode = v_code;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found', 'barcode', v_code,
      'message', 'No student is registered to card ' || v_code || '.');
  end if;

  if v_student.enrollment_status <> 'enrolled' then
    return jsonb_build_object('ok', false, 'error', 'not_enrolled', 'barcode', v_code,
      'student_name', v_student.full_name,
      'message', v_student.full_name || ' is marked "' || v_student.enrollment_status ||
                 '" and is not on the active roll.');
  end if;

  if v_student.class_id is null then
    return jsonb_build_object('ok', false, 'error', 'no_class', 'barcode', v_code,
      'student_name', v_student.full_name,
      'message', v_student.full_name || ' is not assigned to a class, so attendance cannot be recorded.');
  end if;

  select name into v_class_name from classes where id = v_student.class_id;

  select timezone, default_start_time, grace_minutes, very_late_minutes,
         arrival_cutoff_minutes, min_stay_minutes, rescan_window_seconds
    into v_tz, v_default_start, v_grace, v_very_late, v_cutoff, v_min_stay, v_rescan
  from attendance_settings where id = 1;

  -- The terminal's own calendar date is used (the server clock runs in UTC and
  -- would roll the day over mid-evening local time), but only when it is within
  -- a day of the server's — a wrong terminal clock can't backdate a register.
  v_date := coalesce(p_local_date, current_date);
  if v_date > current_date + 1 or v_date < current_date - 1 then
    v_date := current_date;
  end if;

  -- Lateness is a wall-clock question, so it is asked in academy time, not UTC.
  v_local_now := now() at time zone v_tz;

  select starts_at, ends_at into v_sched_start, v_sched_end
  from class_day_window(v_student.class_id, v_date);
  v_start := coalesce(v_sched_start, v_default_start);

  select * into v_existing from attendance where student_id = v_student.id and date = v_date;

  if found and (v_existing.check_in_at is not null or v_existing.check_out_at is not null) then
    -- A scan already happened today. Guard the scanner bounce first: a card read
    -- twice in the same breath is one person, not an arrival and a departure.
    v_last := coalesce(v_existing.check_out_at, v_existing.check_in_at);
    if v_last is not null and now() - v_last < make_interval(secs => v_rescan) then
      v_action := 'duplicate';
      v_check_in := v_existing.check_in_at;
      v_check_out := v_existing.check_out_at;
      v_status := v_existing.status;
      v_review := v_existing.review_reason;
      v_late_minutes := v_existing.late_minutes;
    else
      -- Otherwise this is the way out. The last card of the day wins, so a
      -- student who steps out and comes back simply moves their departure later.
      v_action := 'check_out';
      v_check_in := v_existing.check_in_at;
      v_check_out := now();
      v_status := v_existing.status;
      v_late_minutes := v_existing.late_minutes;
      v_review := v_existing.review_reason;

      if v_check_in is not null
         and v_check_out - v_check_in < make_interval(mins => v_min_stay)
         and v_review is null then
        v_review := 'short_stay';
      end if;

      update attendance
        set check_out_at = v_check_out,
            review_reason = v_review
        where id = v_existing.id;
    end if;

  else
    -- No scan yet today. How late it already is decides whether this card can
    -- honestly be read as an arrival at all.
    v_late_minutes := floor(extract(epoch from (v_local_now::time - v_start)) / 60)::int;

    if v_late_minutes > v_cutoff then
      -- Far too late to be arriving: this is somebody leaving who never scanned
      -- in. Their presence is real and counts, but the arrival time is unknown
      -- and is left null rather than guessed — the office confirms it.
      v_action := 'check_out';
      v_status := 'present';
      v_review := 'no_check_in';
      v_check_in := null;
      v_check_out := now();
      v_late_minutes := null;
    else
      v_action := 'check_in';
      v_status := case when v_late_minutes > v_grace then 'late' else 'present' end;
      v_review := case when v_late_minutes > v_very_late then 'very_late' else null end;
      v_check_in := now();
      v_check_out := null;
      v_late_minutes := greatest(v_late_minutes, 0);
    end if;

    if found then
      -- A teacher had already marked the register by hand. The student is
      -- standing at the desk, so the scan is the better evidence and wins.
      update attendance
        set status = v_status,
            check_in_at = v_check_in,
            check_out_at = v_check_out,
            late_minutes = v_late_minutes,
            review_reason = v_review
        where id = v_existing.id;
    else
      insert into attendance (student_id, class_id, date, status, marked_by,
                              check_in_at, check_out_at, late_minutes, review_reason)
      values (v_student.id, v_student.class_id, v_date, v_status, auth.uid(),
              v_check_in, v_check_out, v_late_minutes, v_review)
      on conflict (student_id, date) do nothing;

      if not found then
        -- Lost the race against a second scanner: fall back to the row that won
        -- rather than overwriting a colleague's insert.
        select * into v_existing from attendance
          where student_id = v_student.id and date = v_date;
        if v_existing.id is not null then
          v_action := 'duplicate';
          v_status := v_existing.status;
          v_check_in := v_existing.check_in_at;
          v_check_out := v_existing.check_out_at;
          v_late_minutes := v_existing.late_minutes;
          v_review := v_existing.review_reason;
        end if;
      end if;
    end if;
  end if;

  if v_check_in is not null and v_check_out is not null then
    v_minutes_present := floor(extract(epoch from (v_check_out - v_check_in)) / 60)::int;
  else
    v_minutes_present := null;
  end if;

  -- Overdue = an unpaid invoice whose due date has passed, or (when no due date
  -- was set) one for a month that has already ended.
  select
    coalesce(sum(greatest(amount - discount, 0)), 0),
    coalesce(array_agg(to_char(month, 'Mon YYYY') order by month), '{}'::text[])
  into v_overdue_total, v_overdue_months
  from invoices
  where student_id = v_student.id
    and status <> 'paid'
    and (
      (due_date is not null and due_date < v_date)
      or (due_date is null and month < date_trunc('month', v_date)::date)
    );

  select coalesce(sum(greatest(amount - discount, 0)), 0)
  into v_due_now
  from invoices
  where student_id = v_student.id
    and status <> 'paid'
    and not (
      (due_date is not null and due_date < v_date)
      or (due_date is null and month < date_trunc('month', v_date)::date)
    );

  if not v_student.admission_fee_paid then
    v_admission_due := v_student.admission_fee_amount;
  end if;
  if not v_student.security_fee_paid then
    v_security_due := v_student.security_fee_amount;
  end if;

  return jsonb_build_object(
    'ok', true,
    'student', jsonb_build_object(
      'id', v_student.id,
      'full_name', v_student.full_name,
      'barcode', v_student.barcode,
      'class_name', v_class_name,
      'guardian_name', v_student.guardian_name,
      'guardian_phone', v_student.guardian_phone
    ),
    'attendance', jsonb_build_object(
      'date', v_date,
      'action', v_action,
      'status', v_status,
      'check_in_at', v_check_in,
      'check_out_at', v_check_out,
      'late_minutes', v_late_minutes,
      'minutes_present', v_minutes_present,
      'review_reason', v_review,
      'scheduled_start', v_start,
      'scheduled_end', v_sched_end,
      -- Kept so a desk running the previous bundle against this migration still
      -- renders a sensible confirmation instead of a blank card.
      'signed_in_at', coalesce(v_check_in, v_check_out),
      'already_marked', v_action = 'duplicate'
    ),
    'fee', jsonb_build_object(
      'overdue', v_overdue_total > 0,
      'overdue_amount', v_overdue_total,
      'overdue_months', to_jsonb(v_overdue_months),
      'due_now_amount', v_due_now,
      'admission_fee_due', v_admission_due,
      'security_fee_due', v_security_due
    )
  );
end;
$$;

revoke all on function public.scan_student_attendance(text, date, text) from public;
grant execute on function public.scan_student_attendance(text, date, text) to authenticated;
revoke all on function public.class_day_window(uuid, date) from public;
grant execute on function public.class_day_window(uuid, date) to authenticated;
