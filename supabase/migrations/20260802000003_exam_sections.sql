-- Paper structure: an objective part and a subjective part, each holding
-- sections, each section optionally offering a choice ("attempt any six of
-- nine"). Until now a paper was a flat list of questions, which no real board
-- paper is.

create table if not exists exam_sections (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references exams(id) on delete cascade,
  -- Objective is the MCQ half of the paper, subjective everything written.
  part text not null default 'subjective' check (part in ('objective', 'subjective')),
  title text not null,
  -- Printed under the title: "Attempt any SIX questions." Free text so a
  -- teacher can word it however their board does.
  instruction text,
  -- Null means every question in the section must be attempted. A number
  -- means the student picks that many, which is what the paper's marks total
  -- has to be counted from.
  choose_count integer check (choose_count is null or choose_count > 0),
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists exam_sections_exam_idx on exam_sections (exam_id, position);

alter table exam_questions
  add column if not exists section_id uuid references exam_sections(id) on delete set null;

alter table exam_questions add column if not exists position integer not null default 0;

-- Which sub-parts of a multi-part question appear on this paper, as indexes
-- into the parts parsed out of question_text. Null means all of them — which
-- is what every existing row means, so nothing needs backfilling.
alter table exam_questions add column if not exists part_indexes integer[];

create index if not exists exam_questions_section_idx on exam_questions (section_id, position);

comment on column exam_sections.choose_count is
  'Attempt-any-N. Null = attempt all. The paper total counts only the N highest-marked questions in the section.';
comment on column exam_questions.part_indexes is
  'Indexes of the sub-parts to print, or null for all of them.';

alter table exam_sections enable row level security;

-- Scoped through the parent exam's subject assignment, exactly as
-- exam_questions is: a teacher reaches the sections of their own papers and
-- nothing else.
create policy exam_sections_select on exam_sections for select
  using (
    is_admin()
    or exam_id in (select id from exams where subject_id in (select teacher_subject_ids()))
  );

create policy exam_sections_insert on exam_sections for insert
  with check (
    is_admin()
    or exam_id in (select id from exams where subject_id in (select teacher_subject_ids()))
  );

create policy exam_sections_update on exam_sections for update
  using (
    is_admin()
    or exam_id in (select id from exams where subject_id in (select teacher_subject_ids()))
  )
  with check (
    is_admin()
    or exam_id in (select id from exams where subject_id in (select teacher_subject_ids()))
  );

create policy exam_sections_delete on exam_sections for delete
  using (
    is_admin()
    or exam_id in (select id from exams where subject_id in (select teacher_subject_ids()))
  );
