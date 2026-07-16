-- Students: allow marking a student as 'left'. History (fees, attendance, exam
-- results) stays linked to the same student_id; the app filters left students
-- out of active lists rather than moving/deleting rows.
alter table students drop constraint students_enrollment_status_check;
alter table students add constraint students_enrollment_status_check
  check (enrollment_status in ('enrolled', 'inactive', 'graduated', 'left'));

-- Teachers: mirror the same status flag so departed teachers can be hidden
-- from active lists while their salary/attendance history stays intact.
alter table teachers add column if not exists status text not null default 'active'
  check (status in ('active', 'left'));

create or replace function public.prevent_teacher_status_change_by_non_admin()
returns trigger
language plpgsql
as $$
begin
  if not is_admin() and new.status is distinct from old.status then
    raise exception 'Only admins can change a teacher''s status';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_teacher_status_change on teachers;
create trigger trg_prevent_teacher_status_change
  before update on teachers
  for each row execute function prevent_teacher_status_change_by_non_admin();

-- Invoices: admin-editable discount applied on top of the invoice amount, so
-- fee challans can show remaining vs. discounted vs. actually-to-be-paid.
alter table invoices add column if not exists discount numeric(10, 2) not null default 0 check (discount >= 0);
