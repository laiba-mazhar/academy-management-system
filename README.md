# Al Maktab Educational Institute — Management System

React + Vite + TypeScript + Tailwind frontend, Supabase (Postgres + Auth + RLS) backend.

All 8 build phases are implemented: foundation/auth, student & staff records, timetable,
attendance, fees, exams/question bank/results, dashboards, and polish — plus a maroon/cream/gold
rebrand with light/dark theming, expanded dashboards, PDF export, fee challans, admission/security
fee tracking, teacher/staff attendance, and a course-breakdown pacing planner on top of that.

## One-time Supabase project setup

1. Create a project at https://supabase.com.
2. In the SQL Editor, run all files in `supabase/migrations/` **in filename order** (they're timestamp-prefixed, so sorting the folder alphabetically gives the right order).
3. Copy `.env.example` to `.env` and fill in your project's URL and anon key (Project Settings → API).
4. Create the **first admin account** manually (there's no admin yet to create one via the app):
   - Auth → Users → Add user → set an email + password, confirm email.
   - In the SQL Editor: `insert into profiles (id, role, full_name, email) values ('<the new user''s UUID>', 'admin', 'Your Name', 'admin@example.com');`
5. Deploy the two Edge Functions so admins can create/delete teacher accounts from the UI:
   ```
   supabase functions deploy create-teacher
   supabase functions deploy delete-teacher
   ```
   (Requires the Supabase CLI, logged in and linked to your project — `npx supabase login` then `npx supabase link`. Both functions read `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` from the Supabase-managed function environment automatically, and both send CORS headers so they work when called from the browser.) Everything else in the app works without these — only "Add Teacher" and "Delete Teacher" on the Teachers page depend on them.

## Running the app

```
npm install
npm run dev
```

Then sign in with the admin account created above at `/login`.

## What's in each area

- **Auth**: role-based login, forced password reset on first login, teacher-issued-by-admin accounts. Split-panel branded login screen with a light/dark theme toggle (sun/moon icon, top right).
- **Students** (`/admin/students`): full CRUD, search/filter by class/category/status. Admission form captures a per-student monthly fee override (defaults from the class fee, editable), plus admission-fee and security-fee amount + paid/unpaid toggles. Clicking a student (or "View Report") opens their full report: exam history and a **missed-exam list** — any exam held for their class that has no recorded result for them, flagged in red.
- **Teachers** (`/admin/teachers`): full CRUD, teacher account creation with a generated temp password.
- **Classes & Subjects** (`/admin/classes`): class fee setup, an optional **category/stream** field (e.g. Biology, Computer Science, Pre-Medical, Pre-Engineering — free text with suggestions), subject-to-teacher assignment, and the pending-subject-request approval queue. A subject is always scoped to one class ("section"), so the same subject name in two different sections can be assigned to two different teachers.
- **Timetable**: admin builder with day/time overlap checks; read-only per-teacher view; print-ready.
- **Attendance** (`/admin/attendance`, `/teacher/attendance`): a **Students / Teachers** toggle (admin only) switches between marking student attendance (one screen per class, any date, defaulters view against a configurable threshold, print + PDF download) and marking **teacher/staff attendance** (mark present/absent/late per teacher for any date, with a per-teacher history view).
- **Fees** (`/admin/fees`): two tabs —
  - **Fee Overview**: every enrolled student with this-month status, lifetime total paid, and lifetime total remaining, filterable by class/category/status; click a row for that student's full payment history and a receipt for any past month.
  - **Monthly Invoices**: the original per-month workflow — generate invoices from each student's fee (override or class default), mark paid, send a (mocked) reminder, automatic overdue flagging, printable receipts.
- **Fee Challans** (`/admin/fee-challans`): per-student view showing admission-fee and security-fee status (click to toggle paid/unpaid) and an editable monthly fee; "Generate Challan" produces a printable voucher for a chosen month listing tuition + any unpaid admission/security fee + total due.
- **Question Bank / Exams / Marks Entry** — **teacher-only** (`/teacher/questions`, `/teacher/exams`): questions organized by subject/chapter, exam paper assembly and print, and marks entry with automatic percentage. Admins no longer have these in their nav — their view into results is the student report (see Students, above).
- **Course Breakdown** — a pacing planner. Teachers (`/teacher/course-breakdown`) pick a subject, total chapter count, start/end dates, and a weekly/biweekly/monthly interval; the app generates dated slots where the teacher fills in which chapters they'll cover and checks them off as done. Admins (`/admin/course-breakdown`) get a read-only list of every teacher's plans by subject/class, clickable to view the full schedule and completion status.
- **Admin Dashboard**: student/fee/attendance stat cards, a financial panel (net profit, salary expense, GPM%, OPM%), revenue-vs-expense and profit trend charts, attendance-by-class and performance-by-class charts, and a salary panel with current-month **and all-time** paid/pending totals, both overall and per teacher.
- **Teacher Dashboard**: assignment summary, today's schedule, class-strength chart, 14-day attendance trend, per-exam result trend chart + records table, and the subject-request flow.

## Theming

- Palette: maroon (`brand-*` in `tailwind.config.js`) with cream/gold accents. Swap the hex values there to re-theme.
- Light/dark mode toggle lives in the top bar and login screen (`src/components/ThemeToggle.tsx`), backed by `src/context/ThemeContext.tsx` (persists to `localStorage`, defaults to the OS preference).
- Dark-mode classes were added mechanically across the app for the common slate/white/status-color patterns — if you add a new page, follow the same `dark:` pairing convention used in existing pages.

## Assumptions made (flag if you want these to work differently)

- **Teacher subject requests are scoped to classes they already teach.** A teacher can only request a new subject for a class they're already assigned to via an existing subject — not an arbitrary class.
- **Fees, salaries, and course-breakdown editing are admin/teacher-scoped as described above** — teachers have no read access to `invoices` or `salaries`; admins can view (not edit) course breakdown plans.
- **Attendance marking (student and teacher) is restricted to the person who marked it** (plus admins) — nobody else can edit that day's entries.
- **Pass rate** on the performance charts uses a 40% cutoff — change `PASS_THRESHOLD` in `src/pages/admin/AdminDashboard.tsx` (and the equivalent constant in `src/pages/teacher/TeacherDashboard.tsx`) if your institute uses a different passing mark.
- **Salary records** are generated per month per teacher from `teachers.monthly_salary` via the "Generate Salary Records" button on the admin dashboard (mirrors how fee invoices are generated).
- **GPM and OPM are numerically identical** in this build: the system only tracks one cost (teacher salaries), so both gross and operating margin reduce to `(fees collected − salary expense) / fees collected`. If you later track other operating costs separately from salaries, GPM and OPM should be split apart.
- **A class row represents one section.** "Math for 9th-A" and "Math for 9th-B" are two different `subjects` rows (different `class_id`) that can be assigned to two different teachers — this is how the same-subject-different-teacher requirement is satisfied structurally, without needing a separate student-to-subject enrollment table (every student in a class studies every subject assigned to that class).
- **Course breakdown slot lengths are literal day counts** — weekly = 7 days, biweekly = 15 days, monthly = 30 days (not calendar months), so the last slot in a range is capped at the plan's end date even if shorter than the interval.
- The first admin account must be created directly in the Supabase dashboard/SQL editor (documented above) since no admin exists yet to issue one through the app.

## Known limitation

If a class is co-taught (two teachers assigned to different subjects in the same class) and both mark attendance for the same date, only the original marker (or an admin) can edit those specific rows — the other teacher's save will report a permission error for that day's entries. This is intentional (prevents one teacher's marks being silently overwritten by another) but means co-taught classes need one teacher designated as the attendance-taker.
