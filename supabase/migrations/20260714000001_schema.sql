-- Academy Management System: core schema
-- Run in order: 0001_schema.sql, 0002_functions.sql, 0003_rls.sql, 0004_triggers.sql

create extension if not exists pgcrypto;

-- profiles: one row per auth.users, holds role + shared identity fields
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'teacher')),
  full_name text not null,
  email text not null,
  phone text,
  must_reset_password boolean not null default false,
  created_at timestamptz not null default now()
);

create table classes (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  fee_amount numeric(10, 2) not null default 0 check (fee_amount >= 0),
  created_at timestamptz not null default now()
);

-- teachers: 1-1 extension of profiles for teacher-only fields
create table teachers (
  id uuid primary key references profiles(id) on delete cascade,
  monthly_salary numeric(10, 2) not null default 0 check (monthly_salary >= 0),
  created_at timestamptz not null default now()
);

create table subjects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  class_id uuid not null references classes(id) on delete cascade,
  teacher_id uuid references teachers(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'pending_approval')),
  requested_by uuid references teachers(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (name, class_id)
);

create table students (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  class_id uuid references classes(id) on delete set null,
  contact_phone text,
  guardian_name text,
  guardian_phone text,
  guardian_email text,
  enrollment_status text not null default 'enrolled'
    check (enrollment_status in ('enrolled', 'inactive', 'graduated')),
  created_at timestamptz not null default now()
);

create table invoices (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  class_id uuid not null references classes(id) on delete cascade,
  month date not null, -- always normalized to the 1st of the invoice month
  amount numeric(10, 2) not null check (amount >= 0),
  status text not null default 'unpaid' check (status in ('unpaid', 'paid', 'overdue')),
  payment_date date,
  reminder_sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (student_id, month)
);

create table attendance (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  class_id uuid not null references classes(id) on delete cascade,
  date date not null,
  status text not null check (status in ('present', 'absent', 'late')),
  marked_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (student_id, date)
);

-- single-row configuration table for the attendance-defaulter threshold
create table attendance_settings (
  id int primary key default 1 check (id = 1),
  threshold_percent numeric(5, 2) not null default 75 check (threshold_percent between 0 and 100)
);
insert into attendance_settings (id, threshold_percent) values (1, 75);

create table questions (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references subjects(id) on delete cascade,
  class_id uuid not null references classes(id) on delete cascade,
  chapter text,
  question_text text not null,
  marks numeric(6, 2) not null check (marks > 0),
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table exams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  subject_id uuid not null references subjects(id) on delete cascade,
  class_id uuid not null references classes(id) on delete cascade,
  exam_date date not null,
  total_marks numeric(7, 2) not null check (total_marks > 0),
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- join table: which question-bank questions were assembled into a given exam paper
create table exam_questions (
  exam_id uuid not null references exams(id) on delete cascade,
  question_id uuid not null references questions(id) on delete cascade,
  primary key (exam_id, question_id)
);

create table exam_results (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references exams(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  marks_obtained numeric(7, 2) not null check (marks_obtained >= 0),
  entered_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (exam_id, student_id)
);

create table timetable (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references teachers(id) on delete cascade,
  class_id uuid not null references classes(id) on delete cascade,
  subject_id uuid not null references subjects(id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6), -- 0 = Sunday
  start_time time not null,
  end_time time not null check (end_time > start_time),
  created_at timestamptz not null default now()
);

create table salaries (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references teachers(id) on delete cascade,
  month date not null, -- normalized to the 1st of the month
  amount numeric(10, 2) not null check (amount >= 0),
  status text not null default 'pending' check (status in ('pending', 'paid')),
  paid_date date,
  created_at timestamptz not null default now(),
  unique (teacher_id, month)
);

create index on subjects (teacher_id);
create index on subjects (class_id);
create index on students (class_id);
create index on invoices (student_id);
create index on invoices (status);
create index on attendance (class_id, date);
create index on attendance (student_id);
create index on exams (subject_id);
create index on exam_results (exam_id);
create index on exam_results (student_id);
create index on timetable (teacher_id);
create index on salaries (teacher_id);
