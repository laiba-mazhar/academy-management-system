# Maktab - The Educational Institute — Management System

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
5. Deploy the Edge Functions so admins can create/delete teacher accounts and send real fee-reminder emails from the UI:
   ```
   supabase functions deploy create-teacher
   supabase functions deploy delete-teacher
   supabase functions deploy send-fee-reminder
   ```
   (Requires the Supabase CLI, logged in and linked to your project — `npx supabase login` then `npx supabase link`. All three read `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` from the Supabase-managed function environment automatically, and all send CORS headers so they work when called from the browser.) Everything else in the app works without these — only "Add Teacher", "Delete Teacher", and "Send Reminder" (Fees page) depend on them.
6. For real fee-reminder emails, sign up at https://resend.com (free tier: 3,000 emails/month) and create an API key, then set it as a function secret:
   ```
   supabase secrets set RESEND_API_KEY=your-resend-api-key
   ```
   **Sandbox limitation (Resend)**: until you verify a domain in Resend, emails can only be delivered to the email address you signed up to Resend with — sending to a student's actual guardian email will be rejected by Resend until you verify a domain (Resend dashboard → Domains → Add Domain, then add the DNS records at your registrar; free, takes a few minutes to propagate). Once verified, set `REMINDER_FROM_ADDRESS` as a secret too (e.g. `supabase secrets set REMINDER_FROM_ADDRESS="Maktab - The Educational Institute <noreply@yourdomain.com>"`) — otherwise it defaults to Resend's shared sandbox sender.

7. Create the **attendance desk account** — the kiosk login used at the gate to scan student cards. In the SQL Editor, run `supabase/setup/create_attendance_user.sql`. That one script creates the login, confirms its email, and gives it the `attendance` role:

   | Email | Password |
   | --- | --- |
   | `attendance@maktab.edu.pk` | `Maktab@Scan2026` |

   Signing in with it lands straight on the scanning screen at `/scan`. To change the password later, edit `v_password` at the top of that file and run it again (it's safe to re-run — it resets the existing account rather than creating a second one). Nothing in the app hardcodes the credentials.

## Running the app

```
npm install
npm run dev
```

Then sign in with the admin account created above at `/login`.

## What's in each area

- **Auth**: three roles — `admin`, `teacher`, and `attendance` (the front-desk scanning kiosk, which can do nothing but record a card sign-in). Role-based login, forced password reset on first login, teacher-issued-by-admin accounts. Split-panel branded login screen with a light/dark theme toggle (sun/moon icon, top right).
- **Students** (`/admin/students`): full CRUD, search/filter by class/category/status. Admission form captures a per-student monthly fee override (defaults from the class fee, editable), plus admission-fee and security-fee amount + paid/unpaid toggles. Clicking a student (or "View Report") opens their full report: exam history and a **missed-exam list** — any exam held for their class that has no recorded result for them, flagged in red.
- **Teachers** (`/admin/teachers`): full CRUD, teacher account creation with a generated temp password.
- **Classes & Subjects** (`/admin/classes`): class fee setup, an optional **category/stream** field (e.g. Biology, Computer Science, Pre-Medical, Pre-Engineering — free text with suggestions), subject-to-teacher assignment, and the pending-subject-request approval queue. A subject is always scoped to one class ("section"), so the same subject name in two different sections can be assigned to two different teachers.
- **Timetable**: admin builder with day/time overlap checks; read-only per-teacher view; print-ready.
- **Attendance** (`/admin/attendance`, `/teacher/attendance`): a **Students / Teachers** toggle (admin only) switches between marking student attendance (one screen per class, any date, defaulters view against a configurable threshold, print + PDF download) and marking **teacher/staff attendance** (mark present/absent/late per teacher for any date, with a per-teacher history view).
- **Student Cards** (`/admin/student-cards`): every student has a printable ID card carrying a **Code 39 barcode**. The card number (`MKT000001`, `MKT000002`, …) is assigned by the database the moment a student row is created, so a new admission's card exists automatically — the Add Student dialog even offers to print it right away. Filter by class/status, print the whole filtered set as a cut-up sheet, or print one card at a time. Cards are fixed at 90mm × 55mm and always render light-on-white (a dark card neither prints nor scans).
- **Barcode sign-in** (`/scan` for the attendance account, `/admin/scanner` for admins): the student scans their card at the desk and the screen shows their name, class, and **"Signed in at 9:14:03 AM"**. If the student has an **overdue fee**, a full-width red banner appears **above** the sign-in confirmation with the outstanding amount, which months are unpaid, and the guardian's phone number. Repeat scans on the same day report the original sign-in time instead of overwriting it, and a running list of recent sign-ins stays on screen. **No scanner hardware needed** — there are three ways to feed a card number in, and all three converge on the same `recordScan` call, so the register, the fee check, and the on-screen result are identical whichever you use:
  1. A **USB barcode scanner** in keyboard-wedge mode (it just types the number and presses Enter).
  2. **Typing** the number by hand — useful for testing, or when a card is damaged.
  3. The **webcam** — click "Use camera" and hold the card up to the lens. Decoding is done in the browser by ZXing, limited to Code 39 and QR. Requires an `https://` address (or `localhost`); browsers refuse camera access over plain http, and the panel says so if that's the problem.
- **Fees** (`/admin/fees`): two tabs —
  - **Fee Overview**: every enrolled student with this-month status, lifetime total paid, and lifetime total remaining, filterable by class/category/status; click a row for that student's full payment history and a receipt for any past month.
  - **Monthly Invoices**: the original per-month workflow — generate invoices from each student's fee (override or class default), mark paid, **send a real fee-reminder email** to the guardian on file via Resend (see setup step 6 above), automatic overdue flagging, printable receipts.
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
- The first admin account must be created directly in the Supabase dashboard/SQL editor (documented above) since no admin exists yet to issue one through the app. The attendance-desk account is created the same way (setup step 7) — it's a single shared kiosk login, not one account per staff member.
- **A card number is permanent.** It's assigned by a database trigger at admission (`MKT` + a 6-digit sequence) and a trigger refuses any later change, so a card that has already been printed and handed out can never silently stop matching its student.
- **"Fee overdue" on the scanner means an unpaid invoice whose due date has passed** — or, when an invoice has no due date set, one for a month that has already ended. Unpaid admission/security fees and the current (not yet late) month are shown as a secondary "also pending" line rather than triggering the red banner.
- **Webcam scanning is a convenience, not a replacement for a scanner.** A 1D barcode needs real pixels across the bars, so a webcam wants a well-lit card filling the frame; a Rs 5,000 USB gun is faster and more reliable for a morning queue. The decoder chunk (~460 kB) is lazy-loaded, so nobody who doesn't press "Use camera" downloads it. If webcam scanning becomes the primary method, switching the cards to QR would raise the hit rate substantially — only `src/components/Barcode.tsx` would change.
- **Barcode sign-in always records `present`.** The desk records arrival; late/absent classification stays a teacher's judgement on the Attendance page, and a scan never overwrites a mark a teacher already made that day.
- **The scanner terminal's own clock decides the date**, but only within one day of the server's — a terminal with a badly wrong clock can't backdate the register. This matters because the server clock runs in UTC, which would otherwise roll the day over mid-evening in Pakistan.

## Known limitation

If a class is co-taught (two teachers assigned to different subjects in the same class) and both mark attendance for the same date, only the original marker (or an admin) can edit those specific rows — the other teacher's save will report a permission error for that day's entries. This is intentional (prevents one teacher's marks being silently overwritten by another) but means co-taught classes need one teacher designated as the attendance-taker.
