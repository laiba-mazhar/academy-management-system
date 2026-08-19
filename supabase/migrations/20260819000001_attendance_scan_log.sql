-- Every scan is kept, and the daily register becomes a summary of them.
--
-- The previous version stored one row per student per day and moved
-- check_out_at forward on each later scan. That lost real events: a student who
-- signed out at break and came back was recorded as having signed out again,
-- and the desk's own list of recent scans lived only in React state, so a
-- reboot or a re-login emptied it.
--
-- attendance_events is now the record of what physically happened — append
-- only, one row per card read, never rewritten. The attendance row stays
-- exactly where it was, one per student per day, and is recomputed from the
-- log; every report, percentage and PDF keeps reading the same columns it
-- always has.

create table if not exists attendance_events (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  class_id uuid not null references classes(id) on delete cascade,
  -- The academy-local day this scan belongs to, matching attendance.date.
  date date not null,
  kind text not null check (kind in ('check_in', 'check_out')),
  scanned_at timestamptz not null default now(),
  recorded_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists attendance_events_student_day_idx
  on attendance_events (student_id, date, scanned_at);
create index if not exists attendance_events_day_idx
  on attendance_events (date, scanned_at desc);

-- Total time actually inside the building: the sum of every in/out pair, so a
-- student who leaves at break and returns is credited for both sittings rather
-- than for the gap between the first card and the last.
alter table attendance
  add column if not exists minutes_present int;

comment on column attendance.minutes_present is
  'Sum of all check-in -> check-out pairs for the day. Null until a pair is closed.';

-- Existing rows only ever held one arrival and one departure, which is exactly
-- one event each.
insert into attendance_events (student_id, class_id, date, kind, scanned_at, recorded_by)
select student_id, class_id, date, 'check_in', check_in_at, marked_by
from attendance
where check_in_at is not null
  and not exists (
    select 1 from attendance_events e
    where e.student_id = attendance.student_id and e.date = attendance.date and e.kind = 'check_in'
  );

insert into attendance_events (student_id, class_id, date, kind, scanned_at, recorded_by)
select student_id, class_id, date, 'check_out', check_out_at, marked_by
from attendance
where check_out_at is not null
  and not exists (
    select 1 from attendance_events e
    where e.student_id = attendance.student_id and e.date = attendance.date and e.kind = 'check_out'
  );

alter table attendance_events enable row level security;

-- The log is written only through the scan RPC (which runs as its owner), so no
-- insert/update/delete policy exists for anybody. Admins and the student's own
-- teachers can read it.
drop policy if exists attendance_events_select on attendance_events;
create policy attendance_events_select on attendance_events for select
  using (is_admin() or exists (
    select 1 from subjects s
    where s.class_id = attendance_events.class_id and s.teacher_id = auth.uid()
  ));

-- Rebuild one day's summary row from the log. This is the only thing that
-- writes attendance.check_in_at / check_out_at / minutes_present, so the
-- summary can never drift from the events it is derived from.
create or replace function public.refresh_attendance_day(
  p_student_id uuid,
  p_class_id uuid,
  p_date date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tz text;
  v_default_start time;
  v_grace int;
  v_very_late int;
  v_min_stay int;
  v_sched_start time;
  v_start time;
  v_first_in timestamptz;
  v_last_out timestamptz;
  v_minutes int;
  v_late int;
  v_status text;
  v_review text;
begin
  select timezone, default_start_time, grace_minutes, very_late_minutes, min_stay_minutes
    into v_tz, v_default_start, v_grace, v_very_late, v_min_stay
  from attendance_settings where id = 1;

  select min(scanned_at) filter (where kind = 'check_in'),
         max(scanned_at) filter (where kind = 'check_out')
    into v_first_in, v_last_out
  from attendance_events
  where student_id = p_student_id and date = p_date;

  -- Nothing was scanned: leave whatever a teacher marked by hand alone.
  if v_first_in is null and v_last_out is null then
    return;
  end if;

  select starts_at into v_sched_start from class_day_window(p_class_id, p_date);
  v_start := coalesce(v_sched_start, v_default_start);

  -- Pair each arrival with the departure that follows it. An unclosed final
  -- check-in contributes nothing until the student actually leaves.
  select sum(extract(epoch from (next_at - scanned_at)) / 60)::int
    into v_minutes
  from (
    select scanned_at, kind,
           lead(scanned_at) over (order by scanned_at, kind) as next_at,
           lead(kind) over (order by scanned_at, kind) as next_kind
    from attendance_events
    where student_id = p_student_id and date = p_date
  ) paired
  where kind = 'check_in' and next_kind = 'check_out';

  if v_first_in is null then
    -- Only ever scanned on the way out. The student was here, so it counts, but
    -- the arrival time is genuinely unknown and is not invented.
    v_late := null;
    v_status := 'present';
    v_review := 'no_check_in';
  else
    v_late := greatest(floor(extract(epoch from ((v_first_in at time zone v_tz)::time - v_start)) / 60)::int, 0);
    v_status := case when v_late > v_grace then 'late' else 'present' end;
    v_review := case when v_late > v_very_late then 'very_late' else null end;
  end if;

  if v_review is null and v_minutes is not null and v_minutes < v_min_stay then
    v_review := 'short_stay';
  end if;

  insert into attendance (student_id, class_id, date, status,
                          check_in_at, check_out_at, minutes_present, late_minutes, review_reason)
  values (p_student_id, p_class_id, p_date, v_status,
          v_first_in, v_last_out, v_minutes, v_late, v_review)
  on conflict (student_id, date) do update
    set status = excluded.status,
        check_in_at = excluded.check_in_at,
        check_out_at = excluded.check_out_at,
        minutes_present = excluded.minutes_present,
        late_minutes = excluded.late_minutes,
        review_reason = excluded.review_reason;
end;
$$;

-- Bring the summary columns in line with the backfilled log.
do $$
declare r record;
begin
  for r in select distinct student_id, class_id, date from attendance_events loop
    perform refresh_attendance_day(r.student_id, r.class_id, r.date);
  end loop;
end;
$$;

-- The scan RPC. Signature unchanged, so the existing grant and the kiosk's call
-- site keep working. p_status is retained for that compatibility only: the
-- status is derived from the log, never typed in at the desk.
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
  v_row attendance%rowtype;
  v_action text;
  v_kind text;
  v_scanned_at timestamptz;
  v_session_minutes int;
  v_entry_count int;
  v_last_kind text;
  v_last_at timestamptz;
  v_tz text;
  v_default_start time;
  v_cutoff int;
  v_rescan int;
  v_sched_start time;
  v_sched_end time;
  v_start time;
  v_late int;
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

  select timezone, default_start_time, arrival_cutoff_minutes, rescan_window_seconds
    into v_tz, v_default_start, v_cutoff, v_rescan
  from attendance_settings where id = 1;

  -- The terminal's own calendar date is used (the server clock runs in UTC and
  -- would roll the day over mid-evening local time), but only when it is within
  -- a day of the server's, so a wrong terminal clock cannot backdate a register.
  v_date := coalesce(p_local_date, current_date);
  if v_date > current_date + 1 or v_date < current_date - 1 then
    v_date := current_date;
  end if;

  select kind, scanned_at into v_last_kind, v_last_at
  from attendance_events
  where student_id = v_student.id and date = v_date
  order by scanned_at desc, kind desc
  limit 1;

  -- A card read twice in the same breath is one person, not two events.
  if v_last_at is not null and now() - v_last_at < make_interval(secs => v_rescan) then
    v_action := 'duplicate';
    v_scanned_at := v_last_at;
  else
    if v_last_kind is null then
      -- Nothing scanned yet today. How late it already is decides whether this
      -- card can honestly be read as an arrival at all.
      select starts_at into v_sched_start from class_day_window(v_student.class_id, v_date);
      v_start := coalesce(v_sched_start, v_default_start);
      v_late := floor(extract(epoch from ((now() at time zone v_tz)::time - v_start)) / 60)::int;
      -- Far too late to be arriving: somebody is leaving who never scanned in.
      v_kind := case when v_late > v_cutoff then 'check_out' else 'check_in' end;
    else
      -- Otherwise a scan simply flips the student's state, so leaving at break
      -- and coming back is two more events rather than a rewritten departure.
      v_kind := case when v_last_kind = 'check_in' then 'check_out' else 'check_in' end;
    end if;

    v_scanned_at := now();
    insert into attendance_events (student_id, class_id, date, kind, scanned_at, recorded_by)
    values (v_student.id, v_student.class_id, v_date, v_kind, v_scanned_at, auth.uid());

    perform refresh_attendance_day(v_student.id, v_student.class_id, v_date);
    v_action := v_kind;

    -- How long this particular sitting lasted, which is what the desk wants to
    -- see on the way out, rather than the running total for the day.
    if v_kind = 'check_out' then
      select floor(extract(epoch from (v_scanned_at - max(scanned_at))) / 60)::int
        into v_session_minutes
      from attendance_events
      where student_id = v_student.id and date = v_date
        and kind = 'check_in' and scanned_at < v_scanned_at;
    end if;
  end if;

  select * into v_row from attendance where student_id = v_student.id and date = v_date;
  select count(*) into v_entry_count
  from attendance_events
  where student_id = v_student.id and date = v_date and kind = 'check_in';

  select ends_at into v_sched_end from class_day_window(v_student.class_id, v_date);

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
      'status', v_row.status,
      'scanned_at', v_scanned_at,
      'check_in_at', v_row.check_in_at,
      'check_out_at', v_row.check_out_at,
      'late_minutes', v_row.late_minutes,
      'minutes_present', v_row.minutes_present,
      'session_minutes', v_session_minutes,
      -- How many times the student has signed in today: two or more means they
      -- left and came back, which the desk should be able to see.
      'entry_count', v_entry_count,
      'review_reason', v_row.review_reason,
      'scheduled_end', v_sched_end,
      -- Kept so a desk running an older bundle still renders a sensible card.
      'signed_in_at', coalesce(v_row.check_in_at, v_row.check_out_at),
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

-- The desk's running list, read back from the database instead of held in the
-- browser, so closing the kiosk or signing in again still shows the day's work.
create or replace function public.recent_attendance_scans(
  p_local_date date default null,
  p_limit int default 25
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_date date;
  v_rows jsonb;
begin
  select role into v_role from profiles where id = auth.uid();
  if v_role is null or v_role not in ('admin', 'attendance') then
    raise exception 'Not authorized to read attendance scans';
  end if;

  v_date := coalesce(p_local_date, current_date);
  if v_date > current_date + 1 or v_date < current_date - 1 then
    v_date := current_date;
  end if;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.scanned_at desc), '[]'::jsonb) into v_rows
  from (
    select e.scanned_at,
           e.kind,
           s.full_name,
           c.name as class_name,
           a.review_reason
    from attendance_events e
    join students s on s.id = e.student_id
    left join classes c on c.id = e.class_id
    left join attendance a on a.student_id = e.student_id and a.date = e.date
    where e.date = v_date
    order by e.scanned_at desc
    limit least(greatest(coalesce(p_limit, 25), 1), 200)
  ) r;

  return v_rows;
end;
$$;

revoke all on function public.scan_student_attendance(text, date, text) from public;
grant execute on function public.scan_student_attendance(text, date, text) to authenticated;
revoke all on function public.refresh_attendance_day(uuid, uuid, date) from public;
grant execute on function public.refresh_attendance_day(uuid, uuid, date) to authenticated;
revoke all on function public.recent_attendance_scans(date, int) from public;
grant execute on function public.recent_attendance_scans(date, int) to authenticated;
