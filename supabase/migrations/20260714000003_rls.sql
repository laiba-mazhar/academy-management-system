-- Row Level Security: enforce role and assignment boundaries at the database
-- level. Teachers must never be able to read/write another teacher's data
-- even if they bypass the UI and call the Supabase REST/JS API directly.

alter table profiles enable row level security;
alter table classes enable row level security;
alter table teachers enable row level security;
alter table subjects enable row level security;
alter table students enable row level security;
alter table invoices enable row level security;
alter table attendance enable row level security;
alter table attendance_settings enable row level security;
alter table questions enable row level security;
alter table exams enable row level security;
alter table exam_questions enable row level security;
alter table exam_results enable row level security;
alter table timetable enable row level security;
alter table salaries enable row level security;

-- profiles: everyone can read/update their own row, admins can read/update/insert/delete any
create policy profiles_select on profiles for select
  using (id = auth.uid() or is_admin());

create policy profiles_update on profiles for update
  using (id = auth.uid() or is_admin())
  with check (id = auth.uid() or is_admin());

create policy profiles_insert on profiles for insert
  with check (is_admin());

create policy profiles_delete on profiles for delete
  using (is_admin());

-- classes: admin full access; teacher can read classes they are assigned to
create policy classes_select on classes for select
  using (is_admin() or id in (select teacher_class_ids()));

create policy classes_insert on classes for insert
  with check (is_admin());

create policy classes_update on classes for update
  using (is_admin())
  with check (is_admin());

create policy classes_delete on classes for delete
  using (is_admin());

-- teachers: admin full access; teacher can read/update their own row (salary protected by trigger)
create policy teachers_select on teachers for select
  using (is_admin() or id = auth.uid());

create policy teachers_insert on teachers for insert
  with check (is_admin());

create policy teachers_update on teachers for update
  using (is_admin() or id = auth.uid())
  with check (is_admin() or id = auth.uid());

create policy teachers_delete on teachers for delete
  using (is_admin());

-- subjects: admin full access.
-- Teachers can read subjects they teach or requested; can only insert a
-- pending_approval request for themselves (never an active/assigned subject);
-- cannot update or delete (approval is admin-only).
create policy subjects_select on subjects for select
  using (is_admin() or teacher_id = auth.uid() or requested_by = auth.uid());

create policy subjects_insert on subjects for insert
  with check (
    is_admin()
    or (
      status = 'pending_approval'
      and requested_by = auth.uid()
      and teacher_id is null
      and class_id in (select teacher_class_ids())
    )
  );

create policy subjects_update on subjects for update
  using (is_admin())
  with check (is_admin());

create policy subjects_delete on subjects for delete
  using (is_admin());

-- students: admin full access; teacher can read students in their assigned classes
create policy students_select on students for select
  using (is_admin() or class_id in (select teacher_class_ids()));

create policy students_insert on students for insert
  with check (is_admin());

create policy students_update on students for update
  using (is_admin())
  with check (is_admin());

create policy students_delete on students for delete
  using (is_admin());

-- invoices: admin-only (fee management is not exposed to teachers)
create policy invoices_all on invoices for all
  using (is_admin())
  with check (is_admin());

-- attendance: admin full access; teacher can read/mark attendance only for
-- their assigned classes, and only rows they themselves marked
create policy attendance_select on attendance for select
  using (is_admin() or class_id in (select teacher_class_ids()));

create policy attendance_insert on attendance for insert
  with check (
    is_admin()
    or (class_id in (select teacher_class_ids()) and marked_by = auth.uid())
  );

create policy attendance_update on attendance for update
  using (
    is_admin()
    or (class_id in (select teacher_class_ids()) and marked_by = auth.uid())
  )
  with check (
    is_admin()
    or (class_id in (select teacher_class_ids()) and marked_by = auth.uid())
  );

create policy attendance_delete on attendance for delete
  using (is_admin());

-- attendance_settings: readable by any authenticated user, editable by admin only
create policy attendance_settings_select on attendance_settings for select
  using (true);

create policy attendance_settings_update on attendance_settings for update
  using (is_admin())
  with check (is_admin());

-- questions: admin full access; teacher scoped to their own assigned subjects
create policy questions_select on questions for select
  using (is_admin() or subject_id in (select teacher_subject_ids()));

create policy questions_insert on questions for insert
  with check (is_admin() or subject_id in (select teacher_subject_ids()));

create policy questions_update on questions for update
  using (is_admin() or subject_id in (select teacher_subject_ids()))
  with check (is_admin() or subject_id in (select teacher_subject_ids()));

create policy questions_delete on questions for delete
  using (is_admin() or subject_id in (select teacher_subject_ids()));

-- exams: admin full access; teacher scoped to their own assigned subjects
create policy exams_select on exams for select
  using (is_admin() or subject_id in (select teacher_subject_ids()));

create policy exams_insert on exams for insert
  with check (is_admin() or subject_id in (select teacher_subject_ids()));

create policy exams_update on exams for update
  using (is_admin() or subject_id in (select teacher_subject_ids()))
  with check (is_admin() or subject_id in (select teacher_subject_ids()));

create policy exams_delete on exams for delete
  using (is_admin() or subject_id in (select teacher_subject_ids()));

-- exam_questions: scoped through the parent exam's subject assignment
create policy exam_questions_select on exam_questions for select
  using (
    is_admin()
    or exam_id in (select id from exams where subject_id in (select teacher_subject_ids()))
  );

create policy exam_questions_insert on exam_questions for insert
  with check (
    is_admin()
    or exam_id in (select id from exams where subject_id in (select teacher_subject_ids()))
  );

create policy exam_questions_delete on exam_questions for delete
  using (
    is_admin()
    or exam_id in (select id from exams where subject_id in (select teacher_subject_ids()))
  );

-- exam_results: scoped through the parent exam's subject assignment
create policy exam_results_select on exam_results for select
  using (
    is_admin()
    or exam_id in (select id from exams where subject_id in (select teacher_subject_ids()))
  );

create policy exam_results_insert on exam_results for insert
  with check (
    is_admin()
    or exam_id in (select id from exams where subject_id in (select teacher_subject_ids()))
  );

create policy exam_results_update on exam_results for update
  using (
    is_admin()
    or exam_id in (select id from exams where subject_id in (select teacher_subject_ids()))
  )
  with check (
    is_admin()
    or exam_id in (select id from exams where subject_id in (select teacher_subject_ids()))
  );

create policy exam_results_delete on exam_results for delete
  using (
    is_admin()
    or exam_id in (select id from exams where subject_id in (select teacher_subject_ids()))
  );

-- timetable: admin full access; teacher can read only their own slots
create policy timetable_select on timetable for select
  using (is_admin() or teacher_id = auth.uid());

create policy timetable_insert on timetable for insert
  with check (is_admin());

create policy timetable_update on timetable for update
  using (is_admin())
  with check (is_admin());

create policy timetable_delete on timetable for delete
  using (is_admin());

-- salaries: admin-only
create policy salaries_all on salaries for all
  using (is_admin())
  with check (is_admin());
