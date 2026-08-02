-- The printed question paper carries a "TIME 1 HOUR" line in its header, and
-- the exam row had nowhere to store it. Nullable because every exam created
-- before this migration has no recorded duration, and a paper simply omits the
-- TIME line rather than inventing one.
alter table exams add column if not exists duration_minutes integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'exams_duration_minutes_positive'
  ) then
    alter table exams
      add constraint exams_duration_minutes_positive
      check (duration_minutes is null or duration_minutes > 0);
  end if;
end $$;

comment on column exams.duration_minutes is
  'Allowed time for the exam, in minutes. Printed as "TIME 1 HOUR" on the question paper header. Null hides the line.';
