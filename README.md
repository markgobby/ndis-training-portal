# NDIS High Intensity Supports – Training Portal

A web app for running workbook theory, practical assessment, feedback, reports and certificates across multiple organisations.

- **Learners** sign up with an invite code and package plan number, complete their assigned online workbooks, and give feedback after each workbook and each practical.
- **The admin (you)** marks workbooks, records practical competency checklists, issues certificates, and prints post-training reports. An organisation switcher in the top bar filters every screen to one organisation.

It's plain HTML/JavaScript, so there's no build step. The database and logins run on Supabase.

---

## Setup (about 30 minutes)

### 1. Create the Supabase project
1. Sign up at supabase.com with the account this is being built for.
2. Click **New project**. Choose the region **Sydney (ap-southeast-2)** and save the database password somewhere safe.

### 2. Create the database
1. In the project, go to **SQL Editor → New query**.
2. Paste in all of `supabase/schema.sql` and click **Run**.
3. Optional: run `supabase/sample-data.sql` to add a demo organisation, a package (`HIS-DEMO`), a workbook, a competency checklist and invite code `DEMO01`.

### 3. Connect the app
1. In Supabase, go to **Project Settings → API**. Copy the **Project URL** and the **publishable / anon key**.
2. Open `js/config.js` and paste both in.
3. In the same file, fill in your details under `BRAND`. These are printed on reports and certificates.
4. Optional: put a `logo.png` next to `index.html` and set `logoUrl: 'logo.png'`.

The publishable key is designed to be public. All data is protected by the row-level security rules in `schema.sql`.

### 4. Put it on GitHub
1. Create a new **private** repository on GitHub.
2. Choose **Add file → Upload files** and drag in everything from this folder (`index.html`, `css/`, `js/`, `supabase/`, `README.md`).
3. Commit.

### 5. Publish it (free)
**Netlify** (simplest): go to **Add new site → Import from GitHub** and pick the repo.
- Build command: *(leave blank)*
- Publish directory: `/`

Vercel works the same way: choose framework **Other**, with no build command.

You'll get a web address like `https://your-site.netlify.app`. You can add your own domain later.

### 6. Tell Supabase your web address
Go to **Authentication → URL Configuration**:
- **Site URL**: your web address
- **Redirect URLs**: add the same address

This is needed for the email-confirmation and password-reset links to work.

### 7. Make yourself the admin
1. Go to **Authentication → Users → Add user → Create new user**. Enter your email and a password, and tick **Auto confirm**.
2. In the **SQL Editor**, run:
   ```sql
   update profiles set role = 'admin' where email = 'you@example.com';
   ```
3. Sign in on your site. You'll land on the admin dashboard.

---

## Day-to-day workflow

1. **Organisations**: add each client organisation.
2. **Workbooks**: build each workbook in the app, or import its questions from a CSV (see below). Question types are short answer, long answer, multiple choice and true/false. Multiple-choice and true/false questions are marked automatically. You mark written answers as *Satisfactory* or *Not satisfactory*, and can comment on each one.
3. **Packages**: a package plan number (e.g. `HIS-PEG-01`) bundles the required workbooks and the practical competency checklist. You can also set an optional certificate validity in months.
4. **Invite codes**: create a code for an organisation, optionally tied to a package. Press **Copy message** and paste it into an email or SMS. One code can serve a whole group. You can limit how many times it's used and set an expiry date.
5. **Learners sign up**: they enter the code, then their name, email and password. Their account is linked to the organisation, and the package's workbooks are assigned automatically. You don't create accounts yourself.
6. **Review**: submitted workbooks appear on the dashboard and in **Review**. Mark each one competent, or return it for resubmission with comments.
7. When every workbook is competent, the learner moves to **Ready for practical**.
8. **Practical**: open the learner and choose **Record practical assessment**. Tick each competency, add notes, then sign off. You can save a draft partway through.
9. **Issue certificate**: this records a certificate number (e.g. `HIS-2026-1001`). The **Training report** and **Certificate** buttons then open print-ready pages. Use *Print → Save as PDF* to email them. Learners can also view their own copies.
10. **Feedback**: learners are prompted after each workbook and practical. Results and averages appear in **Feedback**, filtered by organisation.

**Other tasks**
- To assign an extra workbook to one learner, open the learner and use **Assign another workbook**.
- When you add a workbook to a package, the app offers to assign it to everyone currently enrolled in that package.
- To update a workbook that learners have already started, use **Save as new version**. Their existing answers stay intact, and you can archive the old version.

### CSV format for importing questions
The first row must contain these headings:

| section | question | type | options | answer | marks |
|---|---|---|---|---|---|
| Safety | What do you do first? | short | | Hand hygiene | 1 |
| Safety | Flush volume? | multiple_choice | 10 mL\|30 mL\|100 mL | 30 mL | 1 |
| Safety | Check the plan each time. | true_false | | True | 1 |

You can download a ready-made template from the workbook editor.

---

## Good to know
- **Email limits**: Supabase's built-in email only sends a handful of messages per hour. Before going live, set up your own SMTP sender under **Authentication → Emails → SMTP Settings**. Brevo, Resend or Google Workspace all work.
- **Free plan**: free projects pause after about a week with no activity and don't include daily backups. For a live service holding client data, the Pro plan (about US$25/month) avoids both. You can also export data from **Database → Backups** or the Table Editor.
- **Privacy**: the app stores names, contact details and training records (plus date of birth if you add it on the learner page). Keep the project in the Sydney region, keep the GitHub repo private, and cover this in your privacy policy.
- **Security**: learners can only ever see their own records. Correct answers live in a table learners can't read. Only accounts with `role = 'admin'` can see across organisations.

## Files
```
index.html            app shell
css/styles.css        styling, including print layouts
js/config.js          ← your Supabase keys and branding
js/app.js             login, sign-up, routing
js/learner.js         learner portal
js/admin.js           admin portal
js/documents.js       post-training report and certificate
supabase/schema.sql   database, security rules and workflow logic
supabase/sample-data.sql  optional demo content
```
