-- Defense-in-depth data integrity triggers. RLS controls which rows a role
-- can touch; these triggers control which *columns* a non-admin can change
-- on a row they otherwise have UPDATE access to.

create or replace function public.prevent_role_escalation()
returns trigger
language plpgsql
as $$
begin
  if not is_admin() and new.role is distinct from old.role then
    raise exception 'Only admins can change a profile role';
  end if;
  return new;
end;
$$;

create trigger trg_prevent_role_escalation
  before update on profiles
  for each row execute function prevent_role_escalation();

create or replace function public.prevent_salary_change_by_non_admin()
returns trigger
language plpgsql
as $$
begin
  if not is_admin() and new.monthly_salary is distinct from old.monthly_salary then
    raise exception 'Only admins can change teacher salary';
  end if;
  return new;
end;
$$;

create trigger trg_prevent_salary_change
  before update on teachers
  for each row execute function prevent_salary_change_by_non_admin();

-- exam_results.marks_obtained must never exceed the exam's total_marks
create or replace function public.check_marks_within_total()
returns trigger
language plpgsql
as $$
declare
  v_total numeric;
begin
  select total_marks into v_total from exams where id = new.exam_id;
  if v_total is not null and new.marks_obtained > v_total then
    raise exception 'marks_obtained (%) cannot exceed exam total_marks (%)', new.marks_obtained, v_total;
  end if;
  return new;
end;
$$;

create trigger trg_check_marks_within_total
  before insert or update on exam_results
  for each row execute function check_marks_within_total();
