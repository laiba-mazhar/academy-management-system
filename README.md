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
   **A verified domain is required, not optional.** Resend will only deliver to the address you signed up with until you verify a domain, so guardian emails silently reach nobody. Verify one (Resend dashboard → Domains → Add Domain, then add the DNS records at your registrar; free, usually minutes to propagate), then set the sender:
   ```
   supabase secrets set REMINDER_FROM_ADDRESS="Maktab - The Educational Institute <noreply@yourdomain.com>"
   ```
   Both mail functions **refuse to send** without `REMINDER_FROM_ADDRESS` and return an explanatory error. That is deliberate: they used to fall back to Resend's shared sandbox sender, which made a broken install look healthy — the UI said "Reminder sent" while only the Resend account owner ever received anything. The mailbox in the address has to belong to the verified domain; Resend rejects a `from` on any other domain.
7. For **exam-result messages** to guardians. `MESSAGE_PROVIDER` also accepts a **comma-separated chain** for automatic failover — each message tries the providers left to right and stops at the first that accepts it. The recommended production setting is `MESSAGE_PROVIDER=httpsms,sms`: the phone-based route handles the traffic at a fraction of a paisa per message, and the paid gateway silently covers the gaps when that phone is offline, so an unplugged handset costs a few rupees rather than losing notifications. A provider whose secrets are missing is skipped, not treated as a failure; if a message exhausts the whole chain, the error reports what each route said.

   **WhatsApp via SendPK** (`MESSAGE_PROVIDER=sendpk-wa`) is the route to use when the number is registered under SendPK rather than your own Cloud API app. Meta only lets one provider hold a number at a time, so the direct `meta` route will refuse a number SendPK already manages — check WhatsApp Manager → Phone numbers to see which applies. Approve a template inside SendPK's own panel (seven variables, same order as below), then:
   ```
   supabase secrets set MESSAGE_PROVIDER=sendpk-wa
   supabase secrets set SENDPK_WA_API_KEY=your-api-key
   supabase secrets set SENDPK_WA_TEMPLATE_ID=your-approved-template-id
   ```
   The template id is SendPK's, not Meta's template name. To move the number to your own app later, SendPK must release it first, and you'll need its two-step verification PIN.

   **WhatsApp via Whapi.Cloud** (`MESSAGE_PROVIDER=whapi`) pairs an ordinary WhatsApp account by QR code instead of going through Meta, so there is no Meta app, no business verification, no template approval, and messages are free-form:
   ```
   supabase secrets set MESSAGE_PROVIDER=whapi
   supabase secrets set WHAPI_TOKEN=your-token
   ```
   `WHAPI_ENDPOINT` overrides the send URL if their API changes. **This is an unofficial route**: automated bulk sending breaches WhatsApp's terms, and enforcement targets the number itself — a ban would take the institute's ordinary WhatsApp with it. If you use it, keep volumes modest and chain an official fallback (`MESSAGE_PROVIDER=whapi,meta`) so a dropped session or a ban still leaves parents notified.

   Six providers are supported, selected with the `MESSAGE_PROVIDER` secret — **httpSMS** (cheapest, sends via a carrier SMS bundle on your own Android phone), **SMS** via SendPK, **Twilio** for testing (no Meta account, no template approval), and **Meta** for production WhatsApp.

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
      Optional overrides: `WHATSAPP_TEMPLATE_NAME`, `WHATSAPP_TEMPLATE_LANG`, `WHATSAPP_TEMPLATE_PARAM_COUNT`, `WHATSAPP_API_VERSION` (default `v23.0`).

      **Smoke-test defaults**: the function currently defaults to Meta's sample template `jaspers_market_order_confirmation_v1` / `en_US` / 3 variables, so a send works before `result_notification` is approved — the wording will be nonsense, it only proves the wiring. Once your own template is approved, set `WHATSAPP_TEMPLATE_NAME=result_notification`, `WHATSAPP_TEMPLATE_LANG=en`, `WHATSAPP_TEMPLATE_PARAM_COUNT=7` (or revert the defaults in `index.ts`).

   **Token expiry**: the quick-start token shown in the dashboard **expires after 24 hours** — fine for testing, but for production generate a permanent token via a System User in Meta Business Settings and re-set the secret. A `401`/code `190` from Meta means the token expired, not that the function is broken.

   Guardian phone numbers are normalized to Pakistan's `92XXXXXXXXXX` format automatically, so `0300-1234567`, `+92 300 1234567`, etc. all work. Pass/Fail (`{{7}}`) is derived from the same 40% cutoff the dashboards use — `PASS_THRESHOLD` is defined in `send-result-whatsapp/index.ts`, `AdminDashboard.tsx` and `TeacherDashboard.tsx`, so change all three together. If you edit the template's wording later, keep the seven variables in the same order or the messages will come out scrambled.

   **Going live** (moving off the test number): generate a permanent System User token, add the institute's real number in WhatsApp Manager, complete Meta Business verification, add a billing method, and re-create the template under the production WhatsApp Business Account. Re-set `WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` to the production values.

8. Create the **attendance desk account** — the kiosk login used at the gate to scan student cards. In the SQL Editor, run `supabase/setup/create_attendance_user.sql`. That one script creates the login, confirms its email, and gives it the `attendance` role:

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
