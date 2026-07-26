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
   supabase functions deploy send-result-whatsapp
   ```
   (Requires the Supabase CLI, logged in and linked to your project — `npx supabase login` then `npx supabase link`. All four read `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` from the Supabase-managed function environment automatically, and all send CORS headers so they work when called from the browser.) Everything else in the app works without these — only "Add Teacher", "Delete Teacher", "Send Reminder" (Fees page), and "Send WhatsApp" (exam Marks Entry) depend on them.
6. For real fee-reminder emails, sign up at https://resend.com (free tier: 3,000 emails/month) and create an API key, then set it as a function secret:
   ```
   supabase secrets set RESEND_API_KEY=your-resend-api-key
   ```
   **Sandbox limitation**: until you verify a domain in Resend, emails can only be delivered to the email address you signed up to Resend with — sending to a student's actual guardian email will be rejected by Resend until you verify a domain (Resend dashboard → Domains → Add Domain, then add the DNS records at your registrar; free, takes a few minutes to propagate). Once verified, set `REMINDER_FROM_ADDRESS` as a secret too (e.g. `supabase secrets set REMINDER_FROM_ADDRESS="Maktab - The Educational Institute <noreply@yourdomain.com>"`) — otherwise it defaults to Resend's shared sandbox sender.
7. For **exam-result messages** to guardians. `MESSAGE_PROVIDER` also accepts a **comma-separated chain** for automatic failover — each message tries the providers left to right and stops at the first that accepts it. The recommended production setting is `MESSAGE_PROVIDER=httpsms,sms`: the phone-based route handles the traffic at a fraction of a paisa per message, and the paid gateway silently covers the gaps when that phone is offline, so an unplugged handset costs a few rupees rather than losing notifications. A provider whose secrets are missing is skipped, not treated as a failure; if a message exhausts the whole chain, the error reports what each route said.

   Four providers are supported, selected with the `MESSAGE_PROVIDER` secret — **httpSMS** (cheapest, sends via a carrier SMS bundle on your own Android phone), **SMS** via SendPK, **Twilio** for testing (no Meta account, no template approval), and **Meta** for production WhatsApp.

   **httpSMS via a carrier bundle** (`MESSAGE_PROVIDER=httpsms`) is by far the cheapest route. A Jazz or Telenor monthly SMS bundle (roughly Rs 40–99 for 10,000–12,000 SMS) works out near **PKR 0.004–0.008 per message**, against ~PKR 1+ from a commercial gateway — so a whole month of alerts costs less than a hundred rupees. Setup:
   1. Put a SIM with a monthly SMS bundle in a spare Android phone; keep it charged and on WiFi.
   2. Create a free account at [httpsms.com](https://httpsms.com), copy the API key from Settings, install their Android app and sign in with that key.
   3. Set the secrets:
      ```
      supabase secrets set MESSAGE_PROVIDER=httpsms
      supabase secrets set HTTPSMS_API_KEY=your-api-key
      supabase secrets set HTTPSMS_FROM=+92XXXXXXXXXX
      ```
      `HTTPSMS_FROM` is the phone's own number. `HTTPSMS_ENDPOINT` can override the send URL if their API shape changes.

   **Know the trade-offs before relying on it**: consumer bundles are sold for personal use and PTA rules expect commercial traffic on registered A2P routes; carriers cap daily SMS (often 300–500) and may block a SIM that looks like a bulk sender; throughput is roughly one SMS every few seconds, so a large bulk send is slow and can exceed the edge function's execution limit; the sender always shows as the SIM's number, never a brand; and there's no redundancy — one phone, one SIM. It suits a steady trickle of daily alerts far better than blasting a whole school's results at once. For a fully compliant alternative at similar-ish cost, ask Jazz/Telenor/Zong for a corporate A2P quote.

   **SMS via SendPK** (`MESSAGE_PROVIDER=sms`) is the only option here that doesn't depend on a Meta WhatsApp Business Account, so it keeps working even when a Meta business portfolio is restricted — and it costs roughly a third of WhatsApp per message in Pakistan.
   ```
   supabase secrets set MESSAGE_PROVIDER=sms
   supabase secrets set SENDPK_SMS_USERNAME=your-username
   supabase secrets set SENDPK_SMS_PASSWORD=your-password
   supabase secrets set SENDPK_SMS_SENDER=Maktab
   ```
   The SMS copy is deliberately shorter than the WhatsApp wording so each message stays inside one 160-character billable part — edit `composeSms` in the edge function to change it, and keep an eye on the length. Urdu text is Unicode and only fits 70 characters per part. A branded sender ID (e.g. `Maktab` instead of a number) requires PTA registration with the institute's NTN and CNIC, and carries an annual fee.

   **Testing via Twilio's WhatsApp sandbox** — fastest way to see real messages, and it works without a Meta business account:
   1. Sign up at [twilio.com](https://www.twilio.com) (trial credit included). If phone verification fails from Pakistan, use **"Send code via voice call"**.
   2. **Messaging → Try it out → Send a WhatsApp message** shows the sandbox number and a join code. From each test phone, WhatsApp that join code to the sandbox number. Sessions expire after ~3 days; re-send the code to renew.
   3. Set the secrets (Auth Token is a credential — never in the repo):
      ```
      supabase secrets set MESSAGE_PROVIDER=twilio
      supabase secrets set TWILIO_ACCOUNT_SID=ACxxxxxxxx
      supabase secrets set TWILIO_AUTH_TOKEN=your-auth-token
      ```
      Optional: `TWILIO_WHATSAPP_FROM` (defaults to the shared sandbox number `whatsapp:+14155238886`).

   The sandbox sends free-form text, so no template is needed and the wording can change freely. It is for testing only — the sender is a shared US number, and international rates make it unsuitable for production volume in Pakistan.

   **Production via Meta's [WhatsApp Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api)** (set `MESSAGE_PROVIDER=meta`):
   1. At [developers.facebook.com](https://developers.facebook.com) create an app of type **Business** and add the **WhatsApp** product. This gives you a free **test sender number** plus a **Phone number ID** — no SIM required, and no Business verification for testing.
   2. Under *API Setup*, add the recipient numbers you want to test with (**the test number only delivers to numbers on that list — up to 5**).
   3. In **WhatsApp Manager → Message templates**, create a template named `result_notification`, category **Utility** (a result notice is transactional, not marketing — cheaper and far more likely to be approved), language **English**, with **seven body variables in this exact order**: `{{1}}` guardian name, `{{2}}` student name, `{{3}}` marks obtained, `{{4}}` total marks, `{{5}}` subject, `{{6}}` exam name, `{{7}}` Pass/Fail. Body used by this app:
      > Dear {{1}}, your child {{2}} scored {{3}} out of {{4}} marks in {{5}} ({{6}}). Result: {{7}}. For any questions, please contact the school office. Thank you, Maktab - The Educational Institute.
   4. Set the secrets (the token must never live in the repo or the browser):
      ```
      supabase secrets set WHATSAPP_ACCESS_TOKEN=your-access-token
      supabase secrets set WHATSAPP_PHONE_NUMBER_ID=your-phone-number-id
      ```
      Optional overrides: `WHATSAPP_TEMPLATE_NAME` (default `result_notification`), `WHATSAPP_TEMPLATE_LANG` (default `en`), `WHATSAPP_API_VERSION` (default `v23.0`).

   **Token expiry**: the quick-start token shown in the dashboard **expires after 24 hours** — fine for testing, but for production generate a permanent token via a System User in Meta Business Settings and re-set the secret. A `401`/code `190` from Meta means the token expired, not that the function is broken.

   Guardian phone numbers are normalized to Pakistan's `92XXXXXXXXXX` format automatically, so `0300-1234567`, `+92 300 1234567`, etc. all work. Pass/Fail (`{{7}}`) is derived from the same 40% cutoff the dashboards use — `PASS_THRESHOLD` is defined in `send-result-whatsapp/index.ts`, `AdminDashboard.tsx` and `TeacherDashboard.tsx`, so change all three together. If you edit the template's wording later, keep the seven variables in the same order or the messages will come out scrambled.

   **Going live** (moving off the test number): generate a permanent System User token, add the institute's real number in WhatsApp Manager, complete Meta Business verification, add a billing method, and re-create the template under the production WhatsApp Business Account. Re-set `WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` to the production values.

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
- The first admin account must be created directly in the Supabase dashboard/SQL editor (documented above) since no admin exists yet to issue one through the app.

## Known limitation

If a class is co-taught (two teachers assigned to different subjects in the same class) and both mark attendance for the same date, only the original marker (or an admin) can edit those specific rows — the other teacher's save will report a permission error for that day's entries. This is intentional (prevents one teacher's marks being silently overwritten by another) but means co-taught classes need one teacher designated as the attendance-taker.
