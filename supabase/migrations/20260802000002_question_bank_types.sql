-- Question bank: types, MCQ options, difficulty.
--
-- Everything is nullable or defaulted, so the questions already in the bank
-- stay valid — they become plain 'short' questions with no options and no
-- recorded difficulty, which is exactly what they were.

alter table questions
  add column if not exists question_type text not null default 'short'
    check (question_type in ('mcq', 'short', 'long', 'fill_blank', 'true_false'));

-- MCQ choices, as [{"key":"A","text":"..."}]. Null for every other type.
-- JSONB rather than a child table: options are only ever read and written
-- with their question, never queried across questions.
alter table questions add column if not exists options jsonb;

-- The correct option key for an MCQ / true_false, or a model answer for the
-- written types. Null is normal — a past paper carries no answers.
alter table questions add column if not exists answer text;

alter table questions
  add column if not exists difficulty text
    check (difficulty is null or difficulty in ('easy', 'medium', 'hard'));

-- Where the question came from: "Board 2023", "Textbook Ex 2.1", or the name
-- of the PDF it was imported from. Free text on purpose — it is a note for
-- the teacher, not something the app branches on.
alter table questions add column if not exists source text;

comment on column questions.question_type is
  'mcq | short | long | fill_blank | true_false. Drives how the question renders on a paper.';
comment on column questions.options is
  'MCQ choices as [{"key":"A","text":"..."}]. Null unless question_type = mcq.';
comment on column questions.answer is
  'Correct option key for mcq/true_false, or a model answer. Null when unknown.';

-- The bank is browsed subject-first and then narrowed by type, which is the
-- one query the import review screen and the paper builder both make.
create index if not exists questions_subject_type_idx
  on questions (subject_id, question_type);
