-- Phase 8 polish: additional defense-in-depth integrity checks.
-- Run this after 20260714000001-4 (safe to run once on a database that
-- already has those applied).

-- Replace the role-escalation trigger with one that also protects `email`:
-- a teacher could otherwise edit their own profiles.email to a value that no
-- longer matches their actual auth.users login email, which would silently
-- desync the admin-facing directory (not a data-access bypass, but a data
-- integrity foot-gun worth closing now that the app is fuller-featured).
create or replace function public.prevent_role_escalation()
returns trigger
language plpgsql
as $$
begin
  if not is_admin() then
    if new.role is distinct from old.role then
      raise exception 'Only admins can change a profile role';
    end if;
    if new.email is distinct from old.email then
      raise exception 'Only admins can change a profile email';
    end if;
  end if;
  return new;
end;
$$;
-- trigger already exists from migration 0004 and points at this function by
-- name, so redefining the function body is enough; no trigger change needed.

-- Cross-table class_id consistency: the app always derives class_id from the
-- related subject/student rather than letting the client set it directly,
-- but nothing enforced that at the database level for a direct API call.
-- These triggers make mismatched data impossible to write regardless of caller.

create or replace function public.check_question_class_matches_subject()
returns trigger
language plpgsql
as $$
declare
  v_class_id uuid;
begin
  select class_id into v_class_id from subjects where id = new.subject_id;
  if v_class_id is null or v_class_id is distinct from new.class_id then
    raise exception 'class_id must match the subject''s class';
  end if;
  return new;
end;
$$;

create trigger trg_check_question_class
  before insert or update on questions
  for each row execute function check_question_class_matches_subject();

create or replace function public.check_exam_class_matches_subject()
returns trigger
language plpgsql
as $$
declare
  v_class_id uuid;
begin
  select class_id into v_class_id from subjects where id = new.subject_id;
  if v_class_id is null or v_class_id is distinct from new.class_id then
    raise exception 'class_id must match the subject''s class';
  end if;
  return new;
end;
$$;

create trigger trg_check_exam_class
  before insert or update on exams
  for each row execute function check_exam_class_matches_subject();

create or replace function public.check_timetable_class_matches_subject()
returns trigger
language plpgsql
as $$
declare
  v_class_id uuid;
begin
  select class_id into v_class_id from subjects where id = new.subject_id;
  if v_class_id is null or v_class_id is distinct from new.class_id then
    raise exception 'class_id must match the subject''s class';
  end if;
  return new;
end;
$$;

create trigger trg_check_timetable_class
  before insert or update on timetable
  for each row execute function check_timetable_class_matches_subject();

create or replace function public.check_attendance_class_matches_student()
returns trigger
language plpgsql
as $$
declare
  v_class_id uuid;
begin
  select class_id into v_class_id from students where id = new.student_id;
  if v_class_id is null or v_class_id is distinct from new.class_id then
    raise exception 'class_id must match the student''s class';
  end if;
  return new;
end;
$$;

create trigger trg_check_attendance_class
  before insert or update on attendance
  for each row execute function check_attendance_class_matches_student();

create or replace function public.check_invoice_class_matches_student()
returns trigger
language plpgsql
as $$
declare
  v_class_id uuid;
begin
  select class_id into v_class_id from students where id = new.student_id;
  if v_class_id is null or v_class_id is distinct from new.class_id then
    raise exception 'class_id must match the student''s class';
  end if;
  return new;
end;
$$;

create trigger trg_check_invoice_class
  before insert or update on invoices
  for each row execute function check_invoice_class_matches_student();
