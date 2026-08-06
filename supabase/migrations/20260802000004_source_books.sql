-- Scanned books kept as pages, not as text.
--
-- Text recognition cannot read Urdu reliably, and transcribing a scanned
-- Urdu-medium book is the one thing that guarantees the language changes. So
-- the pages are stored as images and a teacher snips the region they want. The
-- script, the notation, the diagrams and the typesetting all survive exactly,
-- because nothing is ever read.

create table if not exists source_books (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references subjects(id) on delete cascade,
  class_id uuid not null references classes(id) on delete cascade,
  title text not null,
  page_count integer not null default 0,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists source_book_pages (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references source_books(id) on delete cascade,
  page_number integer not null,
  -- Path within the book-pages storage bucket.
  storage_path text not null,
  width integer not null,
  height integer not null,
  unique (book_id, page_number)
);

create index if not exists source_book_pages_book_idx on source_book_pages (book_id, page_number);

-- A question can be a snip from a book page instead of typed text. The crop is
-- stored as fractions of the page rather than pixels, so it stays correct
-- whatever resolution the page was scanned or re-rendered at.
alter table questions add column if not exists source_page_id uuid references source_book_pages(id) on delete set null;
alter table questions add column if not exists crop jsonb;

comment on column questions.crop is
  'Region of source_page_id to print, as {"x","y","w","h"} fractions of the page. Null for a text question.';

-- question_text stays required in the schema, but a snip has no text of its
-- own — the teacher's own label goes there so the bank stays searchable.

alter table source_books enable row level security;
alter table source_book_pages enable row level security;

drop policy if exists source_books_select on source_books;
create policy source_books_select on source_books for select
  using (is_admin() or subject_id in (select teacher_subject_ids()));
drop policy if exists source_books_insert on source_books;
create policy source_books_insert on source_books for insert
  with check (is_admin() or subject_id in (select teacher_subject_ids()));
drop policy if exists source_books_update on source_books;
create policy source_books_update on source_books for update
  using (is_admin() or subject_id in (select teacher_subject_ids()))
  with check (is_admin() or subject_id in (select teacher_subject_ids()));
drop policy if exists source_books_delete on source_books;
create policy source_books_delete on source_books for delete
  using (is_admin() or subject_id in (select teacher_subject_ids()));

drop policy if exists source_book_pages_select on source_book_pages;
create policy source_book_pages_select on source_book_pages for select
  using (
    is_admin()
    or book_id in (select id from source_books where subject_id in (select teacher_subject_ids()))
  );
drop policy if exists source_book_pages_insert on source_book_pages;
create policy source_book_pages_insert on source_book_pages for insert
  with check (
    is_admin()
    or book_id in (select id from source_books where subject_id in (select teacher_subject_ids()))
  );
drop policy if exists source_book_pages_delete on source_book_pages;
create policy source_book_pages_delete on source_book_pages for delete
  using (
    is_admin()
    or book_id in (select id from source_books where subject_id in (select teacher_subject_ids()))
  );

-- Private bucket: page scans are read through short-lived signed URLs rather
-- than being world-readable to anyone who guesses a path.
insert into storage.buckets (id, name, public)
values ('book-pages', 'book-pages', false)
on conflict (id) do nothing;

do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'book_pages_staff_read') then
    create policy book_pages_staff_read on storage.objects for select
      using (
        bucket_id = 'book-pages'
        and exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin', 'teacher'))
      );
  end if;
  if not exists (select 1 from pg_policies where policyname = 'book_pages_staff_write') then
    create policy book_pages_staff_write on storage.objects for insert
      with check (
        bucket_id = 'book-pages'
        and exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin', 'teacher'))
      );
  end if;
  if not exists (select 1 from pg_policies where policyname = 'book_pages_staff_delete') then
    create policy book_pages_staff_delete on storage.objects for delete
      using (
        bucket_id = 'book-pages'
        and exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin', 'teacher'))
      );
  end if;
end $$;
