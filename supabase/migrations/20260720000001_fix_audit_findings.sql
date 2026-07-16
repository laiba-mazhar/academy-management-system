-- Bug-fix migration from a full self-review: protects historical/financial
-- records from silent cascade deletion, closes an RLS gap on course
-- breakdowns, and closes a self-service bypass on the forced password reset.

-- 1) Deleting a class/subject/teacher must not silently destroy financial or
-- historical records. Structural rows (subjects, timetable slots, questions)
-- still cascade — but invoices, attendance, exam results, course breakdowns,
-- salaries, and staff attendance now block the parent delete instead, so an
-- admin has to consciously deal with that history first.
alter table invoices drop constraint invoices_class_id_fkey;
alter table invoices add constraint invoices_class_id_fkey
  foreign key (class_id) references classes(id) on delete restrict;

alter table attendance drop constraint attendance_class_id_fkey;
alter table attendance add constraint attendance_class_id_fkey
  foreign key (class_id) references classes(id) on delete restrict;

alter table exams drop constraint exams_class_id_fkey;
alter table exams add constraint exams_class_id_fkey
  foreign key (class_id) references classes(id) on delete restrict;

alter table exams drop constraint exams_subject_id_fkey;
alter table exams add constraint exams_subject_id_fkey
  foreign key (subject_id) references subjects(id) on delete restrict;

alter table course_breakdowns drop constraint course_breakdowns_subject_id_fkey;
alter table course_breakdowns add constraint course_breakdowns_subject_id_fkey
  foreign key (subject_id) references subjects(id) on delete restrict;

alter table salaries drop constraint salaries_teacher_id_fkey;
alter table salaries add constraint salaries_teacher_id_fkey
  foreign key (teacher_id) references teachers(id) on delete restrict;

alter table teacher_attendance drop constraint teacher_attendance_teacher_id_fkey;
alter table teacher_attendance add constraint teacher_attendance_teacher_id_fkey
  foreign key (teacher_id) references teachers(id) on delete restrict;

-- 2) course_breakdowns / course_breakdown_slots insert & update policies were
-- missing the is_admin() branch that every other table's policies have,
-- leaving admins with no way to write these rows directly.
drop policy if exists course_breakdowns_insert on course_breakdowns;
create policy course_breakdowns_insert on course_breakdowns for insert
  with check (is_admin() or subject_id in (select teacher_subject_ids()));

drop policy if exists course_breakdowns_update on course_breakdowns;
create policy course_breakdowns_update on course_breakdowns for update
  using (is_admin() or subject_id in (select teacher_subject_ids()))
  with check (is_admin() or subject_id in (select teacher_subject_ids()));

drop policy if exists course_breakdown_slots_insert on course_breakdown_slots;
create policy course_breakdown_slots_insert on course_breakdown_slots for insert
  with check (
    is_admin()
    or course_breakdown_id in (select id from course_breakdowns where subject_id in (select teacher_subject_ids()))
  );

drop policy if exists course_breakdown_slots_update on course_breakdown_slots;
create policy course_breakdown_slots_update on course_breakdown_slots for update
  using (
    is_admin()
    or course_breakdown_id in (select id from course_breakdowns where subject_id in (select teacher_subject_ids()))
  )
  with check (
    is_admin()
    or course_breakdown_id in (select id from course_breakdowns where subject_id in (select teacher_subject_ids()))
  );

-- 3) A user could clear their own must_reset_password flag directly (e.g. via
-- the browser console) without ever actually changing their password. Block
-- that column from ordinary client updates; the only self-service path is the
-- clear_must_reset_password() RPC below, which requires auth.users to show a
-- password change in the last couple of minutes (Supabase Auth bumps
-- auth.users.updated_at on supabase.auth.updateUser({ password })).
create or replace function public.prevent_reset_flag_bypass()
returns trigger
language plpgsql
as $$
begin
  if not is_admin() and new.must_reset_password is distinct from old.must_reset_password then
    raise exception 'must_reset_password can only be changed by an admin or after an actual password change';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_reset_flag_bypass on profiles;
create trigger trg_prevent_reset_flag_bypass
  before update on profiles
  for each row execute function prevent_reset_flag_bypass();

create or replace function public.clear_must_reset_password()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  changed_recently boolean;
begin
  select (updated_at > now() - interval '2 minutes') into changed_recently
  from auth.users where id = auth.uid();

  if not coalesce(changed_recently, false) then
    raise exception 'Change your password before clearing the reset flag.';
  end if;

  update public.profiles set must_reset_password = false where id = auth.uid();
end;
$$;

grant execute on function public.clear_must_reset_password() to authenticated;
