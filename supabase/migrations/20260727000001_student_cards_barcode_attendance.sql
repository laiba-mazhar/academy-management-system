-- Student ID cards + barcode sign-in desk.
--
-- Adds:
--   1. A third role, 'attendance' — a kiosk account for the front desk that can
--      do exactly one thing: record a sign-in from a scanned student card.
--   2. students.barcode — a permanent, auto-assigned card number, so every
--      student (existing and future) has a printable ID card without anyone
--      having to type a number in.
--   3. scan_student_attendance() — the single RPC the scanner screen calls. It
--      is SECURITY DEFINER on purpose: the kiosk account has no direct read
--      access to students/invoices, so a compromised kiosk terminal can only
--      look up a student by a card number it already physically has, never
--      enumerate the roll or the fee ledger.

-- 1) role: 'attendance' joins 'admin' and 'teacher'.
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('admin', 'teacher', 'attendance'));

-- 2) barcode / card number.
create sequence if not exists student_barcode_seq;

alter table students add column if not exists barcode text unique;

create or replace function public.assign_student_barcode()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Only ever assigned, never re-assigned: a printed card must stay valid for
  -- the life of the student record.
  if new.barcode is null or btrim(new.barcode) = '' then
    new.barcode := 'MKT' || lpad(nextval('student_barcode_seq')::text, 6, '0');
  else
    new.barcode := upper(btrim(new.barcode));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_assign_student_barcode on students;
create trigger trg_assign_student_barcode
  before insert on students
  for each row execute function assign_student_barcode();

-- Backfill students admitted before card numbers existed, oldest first so the
-- numbering roughly follows admission order.
do $$
declare
  r record;
begin
  for r in select id from students where barcode is null order by created_at, id loop
    update students
      set barcode = 'MKT' || lpad(nextval('student_barcode_seq')::text, 6, '0')
      where id = r.id;
  end loop;
end;
$$;

alter table students alter column barcode set not null;

-- A card number must not be silently changed once cards are printed.
create or replace function public.prevent_barcode_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.barcode is distinct from old.barcode then
    raise exception 'A student card number cannot be changed once assigned';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_barcode_change on students;
create trigger trg_prevent_barcode_change
  before update on students
  for each row execute function prevent_barcode_change();

-- 3) The scan RPC.
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
  v_status text;
  v_student students%rowtype;
  v_class_name text;
  v_date date;
  v_existing attendance%rowtype;
  v_signed_in timestamptz;
  v_already boolean := false;
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

  v_status := coalesce(nullif(btrim(lower(p_status)), ''), 'present');
  if v_status not in ('present', 'absent', 'late') then
    v_status := 'present';
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

  -- The terminal's own calendar date is used (the server clock runs in UTC and
  -- would roll the day over mid-evening local time), but only when it is within
  -- a day of the server's — a wrong terminal clock can't backdate a register.
  v_date := coalesce(p_local_date, current_date);
  if v_date > current_date + 1 or v_date < current_date - 1 then
    v_date := current_date;
  end if;

  select * into v_existing from attendance where student_id = v_student.id and date = v_date;
  if found then
    v_already := true;
    v_signed_in := v_existing.created_at;
    v_status := v_existing.status;
  else
    insert into attendance (student_id, class_id, date, status, marked_by)
    values (v_student.id, v_student.class_id, v_date, v_status, auth.uid())
    on conflict (student_id, date) do nothing
    returning created_at into v_signed_in;

    -- Lost the race against a second scanner: fall back to the row that won.
    if v_signed_in is null then
      select * into v_existing from attendance where student_id = v_student.id and date = v_date;
      v_already := true;
      v_signed_in := v_existing.created_at;
      v_status := v_existing.status;
    end if;
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
      'status', v_status,
      'signed_in_at', v_signed_in,
      'already_marked', v_already
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

-- The kiosk account marks attendance through the RPC above (which runs as the
-- function owner), but it must also be able to correct/see nothing else — no
-- direct policy is added for students, classes, invoices or attendance, so
-- role 'attendance' can read only its own profiles row.
