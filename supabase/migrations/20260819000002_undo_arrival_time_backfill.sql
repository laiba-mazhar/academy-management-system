-- Undo the arrival-time backfill, which invented data.
--
-- 20260818000001 seeded check_in_at from attendance.created_at for every row
-- that was not marked absent, on the assumption that created_at was when the
-- student turned up. It is not. For a register a teacher fills in by hand it is
-- simply when the row was saved — often that evening, sometimes the next day.
-- In production 30 of the 45 backfilled rows carried a "check-in" on a
-- different calendar day from the register date they belonged to.
--
-- 20260819000001 then recomputed each day from those timestamps, which rewrote
-- 39 historical rows to status 'late' with late_minutes between 347 and 875 —
-- up to fourteen hours late — and flagged them all 'very_late'. None of it was
-- true. Attendance percentages, defaulter lists and monthly reports were not
-- affected, because they count 'present' and 'late' alike, but the register
-- displayed lateness that never happened.
--
-- The honest position is that records written before check-in/check-out existed
-- simply do not contain arrival times, and no arrival time should be shown for
-- them. This migration removes what was invented rather than trying to refine
-- it. It is safe to run more than once, and safe on a database that never had
-- the bad backfill (it will match nothing).

-- 1) Drop the backfilled events. A real scan is inserted with scanned_at and
--    created_at both set from the same now(), so they are equal to the
--    microsecond; only a backfilled row can have been written long after the
--    moment it claims to describe. That makes the two distinguishable without
--    guessing, and leaves genuine scans untouched.
delete from attendance_events
where created_at > scanned_at + interval '1 minute';

-- 2) Any day with no events left has no scan evidence behind it, so the derived
--    columns must go back to empty rather than keep values computed from a
--    timestamp that has just been deleted.
--
--    Status is the one thing that cannot be recovered: refresh_attendance_day()
--    overwrote it in place and the original was not kept anywhere. These rows
--    were hand-marked registers, so 'present' is restored as the overwhelmingly
--    likely original. A teacher who had deliberately marked somebody late will
--    need to set that again — which is why only rows the backfill actually
--    touched are altered, and rows marked 'absent' are left strictly alone
--    (they never received a check_in_at and so never had a status recomputed).
update attendance a
set status = case when a.status = 'late' then 'present' else a.status end,
    check_in_at = null,
    check_out_at = null,
    minutes_present = null,
    late_minutes = null,
    review_reason = null
where a.check_in_at is not null
  and not exists (
    select 1 from attendance_events e
    where e.student_id = a.student_id and e.date = a.date
  );
