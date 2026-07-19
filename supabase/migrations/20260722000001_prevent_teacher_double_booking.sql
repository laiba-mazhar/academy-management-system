-- The admin UI already blocks adding an overlapping slot for a teacher against
-- its own in-memory snapshot of the timetable, but that's only checked at the
-- moment the "Add Slot" form is submitted — two admins saving at nearly the
-- same time (or any other direct write to this table) could still land the
-- same teacher in two different classes at an overlapping time on the same
-- day. Enforce it at the database level so it can never happen regardless of
-- how the row gets written.
create or replace function public.check_teacher_no_double_booking()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1 from timetable
    where teacher_id = new.teacher_id
      and day_of_week = new.day_of_week
      and id is distinct from new.id
      and new.start_time < end_time
      and new.end_time > start_time
  ) then
    raise exception 'This teacher already has another class scheduled at an overlapping time on this day.';
  end if;
  return new;
end;
$$;

create trigger trg_check_teacher_no_double_booking
  before insert or update on timetable
  for each row execute function check_teacher_no_double_booking();
