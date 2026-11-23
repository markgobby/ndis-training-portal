# Project context for Claude

NDIS High Intensity Supports training portal. One trainer/assessor (the admin) runs theory workbooks and practical assessments for learners from multiple client organisations.

## Stack
- Static site with no build step: `index.html`, `css/styles.css`, and ES modules in `js/`. Supabase JS loads from the jsDelivr CDN.
- Supabase handles Postgres, Auth (email + password) and row-level security. The full schema, policies and workflow functions are in `supabase/schema.sql`.
- Hosted on Netlify or Vercel from this repo, with no build command.
- Keys and branding live in `js/config.js`. The publishable/anon key there is meant to be public.

## Data model (public schema)
- `organisations` → `profiles` (`role`: admin / learner / pending; `organisation_id`)
- `packages` (the `code` is the "package plan number") ↔ `workbooks` via `package_workbooks` (ordered; any number of workbooks).
- `competencies` (practical skills) belong to a **workbook** (`workbook_id`) or to a **package** as whole-package extras (`package_id`), never both. An enrolment's practical checklist = skills of its assigned workbooks + its package's extras, via `enrollment_competencies(enrollment_id)` (grouped by workbook).
- `workbook_organisations` / `package_organisations`: which organisations a workbook or package is offered to. No rows means all organisations. Only used for admin filtering (the org switcher and invite screen).
- Each workbook has two parts. **Part 1, Learning:** `learning_items` (kind `content` = heading + simple-formatted text; kind `practice` = unrecorded multiple-choice/true-false check with answer and explanation, which learners can read). `assignments.learning_done_at` is set by `mark_learning_done()` when the learner finishes Part 1, and the assessment stays locked until then. **Part 2, Knowledge assessment:** `questions` (types: short, long, multiple_choice, true_false); `question_keys` holds the correct answers and is admin-only, so learners can never read it
- `invites` (code → organisation, optional package, optional `title`, plus any hand-picked workbooks in `invite_workbooks`; max_uses; expires_at). Sign-up enrols the learner in the package (if any) and adds the invite's workbooks.
- `enrollments` (learner + package **or** a custom workbook selection, where `package_id` is null; `title` is the training name shown everywhere; use `tName(e)` = `e.title || e.packages?.name` in JS; `status`: workbooks → ready_for_practical → practical_complete → completed, plus withdrawn)
- `assignments` (one per enrollment + workbook; not_started / in_progress / submitted / resubmit / competent) → `answers`
- `practical_assessments` → `practical_results` (per competency)
- `feedback` (one per assignment or per practical)

## Key logic (in SQL)
- `handle_new_user` trigger on `auth.users`: reads `invite_code`, `package_code`, `full_name` and `phone` (`dob` is optional; the sign-up form no longer asks for it, the admin can add it on the learner page) from the sign-up metadata, creates the profile, and calls `enroll_learner`. A bad code makes the sign-up fail.
- `check_invite` (callable by anon) validates a code before sign-up.
- `save_answers` and `submit_assignment`: the learner's only write path. Submitting auto-marks multiple-choice and true/false questions.
- `finalise_review` (admin): sets competent or resubmit and calculates the score.
- Triggers keep `enrollments.status` in step: all workbooks competent → ready_for_practical; a signed-off competent practical → practical_complete.
- `issue_certificate` (admin): sets the certificate number (`HIS-YYYY-####`), the completion date, and the expiry from `packages.validity_months`.
- `is_admin()` sits behind an admin_all policy on every table. Learners get read-only policies on their own rows.

## Front end
- `js/app.js`: auth, sign-up, guest demo (`#/try` signs in anonymously with `DEMO_INVITE_CODE` from config.js; guests have no email and are labelled "Demo guest" in admin), hash router, shared helpers (`must`, `esc`, `badge`, `formatText` – blank line = paragraph, `- ` bullets, `## ` sub-heading, `**bold**`)
- `js/admin.js`: admin screens; the organisation switcher filters through `state.org`. Workbook library and preview (`#/a/preview/:id`), workbook editor (Part 1, Part 2, practical skills, Available to), package builder with checklist preview, invite codes with workbook selection
- `js/learner.js`: learner dashboard (each training card's progress steps Workbooks / Practical / Final review / Certificate double as its tabs and open on the current stage; Practical shows the observation checklist and results, Review shows results, feedback status and the report, Certificate links to the real or SAMPLE certificate; demo guests also get an unsaved interactive copy of the trainer's observation form in the Practical tab), workbook Part 1 (`#/wb/:id/learn`) and Part 2 (`#/wb/:id/assess`), feedback form
- `js/documents.js`: printable post-training report and certificate (`#/doc/report/:id`, `#/doc/cert/:id`). Before completion these show as an IN PROGRESS report and a SAMPLE certificate.
- Admin practical form: one row per skill with compact result buttons (Competent / Not yet / N/A / Not seen), an "Add notes" tick box that reveals a notes box (notes are only saved where it's ticked). Deliberately no "mark all" shortcut, so every skill has to be observed and recorded one by one.

## Working rules
- Change the database with new migration SQL, saved in `supabase/migrations/` and also appended to `schema.sql` so a fresh install stays complete. Never edit live data without asking the owner first.
- Keep the security model intact: learners must never get write access to marking fields or read access to `question_keys`.
- Australian English and dates (en-AU).
- Open items: certificate expiry rules (currently an optional per-package `validity_months`), custom SMTP, and possibly a read-only login for organisation contacts.
