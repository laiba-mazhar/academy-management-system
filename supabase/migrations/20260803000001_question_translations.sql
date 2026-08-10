-- A second language for each question, kept beside the original rather than
-- instead of it.
--
-- The academy teaches the same content to Urdu-medium and English-medium
-- classes, so one question is wanted in both. What must not happen is the
-- original being replaced by a translation of itself: question_text stays
-- exactly as it was printed, in whatever script it was printed in, and the
-- other language goes in its own column.
--
-- Language subjects are excluded, which is what subjects.translate_questions
-- is for. Translating an Urdu grammar question, a Tarjama tul Quran passage or
-- an English comprehension question destroys the very thing being examined —
-- "underline the correct spelling" does not survive being put into another
-- language. Content subjects (maths, physics, chemistry) translate cleanly.

-- Which language question_text itself is in. Null for the questions already in
-- the bank, which nobody has told us about; the app falls back to detecting
-- Arabic script, so a null is a missing label rather than a broken row.
alter table questions add column if not exists language text
  check (language is null or language in ('ur', 'en'));

-- The other language. Null means there isn't one — either the subject opts out
-- of translation, or nobody has added it yet.
alter table questions add column if not exists translation text;

-- MCQ choices in the other language, same shape as options:
-- [{"key":"A","text":"..."}]. Kept in step with options by the app, which
-- writes both together or neither.
alter table questions add column if not exists options_translated jsonb;

comment on column questions.language is
  'Language of question_text as printed: ur | en. Null for rows predating translation.';
comment on column questions.translation is
  'The same question in the other language. Null when the subject does not translate, or none has been made.';
comment on column questions.options_translated is
  'MCQ choices in the other language, as [{"key","text"}]. Null unless options is set and a translation exists.';

-- Off for language subjects, on for everything else. Defaulting to true would
-- silently start translating Urdu papers, so the subjects that already exist
-- are set from their own names and a human corrects any the names got wrong.
--
-- Both steps sit inside one guard so the backfill runs exactly once, when the
-- column is first created. Without that, re-running this file would undo a
-- teacher who had deliberately turned translation back on for a subject whose
-- name merely looks like a language one.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'subjects' and column_name = 'translate_questions'
  ) then
    alter table subjects add column translate_questions boolean not null default true;

    -- Matched loosely because these names are typed by hand: "Urdu", "urdu b",
    -- "Tarjama tul Quran", "Translation of Quran", "English-12".
    update subjects
    set translate_questions = false
    where name ~* '(urdu|اردو)'
       or name ~* '(english|انگریزی)'
       or name ~* '(arabic|عربی)'
       or name ~* '(tarjama|tarjuma|tarjima|ترجمہ)'
       or name ~* '(quran|qur.an|قرآن)'
       or name ~* '(nazra|ناظرہ)'
       or name ~* '(islamiat|اسلامیات)';
  end if;
end $$;

comment on column subjects.translate_questions is
  'Whether imported questions also get a translation. False for language subjects, where a translation would replace the thing being examined.';

-- The bank is filtered by subject and then by language on the import review
-- screen, which is the one query this adds.
create index if not exists questions_subject_language_idx on questions (subject_id, language);
