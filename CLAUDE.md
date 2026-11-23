# Project context for Claude

NDIS High Intensity Supports training portal. One trainer/assessor (the admin) runs theory workbooks and practical assessments for learners from multiple client organisations.

## Stack
- Static site with no build step: `index.html`, `css/styles.css`, and ES modules in `js/`. Supabase JS loads from the jsDelivr CDN.
- Supabase handles Postgres, Auth (email + password) and row-level security. The full schema, policies and workflow functions are in `supabase/schema.sql`.
- Hosted on Netlify or Vercel from this repo, with no build command.
- Keys and branding live in `js/config.js`. The publishable/anon key there is meant to be public.

## Data model (public schema)
- `organisations` → `profiles` (`role`: admin / learner / pending; `organisation_id`)
- `packages` (the `code` is the "package plan number") ↔ `workbooks` via `package_workbooks`; `competencies` hold each package's practical checklist
- Each workbook has two parts. **Part 1, Learning:** `learning_items` (kind `content` = heading + simple-formatted text; kind `practice` = unrecorded multiple-choice/true-false check with answer and explanation, which learners can read). `assignments.learning_done_at` is set by `mark_learning_done()` when the learner finishes Part 1, and the assessment stays locked until then. **Part 2, Knowledge assessment:** `questions` (types: short, long, multiple_choice, true_false); `question_keys` holds the correct answers and is admin-only, so learners can never read it
- `invites` (code → organisation + optional package; max_uses; expires_at)
- `enrollments` (learner + package; `status`: workbooks → ready_for_practical → practical_complete → completed, plus withdrawn)
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
- `js/app.js`: auth, sign-up, hash router, shared helpers (`must`, `esc`, `badge`, `formatText` – blank line = paragraph, `- ` bullets, `## ` sub-heading, `**bold**`)
- `js/admin.js`: admin screens; the organisation switcher filters through `state.org`
- `js/learner.js`: learner dashboard, workbook Part 1 (`#/wb/:id/learn`) and Part 2 (`#/wb/:id/assess`), feedback form
- `js/documents.js`: printable post-training report and certificate (`#/doc/report/:id`, `#/doc/cert/:id`)

## Working rules
- Change the database with new migration SQL, saved in `supabase/migrations/` and also appended to `schema.sql` so a fresh install stays complete. Never edit live data without asking the owner first.
- Keep the security model intact: learners must never get write access to marking fields or read access to `question_keys`.
- Australian English and dates (en-AU).
- Open items: certificate expiry rules (currently an optional per-package `validity_months`), custom SMTP, and possibly a read-only login for organisation contacts.
