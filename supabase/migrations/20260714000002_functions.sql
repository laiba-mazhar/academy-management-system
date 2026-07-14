-- Helper functions used by RLS policies.
-- SECURITY DEFINER + fixed search_path so they run with the function owner's
-- privileges and bypass RLS on profiles/subjects when checking role/assignment,
-- avoiding policy recursion on those tables.

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role = 'admin' from profiles where id = auth.uid()), false);
$$;

create or replace function public.teacher_class_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select distinct class_id from subjects where teacher_id = auth.uid();
$$;

create or replace function public.teacher_subject_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from subjects where teacher_id = auth.uid();
$$;
