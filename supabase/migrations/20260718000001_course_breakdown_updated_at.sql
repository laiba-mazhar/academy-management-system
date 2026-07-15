-- Tracks when a course breakdown plan was last edited, surfaced on both the
-- teacher's own view and the admin overview.
alter table course_breakdowns add column if not exists updated_at timestamptz not null default now();

create or replace function public.set_course_breakdown_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_course_breakdown_updated_at on course_breakdowns;
create trigger trg_course_breakdown_updated_at
  before update on course_breakdowns
  for each row execute function set_course_breakdown_updated_at();
