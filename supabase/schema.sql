-- =====================================================================
-- NDIS High Intensity Supports – Training Portal
-- Run this whole file once in Supabase: Dashboard > SQL Editor > New query
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- TABLES
-- ---------------------------------------------------------------------

create table public.organisations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,
  contact_name  text,
  contact_email text,
  phone         text,
  notes         text,
  created_at    timestamptz not null default now()
);

create table public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  role            text not null default 'pending' check (role in ('admin','learner','pending')),
  full_name       text,
  dob             date,
  email           text,
  phone           text,
  organisation_id uuid references public.organisations(id) on delete set null,
  created_at      timestamptz not null default now()
);

-- A "package plan" = a set of workbooks + a practical competency checklist
create table public.packages (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique,          -- the package plan number learners enter
  name            text not null,
  description     text,
  validity_months int,                           -- optional certificate expiry (null = none)
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);

create table public.workbooks (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  description  text,
  version      text not null default '1.0',
  pass_percent int not null default 100 check (pass_percent between 0 and 100),
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);

create table public.questions (
  id          uuid primary key default gen_random_uuid(),
  workbook_id uuid not null references public.workbooks(id) on delete cascade,
  position    int not null default 0,
  section     text,                       -- optional heading the question sits under
  prompt      text not null,
  qtype       text not null check (qtype in ('short','long','multiple_choice','true_false')),
  options     jsonb not null default '[]'::jsonb,  -- for multiple choice: ["A","B","C"]
  marks       int not null default 1
);
create index on public.questions(workbook_id, position);

-- Correct answers are kept apart so learners can never read them
create table public.question_keys (
  question_id    uuid primary key references public.questions(id) on delete cascade,
  correct_answer text,
  marking_guide  text
);

create table public.package_workbooks (
  package_id  uuid not null references public.packages(id) on delete cascade,
  workbook_id uuid not null references public.workbooks(id) on delete cascade,
  position    int not null default 0,
  primary key (package_id, workbook_id)
);

create table public.competencies (
  id          uuid primary key default gen_random_uuid(),
  package_id  uuid not null references public.packages(id) on delete cascade,
  position    int not null default 0,
  description text not null
);

-- Invite codes: one code can be shared with a whole group from one organisation
create table public.invites (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique,
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  package_id      uuid references public.packages(id) on delete set null, -- optional; learner can enter package plan number instead
  max_uses        int,                 -- null = unlimited
  uses            int not null default 0,
  expires_at      timestamptz,
  is_active       boolean not null default true,
  note            text,
  created_at      timestamptz not null default now()
);

create sequence public.certificate_seq start 1001;

create table public.enrollments (
  id                 uuid primary key default gen_random_uuid(),
  learner_id         uuid not null references public.profiles(id) on delete cascade,
  package_id         uuid not null references public.packages(id),
  organisation_id    uuid references public.organisations(id) on delete set null,
  status             text not null default 'workbooks'
                     check (status in ('workbooks','ready_for_practical','practical_complete','completed','withdrawn')),
  started_at         timestamptz not null default now(),
  completed_at       timestamptz,
  expires_at         timestamptz,
  certificate_number text unique,
  trainer_comments   text,
  unique (learner_id, package_id)
);

create table public.assignments (
  id             uuid primary key default gen_random_uuid(),
  enrollment_id  uuid not null references public.enrollments(id) on delete cascade,
  learner_id     uuid not null references public.profiles(id) on delete cascade,
  workbook_id    uuid not null references public.workbooks(id),
  status         text not null default 'not_started'
                 check (status in ('not_started','in_progress','submitted','resubmit','competent')),
  attempt        int not null default 1,
  score          numeric,
  submitted_at   timestamptz,
  reviewed_at    timestamptz,
  reviewer_notes text,
  created_at     timestamptz not null default now(),
  unique (enrollment_id, workbook_id)
);

create table public.answers (
  id             uuid primary key default gen_random_uuid(),
  assignment_id  uuid not null references public.assignments(id) on delete cascade,
  question_id    uuid not null references public.questions(id) on delete cascade,
  response       text,
  is_correct     boolean,
  marker_comment text,
  updated_at     timestamptz not null default now(),
  unique (assignment_id, question_id)
);

create table public.practical_assessments (
  id            uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  assessed_on   date not null default current_date,
  location      text,
  outcome       text not null default 'draft' check (outcome in ('draft','competent','not_yet_competent')),
  notes         text,
  assessor_name text,
  signed_off_at timestamptz,
  created_at    timestamptz not null default now()
);

create table public.practical_results (
  practical_id  uuid not null references public.practical_assessments(id) on delete cascade,
  competency_id uuid not null references public.competencies(id) on delete cascade,
  result        text not null default 'not_assessed' check (result in ('competent','not_yet','not_applicable','not_assessed')),
  notes         text,
  primary key (practical_id, competency_id)
);

create table public.feedback (
  id              uuid primary key default gen_random_uuid(),
  learner_id      uuid not null references public.profiles(id) on delete cascade,
  assignment_id   uuid references public.assignments(id) on delete cascade,
  practical_id    uuid references public.practical_assessments(id) on delete cascade,
  rating_overall  int check (rating_overall between 1 and 5),
  rating_content  int check (rating_content between 1 and 5),
  rating_trainer  int check (rating_trainer between 1 and 5),
  confidence      int check (confidence between 1 and 5),
  liked           text,
  improve         text,
  created_at      timestamptz not null default now(),
  check ((assignment_id is not null) <> (practical_id is not null))
);
create unique index feedback_one_per_assignment on public.feedback(assignment_id) where assignment_id is not null;
create unique index feedback_one_per_practical  on public.feedback(practical_id)  where practical_id  is not null;

-- ---------------------------------------------------------------------
-- HELPERS
-- ---------------------------------------------------------------------

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- Creates an enrollment for a learner in a package and assigns all its workbooks
create or replace function public.enroll_learner(p_learner uuid, p_package uuid, p_org uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_enr uuid;
begin
  if auth.uid() is not null and not public.is_admin() and auth.uid() <> p_learner then
    raise exception 'Not allowed';
  end if;
  insert into enrollments(learner_id, package_id, organisation_id)
  values (p_learner, p_package, p_org)
  on conflict (learner_id, package_id) do update set organisation_id = excluded.organisation_id
  returning id into v_enr;

  insert into assignments(enrollment_id, learner_id, workbook_id)
  select v_enr, p_learner, pw.workbook_id
  from package_workbooks pw join workbooks w on w.id = pw.workbook_id
  where pw.package_id = p_package and w.is_active
  on conflict (enrollment_id, workbook_id) do nothing;
  return v_enr;
end $$;

-- Lets the sign-up screen check a code before creating the account
create or replace function public.check_invite(p_code text, p_package_code text default null)
returns table(valid boolean, message text, organisation_name text, package_name text)
language plpgsql stable security definer set search_path = public as $$
declare i invites; o organisations; p packages;
begin
  select * into i from invites where upper(code) = upper(trim(p_code));
  if not found or not i.is_active then
    return query select false, 'That invite code was not found or is no longer active.', null::text, null::text; return;
  end if;
  if i.expires_at is not null and i.expires_at < now() then
    return query select false, 'That invite code has expired.', null::text, null::text; return;
  end if;
  if i.max_uses is not null and i.uses >= i.max_uses then
    return query select false, 'That invite code has already been used the maximum number of times.', null::text, null::text; return;
  end if;
  select * into o from organisations where id = i.organisation_id;
  if i.package_id is not null then
    select * into p from packages where id = i.package_id;
  elsif coalesce(trim(p_package_code),'') <> '' then
    select * into p from packages where upper(code) = upper(trim(p_package_code)) and is_active;
    if not found then
      return query select false, 'That package plan number was not found.', o.name, null::text; return;
    end if;
  else
    return query select false, 'Please enter your package plan number.', o.name, null::text; return;
  end if;
  return query select true, 'OK', o.name, p.name;
end $$;

-- Runs automatically when someone signs up. Uses the invite code they entered.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_code text := nullif(trim(meta->>'invite_code'), '');
  i invites; v_pkg uuid;
begin
  if v_code is null then
    -- Created from the dashboard (e.g. your admin account): profile waits for a role
    insert into profiles(id, email, full_name, role)
    values (new.id, new.email, meta->>'full_name', 'pending')
    on conflict (id) do nothing;
    return new;
  end if;

  select * into i from invites where upper(code) = upper(v_code) for update;
  if not found or not i.is_active
     or (i.expires_at is not null and i.expires_at < now())
     or (i.max_uses is not null and i.uses >= i.max_uses) then
    raise exception 'Invalid or expired invite code';
  end if;

  v_pkg := i.package_id;
  if v_pkg is null then
    select id into v_pkg from packages where upper(code) = upper(trim(meta->>'package_code')) and is_active;
    if v_pkg is null then raise exception 'Unknown package plan number'; end if;
  end if;

  insert into profiles(id, role, full_name, dob, email, phone, organisation_id)
  values (new.id, 'learner', meta->>'full_name', nullif(meta->>'dob','')::date, new.email,
          meta->>'phone', i.organisation_id);

  update invites set uses = uses + 1 where id = i.id;
  perform public.enroll_learner(new.id, v_pkg, i.organisation_id);
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

-- Keeps each enrollment's stage in step with its workbooks
create or replace function public.refresh_enrollment(p_enr uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_total int; v_done int; v_status text;
begin
  select status into v_status from enrollments where id = p_enr;
  if v_status is null or v_status in ('completed','withdrawn') then return; end if;
  select count(*), count(*) filter (where status = 'competent') into v_total, v_done
  from assignments where enrollment_id = p_enr;
  if v_total > 0 and v_total = v_done then
    if v_status = 'workbooks' then
      update enrollments set status = 'ready_for_practical' where id = p_enr;
    end if;
  else
    -- a new or re-opened workbook sends them back to the workbook stage
    update enrollments set status = 'workbooks' where id = p_enr and status <> 'workbooks';
  end if;
end $$;

create or replace function public.trg_assignment_changed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.refresh_enrollment(coalesce(new.enrollment_id, old.enrollment_id));
  return null;
end $$;
create trigger assignment_changed after insert or update of status or delete on public.assignments
for each row execute function public.trg_assignment_changed();

create or replace function public.trg_practical_changed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.outcome = 'competent' and new.signed_off_at is not null then
    update enrollments set status = 'practical_complete'
    where id = new.enrollment_id and status = 'ready_for_practical';
  end if;
  return null;
end $$;
create trigger practical_changed after insert or update on public.practical_assessments
for each row execute function public.trg_practical_changed();

-- ---------------------------------------------------------------------
-- LEARNER ACTIONS
-- ---------------------------------------------------------------------

-- Save draft answers: p_answers = {"<question_id>": "response", ...}
create or replace function public.save_answers(p_assignment uuid, p_answers jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare a assignments; k text; v text;
begin
  select * into a from assignments where id = p_assignment;
  if a.id is null or a.learner_id <> auth.uid() then raise exception 'Not your workbook'; end if;
  if a.status not in ('not_started','in_progress','resubmit') then raise exception 'This workbook is locked'; end if;
  for k, v in select key, value from jsonb_each_text(p_answers) loop
    if exists (select 1 from questions where id = k::uuid and workbook_id = a.workbook_id) then
      insert into answers(assignment_id, question_id, response, updated_at)
      values (p_assignment, k::uuid, v, now())
      on conflict (assignment_id, question_id) do update set response = excluded.response, updated_at = now();
    end if;
  end loop;
  if a.status = 'not_started' then
    update assignments set status = 'in_progress' where id = p_assignment;
  end if;
end $$;

-- Submit for marking. Multiple-choice and true/false are marked automatically.
create or replace function public.submit_assignment(p_assignment uuid)
returns void language plpgsql security definer set search_path = public as $$
declare a assignments; v_missing int;
begin
  select * into a from assignments where id = p_assignment;
  if a.id is null or a.learner_id <> auth.uid() then raise exception 'Not your workbook'; end if;
  if a.status not in ('in_progress','resubmit','not_started') then raise exception 'Already submitted'; end if;

  select count(*) into v_missing from questions q
  left join answers an on an.question_id = q.id and an.assignment_id = p_assignment
  where q.workbook_id = a.workbook_id and coalesce(trim(an.response),'') = '';
  if v_missing > 0 then raise exception 'Please answer all questions (% left)', v_missing; end if;

  update answers an set is_correct = (lower(trim(an.response)) = lower(trim(k.correct_answer)))
  from questions q join question_keys k on k.question_id = q.id
  where an.assignment_id = p_assignment and an.question_id = q.id
    and q.qtype in ('multiple_choice','true_false') and k.correct_answer is not null;

  -- clear previous marks on written answers so they get re-marked
  update answers an set is_correct = null
  from questions q
  where an.assignment_id = p_assignment and an.question_id = q.id and q.qtype in ('short','long');

  update assignments set status = 'submitted', submitted_at = now() where id = p_assignment;
end $$;

-- ---------------------------------------------------------------------
-- ADMIN ACTIONS
-- ---------------------------------------------------------------------

-- Finish marking a workbook: outcome = 'competent' or 'resubmit'
create or replace function public.finalise_review(p_assignment uuid, p_outcome text, p_notes text)
returns void language plpgsql security definer set search_path = public as $$
declare v_score numeric;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if p_outcome not in ('competent','resubmit') then raise exception 'Bad outcome'; end if;
  select round(100.0 * coalesce(sum(q.marks) filter (where an.is_correct), 0) / nullif(sum(q.marks),0), 1)
    into v_score
  from questions q join assignments a on a.workbook_id = q.workbook_id
  left join answers an on an.question_id = q.id and an.assignment_id = a.id
  where a.id = p_assignment;
  update assignments
     set status = p_outcome, score = v_score, reviewed_at = now(), reviewer_notes = p_notes,
         attempt = case when p_outcome = 'resubmit' then attempt + 1 else attempt end
   where id = p_assignment;
end $$;

-- Issue the certificate once workbooks and practical are complete
create or replace function public.issue_certificate(p_enr uuid, p_comments text)
returns text language plpgsql security definer set search_path = public as $$
declare e enrollments; p packages; v_no text;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  select * into e from enrollments where id = p_enr;
  if e.status not in ('practical_complete','completed') then
    raise exception 'Workbooks and practical must be complete first';
  end if;
  select * into p from packages where id = e.package_id;
  v_no := coalesce(e.certificate_number,
                   'HIS-' || to_char(now(),'YYYY') || '-' || nextval('certificate_seq'));
  update enrollments set status = 'completed', certificate_number = v_no,
         completed_at = coalesce(completed_at, now()),
         expires_at = case when p.validity_months is null then null
                           else coalesce(completed_at, now()) + make_interval(months => p.validity_months) end,
         trainer_comments = coalesce(p_comments, trainer_comments)
   where id = p_enr;
  return v_no;
end $$;

-- ---------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ---------------------------------------------------------------------

alter table public.organisations         enable row level security;
alter table public.profiles              enable row level security;
alter table public.packages              enable row level security;
alter table public.workbooks             enable row level security;
alter table public.questions             enable row level security;
alter table public.question_keys         enable row level security;
alter table public.package_workbooks     enable row level security;
alter table public.competencies          enable row level security;
alter table public.invites               enable row level security;
alter table public.enrollments           enable row level security;
alter table public.assignments           enable row level security;
alter table public.answers               enable row level security;
alter table public.practical_assessments enable row level security;
alter table public.practical_results     enable row level security;
alter table public.feedback              enable row level security;

-- Admin can do everything everywhere
do $$
declare t text;
begin
  foreach t in array array['organisations','profiles','packages','workbooks','questions','question_keys',
    'package_workbooks','competencies','invites','enrollments','assignments','answers',
    'practical_assessments','practical_results','feedback']
  loop
    execute format('create policy admin_all on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;

-- Learners: read-only access to their own records
create policy own_profile on public.profiles for select to authenticated using (id = auth.uid());

create policy own_org on public.organisations for select to authenticated
  using (id = (select organisation_id from public.profiles where id = auth.uid()));

create policy own_enrollments on public.enrollments for select to authenticated using (learner_id = auth.uid());

create policy own_packages on public.packages for select to authenticated
  using (exists (select 1 from public.enrollments e where e.package_id = packages.id and e.learner_id = auth.uid()));

create policy own_assignments on public.assignments for select to authenticated using (learner_id = auth.uid());

create policy assigned_workbooks on public.workbooks for select to authenticated
  using (exists (select 1 from public.assignments a where a.workbook_id = workbooks.id and a.learner_id = auth.uid()));

create policy assigned_questions on public.questions for select to authenticated
  using (exists (select 1 from public.assignments a where a.workbook_id = questions.workbook_id and a.learner_id = auth.uid()));

create policy own_answers on public.answers for select to authenticated
  using (exists (select 1 from public.assignments a where a.id = answers.assignment_id and a.learner_id = auth.uid()));

create policy own_competencies on public.competencies for select to authenticated
  using (exists (select 1 from public.enrollments e where e.package_id = competencies.package_id and e.learner_id = auth.uid()));

create policy own_practicals on public.practical_assessments for select to authenticated
  using (outcome <> 'draft' and exists (select 1 from public.enrollments e where e.id = practical_assessments.enrollment_id and e.learner_id = auth.uid()));

create policy own_practical_results on public.practical_results for select to authenticated
  using (exists (select 1 from public.practical_assessments p join public.enrollments e on e.id = p.enrollment_id
                 where p.id = practical_results.practical_id and p.outcome <> 'draft' and e.learner_id = auth.uid()));

create policy own_feedback_read on public.feedback for select to authenticated using (learner_id = auth.uid());
create policy own_feedback_write on public.feedback for insert to authenticated with check (
  learner_id = auth.uid() and (
    (assignment_id is not null and exists (select 1 from public.assignments a where a.id = assignment_id and a.learner_id = auth.uid()))
    or (practical_id is not null and exists (select 1 from public.practical_assessments p join public.enrollments e on e.id = p.enrollment_id
                                             where p.id = practical_id and e.learner_id = auth.uid()))
  ));

-- Function permissions
revoke execute on function public.enroll_learner(uuid,uuid,uuid) from public, anon;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.refresh_enrollment(uuid) from public, anon, authenticated;
grant  execute on function public.check_invite(text,text) to anon, authenticated;
grant  execute on function public.save_answers(uuid,jsonb) to authenticated;
grant  execute on function public.submit_assignment(uuid) to authenticated;
grant  execute on function public.finalise_review(uuid,text,text) to authenticated;
grant  execute on function public.issue_certificate(uuid,text) to authenticated;
grant  execute on function public.enroll_learner(uuid,uuid,uuid) to authenticated;
revoke execute on function public.save_answers(uuid,jsonb) from anon;
revoke execute on function public.submit_assignment(uuid) from anon;
revoke execute on function public.finalise_review(uuid,text,text) from anon;
revoke execute on function public.issue_certificate(uuid,text) from anon;
revoke execute on function public.is_admin() from public, anon;
grant  execute on function public.is_admin() to authenticated;
revoke execute on function public.trg_assignment_changed() from public, anon, authenticated;
revoke execute on function public.trg_practical_changed() from public, anon, authenticated;

-- Table access for the API roles (newer Supabase projects don't grant this automatically).
-- Signed-in users get table access; row-level security above still decides which rows.
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant usage, select on sequences to authenticated;
revoke all on all tables in schema public from anon;

-- =====================================================================
-- Part 1 learning material (also in supabase/migrations/002_learning_material.sql)
-- =====================================================================
create table public.learning_items (
  id           uuid primary key default gen_random_uuid(),
  workbook_id  uuid not null references public.workbooks(id) on delete cascade,
  position     int not null default 0,
  kind         text not null check (kind in ('content','practice')),
  title        text,                 -- section heading (content) or optional label (practice)
  body         text,                 -- content text (simple formatting) or the practice question
  qtype        text check (qtype in ('multiple_choice','true_false')),
  options      jsonb not null default '[]'::jsonb,
  answer       text,                 -- practice answer: shown to the learner after they check, never recorded
  explanation  text
);
create index on public.learning_items(workbook_id, position);

alter table public.assignments add column if not exists learning_done_at timestamptz;

alter table public.learning_items enable row level security;
create policy admin_all on public.learning_items for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy assigned_learning on public.learning_items for select to authenticated
  using (exists (select 1 from public.assignments a where a.workbook_id = learning_items.workbook_id and a.learner_id = auth.uid()));

grant select, insert, update, delete on public.learning_items to authenticated;
revoke all on public.learning_items from anon;

-- Learner confirms they've finished the learning material (the only thing recorded from Part 1)
create or replace function public.mark_learning_done(p_assignment uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update assignments set learning_done_at = coalesce(learning_done_at, now()),
         status = case when status = 'not_started' then 'in_progress' else status end
   where id = p_assignment and learner_id = auth.uid();
  if not found then raise exception 'Not your workbook'; end if;
end $$;
revoke execute on function public.mark_learning_done(uuid) from public, anon;
grant execute on function public.mark_learning_done(uuid) to authenticated;

-- =====================================================================
-- Workbook-linked practical skills, custom invites, organisation scoping
-- (also in supabase/migrations/003_workbook_skills_and_custom_invites.sql)
-- =====================================================================

-- 1. Practical skills linked to a workbook OR a package
alter table public.competencies alter column package_id drop not null;
alter table public.competencies add column if not exists workbook_id uuid references public.workbooks(id) on delete cascade;
alter table public.competencies add constraint competency_owner check ((package_id is not null) <> (workbook_id is not null));
create index if not exists competencies_workbook_idx on public.competencies(workbook_id, position);

-- 2. Enrolments can be a package OR a custom set of workbooks; title is what shows on reports/certificates
alter table public.enrollments alter column package_id drop not null;
alter table public.enrollments add column if not exists title text;
update public.enrollments e set title = p.name from public.packages p where p.id = e.package_id and e.title is null;

-- 3. Invite codes can include a hand-picked set of workbooks
alter table public.invites add column if not exists title text;
create table public.invite_workbooks (
  invite_id   uuid not null references public.invites(id) on delete cascade,
  workbook_id uuid not null references public.workbooks(id) on delete cascade,
  position    int not null default 0,
  primary key (invite_id, workbook_id)
);
alter table public.invite_workbooks enable row level security;
create policy admin_all on public.invite_workbooks for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.invite_workbooks to authenticated;
revoke all on public.invite_workbooks from anon;

-- Learners can read the practical skills that apply to them
drop policy if exists own_competencies on public.competencies;
create policy own_competencies on public.competencies for select to authenticated using (
  exists (select 1 from public.enrollments e where e.package_id = competencies.package_id and e.learner_id = auth.uid())
  or exists (select 1 from public.assignments a where a.workbook_id = competencies.workbook_id and a.learner_id = auth.uid()));

-- Package enrolment now records the training title
create or replace function public.enroll_learner(p_learner uuid, p_package uuid, p_org uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_enr uuid;
begin
  if auth.uid() is not null and not public.is_admin() and auth.uid() <> p_learner then
    raise exception 'Not allowed';
  end if;
  insert into enrollments(learner_id, package_id, organisation_id, title)
  values (p_learner, p_package, p_org, (select name from packages where id = p_package))
  on conflict (learner_id, package_id) do update set organisation_id = excluded.organisation_id
  returning id into v_enr;

  insert into assignments(enrollment_id, learner_id, workbook_id)
  select v_enr, p_learner, pw.workbook_id
  from package_workbooks pw join workbooks w on w.id = pw.workbook_id
  where pw.package_id = p_package and w.is_active
  on conflict (enrollment_id, workbook_id) do nothing;
  return v_enr;
end $$;

-- What the sign-up screen shows before the account is created
create or replace function public.check_invite(p_code text, p_package_code text default null)
returns table(valid boolean, message text, organisation_name text, package_name text)
language plpgsql stable security definer set search_path = public as $$
declare i invites; o organisations; p packages; v_has_wb boolean;
begin
  select * into i from invites where upper(code) = upper(trim(p_code));
  if not found or not i.is_active then
    return query select false, 'That invite code was not found or is no longer active.', null::text, null::text; return;
  end if;
  if i.expires_at is not null and i.expires_at < now() then
    return query select false, 'That invite code has expired.', null::text, null::text; return;
  end if;
  if i.max_uses is not null and i.uses >= i.max_uses then
    return query select false, 'That invite code has already been used the maximum number of times.', null::text, null::text; return;
  end if;
  select * into o from organisations where id = i.organisation_id;
  v_has_wb := exists (select 1 from invite_workbooks where invite_id = i.id);
  if i.package_id is not null then
    select * into p from packages where id = i.package_id;
    return query select true, 'OK', o.name, coalesce(i.title, p.name); return;
  elsif v_has_wb then
    return query select true, 'OK', o.name, coalesce(i.title, 'Training'); return;
  elsif coalesce(trim(p_package_code),'') <> '' then
    select * into p from packages where upper(code) = upper(trim(p_package_code)) and is_active;
    if not found then
      return query select false, 'That package plan number was not found.', o.name, null::text; return;
    end if;
    return query select true, 'OK', o.name, p.name; return;
  end if;
  return query select false, 'Please enter your package plan number.', o.name, null::text;
end $$;

-- Sign-up: enrol in the code's package and/or its hand-picked workbooks
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_code text := nullif(trim(meta->>'invite_code'), '');
  i invites; v_pkg uuid; v_enr uuid; v_has_wb boolean;
begin
  if v_code is null then
    insert into profiles(id, email, full_name, role)
    values (new.id, new.email, meta->>'full_name', 'pending')
    on conflict (id) do nothing;
    return new;
  end if;

  select * into i from invites where upper(code) = upper(v_code) for update;
  if not found or not i.is_active
     or (i.expires_at is not null and i.expires_at < now())
     or (i.max_uses is not null and i.uses >= i.max_uses) then
    raise exception 'Invalid or expired invite code';
  end if;

  v_has_wb := exists (select 1 from invite_workbooks where invite_id = i.id);
  v_pkg := i.package_id;
  if v_pkg is null and not v_has_wb then
    select id into v_pkg from packages where upper(code) = upper(trim(meta->>'package_code')) and is_active;
    if v_pkg is null then raise exception 'Unknown package plan number'; end if;
  end if;

  insert into profiles(id, role, full_name, dob, email, phone, organisation_id)
  values (new.id, 'learner', meta->>'full_name', nullif(meta->>'dob','')::date, new.email,
          meta->>'phone', i.organisation_id);
  update invites set uses = uses + 1 where id = i.id;

  if v_pkg is not null then
    v_enr := public.enroll_learner(new.id, v_pkg, i.organisation_id);
    if i.title is not null then update enrollments set title = i.title where id = v_enr; end if;
  else
    insert into enrollments(learner_id, package_id, organisation_id, title)
    values (new.id, null, i.organisation_id, coalesce(i.title, 'Training'))
    returning id into v_enr;
  end if;

  insert into assignments(enrollment_id, learner_id, workbook_id)
  select v_enr, new.id, iw.workbook_id
  from invite_workbooks iw join workbooks w on w.id = iw.workbook_id
  where iw.invite_id = i.id and w.is_active
  on conflict (enrollment_id, workbook_id) do nothing;
  return new;
end $$;

-- The practical checklist for one enrolment: skills from its workbooks, then package-wide skills
create or replace function public.enrollment_competencies(p_enr uuid)
returns table(id uuid, description text, workbook_id uuid, group_title text, group_order int, item_order int)
language sql stable security definer set search_path = public as $$
  select c.id, c.description, c.workbook_id,
         coalesce(w.title, 'Whole package') as group_title,
         case when c.workbook_id is null then 9999 else coalesce(pw.position, 500) end as group_order,
         c.position as item_order
  from enrollments e
  join competencies c
    on (c.workbook_id in (select a.workbook_id from assignments a where a.enrollment_id = e.id))
    or (c.package_id is not null and c.package_id = e.package_id)
  left join workbooks w on w.id = c.workbook_id
  left join package_workbooks pw on pw.package_id = e.package_id and pw.workbook_id = c.workbook_id
  where e.id = p_enr and (public.is_admin() or e.learner_id = auth.uid())
  order by group_order, group_title, item_order;
$$;
revoke execute on function public.enrollment_competencies(uuid) from public, anon;
grant execute on function public.enrollment_competencies(uuid) to authenticated;

-- 4. Which organisations a workbook / package is offered to (no rows = all organisations)
create table public.workbook_organisations (
  workbook_id     uuid not null references public.workbooks(id) on delete cascade,
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  primary key (workbook_id, organisation_id)
);
create table public.package_organisations (
  package_id      uuid not null references public.packages(id) on delete cascade,
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  primary key (package_id, organisation_id)
);
alter table public.workbook_organisations enable row level security;
alter table public.package_organisations  enable row level security;
create policy admin_all on public.workbook_organisations for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all on public.package_organisations  for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.workbook_organisations, public.package_organisations to authenticated;
revoke all on public.workbook_organisations, public.package_organisations from anon;

-- ---------------------------------------------------------------------
-- 004: organisation role, roster, class codes, pack requests
-- ---------------------------------------------------------------------
-- =====================================================================
-- 004: organisation role, learner roster (username login), class codes,
--      pack requests, per-person modules, no-double-up guard
-- =====================================================================

-- 1. Roles and profile fields ------------------------------------------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin','learner','organisation','pending'));
alter table public.profiles add column if not exists username text;
alter table public.profiles add column if not exists requested_org text;   -- what an organisation contact typed when requesting an account
create unique index if not exists profiles_username_key on public.profiles (lower(username)) where username is not null;

-- 2. Roster: people an organisation wants trained (a username exists before the account does)
create table public.roster_learners (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  full_name       text not null,
  username        text not null,
  profile_id      uuid unique references public.profiles(id) on delete set null,
  is_active       boolean not null default true,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now()
);
create unique index roster_username_key on public.roster_learners (lower(username));
create index roster_org_idx on public.roster_learners (organisation_id);

-- 3. Pack requests: an organisation's request for training, modules chosen per person
create table public.pack_requests (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  title           text not null,
  preferred_dates text,
  notes           text,
  status          text not null default 'draft' check (status in ('draft','submitted','under_review','approved')),
  admin_note      text,
  submitted_at    timestamptz,
  approved_at     timestamptz,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now()
);
create index pack_requests_org_idx on public.pack_requests (organisation_id);

create table public.pack_request_items (
  id             uuid primary key default gen_random_uuid(),
  request_id     uuid not null references public.pack_requests(id) on delete cascade,
  roster_id      uuid not null references public.roster_learners(id) on delete cascade,
  workbook_id    uuid not null references public.workbooks(id),
  assignment_id  uuid references public.assignments(id) on delete set null,
  skipped_reason text,
  unique (request_id, roster_id, workbook_id)
);
create index pack_items_roster_idx on public.pack_request_items (roster_id);
create index pack_items_workbook_idx on public.pack_request_items (workbook_id);
create index pack_items_assignment_idx on public.pack_request_items (assignment_id);

-- 4. Class codes: one per approved request, valid until it expires
create table public.class_codes (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique,
  request_id      uuid not null unique references public.pack_requests(id) on delete cascade,
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  expires_at      timestamptz not null,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);
create index class_codes_org_idx on public.class_codes (organisation_id);

alter table public.enrollments add column if not exists pack_request_id uuid references public.pack_requests(id) on delete set null;
create index if not exists enrollments_pack_request_idx on public.enrollments (pack_request_id);

alter table public.roster_learners   enable row level security;
alter table public.pack_requests     enable row level security;
alter table public.pack_request_items enable row level security;
alter table public.class_codes       enable row level security;

-- 5. Helpers ------------------------------------------------------------
create or replace function public.my_org() returns uuid
language sql stable security definer set search_path = public as $$
  select organisation_id from public.profiles where id = auth.uid() and role = 'organisation';
$$;

create or replace function public.workbook_offered(p_workbook uuid, p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.workbooks w where w.id = p_workbook and w.is_active)
     and (not exists (select 1 from public.workbook_organisations wo where wo.workbook_id = p_workbook)
          or exists (select 1 from public.workbook_organisations wo where wo.workbook_id = p_workbook and wo.organisation_id = p_org));
$$;

-- Modules an organisation can choose from (no answers, no questions)
create or replace function public.org_catalogue()
returns table(id uuid, title text, description text, version text)
language sql stable security definer set search_path = public as $$
  select w.id, w.title, w.description, w.version
  from public.workbooks w
  where public.my_org() is not null and public.workbook_offered(w.id, public.my_org())
  order by w.title;
$$;

-- Username such as JohnSmith1 (first + last word of the name, then the next free number)
create or replace function public.make_username(p_name text) returns text
language plpgsql security definer set search_path = public as $$
declare parts text[]; f text; l text; base text; n int := 1;
begin
  parts := regexp_split_to_array(trim(p_name), '\s+');
  f := initcap(regexp_replace(parts[1], '[^A-Za-z]', '', 'g'));
  l := case when array_length(parts, 1) > 1 then initcap(regexp_replace(parts[array_length(parts, 1)], '[^A-Za-z]', '', 'g')) else '' end;
  base := f || l;
  if length(base) < 2 then raise exception 'Please enter the learner''s full name'; end if;
  while exists (select 1 from public.roster_learners where lower(username) = lower(base || n)) loop n := n + 1; end loop;
  return base || n;
end $$;

create or replace function public.gen_class_code() returns text
language plpgsql security definer set search_path = public as $$
declare alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; bytes bytea; c text; i int;
begin
  loop
    bytes := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
    c := '';
    for i in 0..7 loop c := c || substr(alphabet, (get_byte(bytes, i) % 32) + 1, 1); end loop;
    exit when not exists (select 1 from public.class_codes where code = c);
  end loop;
  return c;
end $$;

-- 6. No-double-up guard: a learner never gets the same workbook twice (withdrawn enrolments excluded)
create or replace function public.trg_assignment_no_dup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (
    select 1 from public.assignments a join public.enrollments e on e.id = a.enrollment_id
    where a.learner_id = new.learner_id and a.workbook_id = new.workbook_id and e.status <> 'withdrawn'
  ) then return null; end if;
  return new;
end $$;
create trigger assignment_no_dup before insert on public.assignments
for each row execute function public.trg_assignment_no_dup();

-- 7. Turn approved pack items into enrolments + assignments for an activated learner
create or replace function public.materialise_roster(p_roster uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.roster_learners; rq public.pack_requests; it public.pack_request_items;
        v_enr uuid; v_ass uuid; d record;
begin
  select * into r from public.roster_learners where id = p_roster;
  if not found or r.profile_id is null then return; end if;
  for rq in
    select distinct pr.* from public.pack_requests pr
    join public.pack_request_items i on i.request_id = pr.id
    where i.roster_id = p_roster and pr.status = 'approved'
  loop
    v_enr := null;
    for it in select * from public.pack_request_items
              where request_id = rq.id and roster_id = p_roster and assignment_id is null and skipped_reason is null
    loop
      select a.status, coalesce(a.reviewed_at, a.submitted_at) as done_at into d
      from public.assignments a join public.enrollments e on e.id = a.enrollment_id
      where a.learner_id = r.profile_id and a.workbook_id = it.workbook_id and e.status <> 'withdrawn'
      limit 1;
      if found then
        update public.pack_request_items set skipped_reason = case
          when d.status = 'competent' then 'Already completed' || coalesce(' on ' || to_char(d.done_at at time zone 'Australia/Perth', 'DD Mon YYYY'), '')
          else 'Already assigned' end
        where id = it.id;
      else
        if v_enr is null then
          select id into v_enr from public.enrollments where pack_request_id = rq.id and learner_id = r.profile_id;
          if v_enr is null then
            insert into public.enrollments(learner_id, package_id, organisation_id, title, pack_request_id)
            values (r.profile_id, null, r.organisation_id, rq.title, rq.id) returning id into v_enr;
          end if;
        end if;
        insert into public.assignments(enrollment_id, learner_id, workbook_id)
        values (v_enr, r.profile_id, it.workbook_id) returning id into v_ass;
        update public.pack_request_items set assignment_id = v_ass where id = it.id;
      end if;
    end loop;
  end loop;
end $$;

-- 8. Organisation actions -----------------------------------------------
create or replace function public.org_add_learner(p_name text, p_org uuid default null) returns public.roster_learners
language plpgsql security definer set search_path = public as $$
declare v_org uuid; r public.roster_learners;
begin
  if public.is_admin() then v_org := p_org; else v_org := public.my_org(); end if;
  if v_org is null then raise exception 'Not allowed'; end if;
  if length(trim(coalesce(p_name, ''))) < 3 then raise exception 'Please enter the learner''s full name'; end if;
  insert into public.roster_learners(organisation_id, full_name, username)
  values (v_org, trim(p_name), public.make_username(p_name)) returning * into r;
  return r;
end $$;

create or replace function public.submit_pack_request(p_request uuid) returns void
language plpgsql security definer set search_path = public as $$
declare rq public.pack_requests;
begin
  select * into rq from public.pack_requests where id = p_request;
  if not found or rq.organisation_id is distinct from public.my_org() then raise exception 'Not allowed'; end if;
  if rq.status <> 'draft' then raise exception 'This request has already been submitted'; end if;
  if not exists (select 1 from public.pack_request_items where request_id = p_request) then
    raise exception 'Add at least one learner and module first';
  end if;
  update public.pack_requests set status = 'submitted', submitted_at = now() where id = p_request;
end $$;

-- What an organisation sees of its learners (names, usernames, module status). No answers or marking detail.
create or replace function public.org_learner_status()
returns table(roster_id uuid, full_name text, username text, activated boolean, request_title text,
              request_status text, workbook_title text, module_status text, note text, done_on date)
language sql stable security definer set search_path = public as $$
  select r.id, r.full_name, r.username, r.profile_id is not null, pr.title, pr.status, w.title,
         case when i.skipped_reason is not null then 'skipped'
              when a.id is not null then a.status
              when pr.status = 'approved' then 'awaiting_activation'
              else pr.status end,
         i.skipped_reason, (a.reviewed_at at time zone 'Australia/Perth')::date
  from public.roster_learners r
  left join public.pack_request_items i on i.roster_id = r.id
  left join public.pack_requests pr on pr.id = i.request_id
  left join public.workbooks w on w.id = i.workbook_id
  left join public.assignments a on a.id = i.assignment_id
  where r.organisation_id = public.my_org() and r.is_active
  order by r.full_name, pr.created_at, w.title;
$$;

-- 9. Admin actions ------------------------------------------------------
create or replace function public.admin_review_request(p_request uuid, p_status text, p_note text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not allowed'; end if;
  if p_status not in ('draft','submitted','under_review') then raise exception 'Use approve to approve a request'; end if;
  update public.pack_requests set status = p_status, admin_note = p_note
  where id = p_request and status <> 'approved';
end $$;

-- Generates (or re-issues) the class code for a request
create or replace function public.set_class_code(p_request uuid, p_expires timestamptz, p_new boolean default false) returns text
language plpgsql security definer set search_path = public as $$
declare rq public.pack_requests; v_code text;
begin
  if not public.is_admin() then raise exception 'Not allowed'; end if;
  select * into rq from public.pack_requests where id = p_request;
  if not found or rq.status <> 'approved' then raise exception 'Approve the request first'; end if;
  select code into v_code from public.class_codes where request_id = p_request;
  if v_code is null then
    v_code := public.gen_class_code();
    insert into public.class_codes(code, request_id, organisation_id, expires_at) values (v_code, p_request, rq.organisation_id, p_expires);
  else
    if p_new then v_code := public.gen_class_code(); end if;
    update public.class_codes set code = v_code, expires_at = p_expires, is_active = true where request_id = p_request;
  end if;
  return v_code;
end $$;

create or replace function public.approve_pack_request(p_request uuid, p_expires timestamptz default (now() + interval '3 days'), p_note text default null)
returns text language plpgsql security definer set search_path = public as $$
declare rq public.pack_requests; v_code text; v_r uuid;
begin
  if not public.is_admin() then raise exception 'Not allowed'; end if;
  select * into rq from public.pack_requests where id = p_request;
  if not found then raise exception 'Request not found'; end if;
  if rq.status = 'draft' then raise exception 'This request has not been submitted yet'; end if;
  update public.pack_requests set status = 'approved', approved_at = coalesce(approved_at, now()),
    admin_note = coalesce(p_note, admin_note) where id = p_request;
  v_code := public.set_class_code(p_request, p_expires, false);
  for v_r in select distinct roster_id from public.pack_request_items where request_id = p_request loop
    perform public.materialise_roster(v_r);
  end loop;
  return v_code;
end $$;

-- Learners have no email reset: an admin, or the learner's own organisation, sets a new password
create or replace function public.reset_learner_password(p_roster uuid, p_password text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare r public.roster_learners;
begin
  select * into r from public.roster_learners where id = p_roster;
  if not found then raise exception 'Learner not found'; end if;
  if not (public.is_admin() or r.organisation_id = public.my_org()) then raise exception 'Not allowed'; end if;
  if r.profile_id is null then raise exception 'This learner has not activated their account yet'; end if;
  if length(coalesce(p_password, '')) < 8 then raise exception 'Password must be at least 8 characters'; end if;
  update auth.users set encrypted_password = crypt(p_password, gen_salt('bf')), updated_at = now() where id = r.profile_id;
  delete from auth.sessions where user_id = r.profile_id;
end $$;

-- 10. Activation: username + class code (callable before sign-in)
create or replace function public.check_activation(p_username text, p_code text)
returns table(valid boolean, message text, full_name text, organisation_name text, module_count int)
language plpgsql stable security definer set search_path = public as $$
declare r public.roster_learners; cc public.class_codes; n int;
begin
  select * into r from public.roster_learners where lower(username) = lower(trim(p_username)) and is_active;
  select * into cc from public.class_codes where upper(code) = upper(trim(p_code)) and is_active and expires_at > now();
  if r.id is null or cc.id is null or cc.organisation_id <> r.organisation_id
     or not exists (select 1 from public.pack_request_items i join public.pack_requests pr on pr.id = i.request_id
                    where i.request_id = cc.request_id and i.roster_id = r.id and pr.status = 'approved') then
    return query select false, 'We could not match that username and class code. Check them with your trainer or organisation.', null::text, null::text, 0; return;
  end if;
  if r.profile_id is not null then
    return query select false, 'This username is already activated. Please sign in with your password.', null::text, null::text, 0; return;
  end if;
  select count(*) into n from public.pack_request_items where request_id = cc.request_id and roster_id = r.id;
  return query select true, 'OK', r.full_name, (select o.name from public.organisations o where o.id = r.organisation_id), n;
end $$;

-- Sign-up trigger: class-code activation, invite-code sign-up (unchanged) or pending account
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_code text := nullif(trim(meta->>'invite_code'), '');
  v_user text := nullif(trim(meta->>'username'), '');
  v_cc   text := nullif(trim(meta->>'class_code'), '');
  i invites; r public.roster_learners; cc public.class_codes;
  v_pkg uuid; v_enr uuid; v_has_wb boolean;
begin
  -- A. Learner activating with username + class code
  if v_cc is not null and v_user is not null then
    select * into r from public.roster_learners where lower(username) = lower(v_user) and is_active for update;
    select * into cc from public.class_codes where upper(code) = upper(v_cc) and is_active and expires_at > now();
    if r.id is null or r.profile_id is not null or cc.id is null or cc.organisation_id <> r.organisation_id
       or not exists (select 1 from public.pack_request_items it join public.pack_requests pr on pr.id = it.request_id
                      where it.request_id = cc.request_id and it.roster_id = r.id and pr.status = 'approved') then
      raise exception 'Invalid username or class code';
    end if;
    insert into profiles(id, role, full_name, organisation_id, username)
    values (new.id, 'learner', r.full_name, r.organisation_id, r.username);
    update public.roster_learners set profile_id = new.id where id = r.id;
    perform public.materialise_roster(r.id);
    return new;
  end if;

  -- B. No codes: pending account (organisation contacts request access this way; the admin links them)
  if v_code is null then
    insert into profiles(id, email, full_name, phone, requested_org, role)
    values (new.id, new.email, meta->>'full_name', nullif(meta->>'phone', ''), nullif(meta->>'org_name', ''), 'pending')
    on conflict (id) do nothing;
    return new;
  end if;

  -- C. Invite-code sign-up (original flow, unchanged)
  select * into i from invites where upper(code) = upper(v_code) for update;
  if not found or not i.is_active
     or (i.expires_at is not null and i.expires_at < now())
     or (i.max_uses is not null and i.uses >= i.max_uses) then
    raise exception 'Invalid or expired invite code';
  end if;

  v_has_wb := exists (select 1 from invite_workbooks where invite_id = i.id);
  v_pkg := i.package_id;
  if v_pkg is null and not v_has_wb then
    select id into v_pkg from packages where upper(code) = upper(trim(meta->>'package_code')) and is_active;
    if v_pkg is null then raise exception 'Unknown package plan number'; end if;
  end if;

  insert into profiles(id, role, full_name, dob, email, phone, organisation_id)
  values (new.id, 'learner', meta->>'full_name', nullif(meta->>'dob','')::date, new.email,
          meta->>'phone', i.organisation_id);
  update invites set uses = uses + 1 where id = i.id;

  if v_pkg is not null then
    v_enr := public.enroll_learner(new.id, v_pkg, i.organisation_id);
    if i.title is not null then update enrollments set title = i.title where id = v_enr; end if;
  else
    insert into enrollments(learner_id, package_id, organisation_id, title)
    values (new.id, null, i.organisation_id, coalesce(i.title, 'Training'))
    returning id into v_enr;
  end if;

  insert into assignments(enrollment_id, learner_id, workbook_id)
  select v_enr, new.id, iw.workbook_id
  from invite_workbooks iw join workbooks w on w.id = iw.workbook_id
  where iw.invite_id = i.id and w.is_active
  on conflict (enrollment_id, workbook_id) do nothing;
  return new;
end $$;

-- 11. Row-level security ------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['roster_learners','pack_requests','pack_request_items','class_codes']
  loop
    execute format('create policy admin_all on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;

-- Organisation: own roster (read only; people are added through org_add_learner)
create policy org_roster_read on public.roster_learners for select to authenticated
  using (organisation_id = public.my_org());

-- Organisation: own requests, editable only while a draft (submitting goes through submit_pack_request)
create policy org_req_read on public.pack_requests for select to authenticated
  using (organisation_id = public.my_org());
create policy org_req_insert on public.pack_requests for insert to authenticated
  with check (organisation_id = public.my_org() and status = 'draft');
create policy org_req_update on public.pack_requests for update to authenticated
  using (organisation_id = public.my_org() and status = 'draft')
  with check (organisation_id = public.my_org() and status = 'draft');
create policy org_req_delete on public.pack_requests for delete to authenticated
  using (organisation_id = public.my_org() and status = 'draft');

create policy org_items_read on public.pack_request_items for select to authenticated
  using (exists (select 1 from public.pack_requests pr where pr.id = request_id and pr.organisation_id = public.my_org()));
create policy org_items_insert on public.pack_request_items for insert to authenticated
  with check (
    exists (select 1 from public.pack_requests pr where pr.id = request_id and pr.organisation_id = public.my_org() and pr.status = 'draft')
    and exists (select 1 from public.roster_learners r where r.id = roster_id and r.organisation_id = public.my_org() and r.is_active)
    and public.workbook_offered(workbook_id, public.my_org()));
create policy org_items_delete on public.pack_request_items for delete to authenticated
  using (exists (select 1 from public.pack_requests pr where pr.id = request_id and pr.organisation_id = public.my_org() and pr.status = 'draft'));

-- Organisation sees the class code once its request is approved
create policy org_codes_read on public.class_codes for select to authenticated
  using (organisation_id = public.my_org());

-- 12. Grants ------------------------------------------------------------
grant select, insert, update, delete on public.roster_learners, public.pack_requests, public.pack_request_items, public.class_codes to authenticated;
revoke all on public.roster_learners, public.pack_requests, public.pack_request_items, public.class_codes from anon;

-- Internal helpers: not callable from the browser
revoke execute on function public.materialise_roster(uuid), public.make_username(text), public.gen_class_code(),
  public.trg_assignment_no_dup() from public, anon, authenticated;
-- Signed-in actions: not callable anonymously
revoke execute on function public.org_catalogue(), public.org_add_learner(text, uuid), public.submit_pack_request(uuid),
  public.org_learner_status(), public.admin_review_request(uuid, text, text), public.set_class_code(uuid, timestamptz, boolean),
  public.approve_pack_request(uuid, timestamptz, text), public.reset_learner_password(uuid, text),
  public.my_org(), public.workbook_offered(uuid, uuid) from public, anon;
grant execute on function public.org_catalogue(), public.org_add_learner(text, uuid), public.submit_pack_request(uuid),
  public.org_learner_status(), public.admin_review_request(uuid, text, text), public.set_class_code(uuid, timestamptz, boolean),
  public.approve_pack_request(uuid, timestamptz, text), public.reset_learner_password(uuid, text),
  public.my_org(), public.workbook_offered(uuid, uuid) to authenticated;
-- Pre-sign-in check
grant execute on function public.check_activation(text, text) to anon, authenticated;
-- 005: price list, quotes and organisation acceptance before a class code is issued.
-- Flow: submitted -> under_review -> quoted -> accepted -> approved (class code). Payment is recorded, never taken.

-- 1. Price list (admin only). One price per workbook, ex GST, in cents.
create table if not exists public.workbook_prices (
  workbook_id uuid primary key references public.workbooks(id) on delete cascade,
  price_cents int not null check (price_cents >= 0),
  updated_at  timestamptz not null default now()
);

-- 2. Request statuses
alter table public.pack_requests drop constraint if exists pack_requests_status_check;
alter table public.pack_requests add constraint pack_requests_status_check
  check (status in ('draft','submitted','under_review','quoted','accepted','approved'));
alter table public.pack_requests add column if not exists quote_waived boolean not null default false;

-- 3. Quotes. Lines are a snapshot: [{description, qty, unit_cents}], so later price changes never alter a sent quote.
create table if not exists public.quotes (
  id               uuid primary key default gen_random_uuid(),
  request_id       uuid not null references public.pack_requests(id) on delete cascade,
  version          int not null default 1,
  status           text not null default 'draft' check (status in ('draft','sent','accepted','declined','superseded')),
  lines            jsonb not null default '[]'::jsonb,
  gst_percent      numeric not null default 10 check (gst_percent >= 0),
  subtotal_cents   int not null default 0,
  gst_cents        int not null default 0,
  total_cents      int not null default 0,
  payment_terms    text,
  terms            text,
  valid_days       int not null default 14 check (valid_days between 1 and 90),
  sent_at          timestamptz,
  valid_until      timestamptz,
  accepted_at      timestamptz,
  accepted_by      uuid,
  accepted_name    text,
  decline_note     text,
  invoice_number   text,
  invoice_date     date,
  paid_at          date,
  created_at       timestamptz not null default now()
);
create index if not exists quotes_request_idx on public.quotes (request_id);

alter table public.workbook_prices enable row level security;
alter table public.quotes          enable row level security;
create policy admin_all on public.workbook_prices for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all on public.quotes          for all to authenticated using (public.is_admin()) with check (public.is_admin());
-- Organisations read their own quotes once sent (never drafts). All changes go through the functions below.
create policy org_quotes_read on public.quotes for select to authenticated
  using (status <> 'draft' and exists (select 1 from public.pack_requests pr where pr.id = request_id and pr.organisation_id = public.my_org()));
grant select, insert, update, delete on public.workbook_prices, public.quotes to authenticated;
revoke all on public.workbook_prices, public.quotes from anon;

-- 4. Admin: save a draft quote, or save and send it
create or replace function public.admin_save_quote(
  p_request uuid, p_lines jsonb, p_gst numeric, p_payment_terms text, p_terms text, p_valid_days int, p_send boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare rq public.pack_requests; q public.quotes; v_sub bigint := 0; v_gst int; l jsonb; v_id uuid;
begin
  if not public.is_admin() then raise exception 'Not allowed'; end if;
  select * into rq from public.pack_requests where id = p_request;
  if not found then raise exception 'Request not found'; end if;
  if rq.status not in ('submitted','under_review','quoted') then raise exception 'This request can no longer be quoted'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'Add at least one line'; end if;
  for l in select * from jsonb_array_elements(p_lines) loop
    if coalesce(trim(l->>'description'),'') = '' then raise exception 'Every line needs a description'; end if;
    if (l->>'qty')::numeric <= 0 or (l->>'unit_cents')::int < 0 then raise exception 'Check quantities and prices'; end if;
    v_sub := v_sub + round((l->>'qty')::numeric * (l->>'unit_cents')::int);
  end loop;
  v_gst := round(v_sub * coalesce(p_gst,0) / 100.0);
  select * into q from public.quotes where request_id = p_request and status = 'draft' order by version desc limit 1;
  if found then
    update public.quotes set lines = p_lines, gst_percent = coalesce(p_gst,0), subtotal_cents = v_sub, gst_cents = v_gst,
      total_cents = v_sub + v_gst, payment_terms = p_payment_terms, terms = p_terms, valid_days = coalesce(p_valid_days,14) where id = q.id;
    v_id := q.id;
  else
    insert into public.quotes(request_id, version, lines, gst_percent, subtotal_cents, gst_cents, total_cents, payment_terms, terms, valid_days)
    values (p_request, coalesce((select max(version) from public.quotes where request_id = p_request),0) + 1, p_lines, coalesce(p_gst,0),
            v_sub, v_gst, v_sub + v_gst, p_payment_terms, p_terms, coalesce(p_valid_days,14)) returning id into v_id;
  end if;
  if p_send then
    update public.quotes set status = 'superseded' where request_id = p_request and status = 'sent' and id <> v_id;
    update public.quotes set status = 'sent', sent_at = now(), valid_until = now() + make_interval(days => valid_days) where id = v_id;
    update public.pack_requests set status = 'quoted' where id = p_request;
  elsif rq.status = 'submitted' then
    update public.pack_requests set status = 'under_review' where id = p_request;
  end if;
  return v_id;
end $$;

-- 5. Organisation: accept or decline a sent quote
create or replace function public.org_accept_quote(p_quote uuid, p_name text) returns void
language plpgsql security definer set search_path = public as $$
declare q public.quotes; rq public.pack_requests;
begin
  select * into q from public.quotes where id = p_quote;
  if not found then raise exception 'Quote not found'; end if;
  select * into rq from public.pack_requests where id = q.request_id;
  if rq.organisation_id is distinct from public.my_org() then raise exception 'Not allowed'; end if;
  if q.status <> 'sent' then raise exception 'This quote is not open for acceptance'; end if;
  if q.valid_until < now() then raise exception 'This quote has expired. Please ask the trainer to re-send it.'; end if;
  if coalesce(trim(p_name),'') = '' then raise exception 'Enter your name to accept'; end if;
  update public.quotes set status = 'accepted', accepted_at = now(), accepted_by = auth.uid(), accepted_name = trim(p_name) where id = p_quote;
  update public.pack_requests set status = 'accepted' where id = q.request_id;
end $$;

create or replace function public.org_decline_quote(p_quote uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare q public.quotes; rq public.pack_requests;
begin
  select * into q from public.quotes where id = p_quote;
  if not found then raise exception 'Quote not found'; end if;
  select * into rq from public.pack_requests where id = q.request_id;
  if rq.organisation_id is distinct from public.my_org() then raise exception 'Not allowed'; end if;
  if q.status <> 'sent' then raise exception 'This quote is not open'; end if;
  update public.quotes set status = 'declined', decline_note = p_note where id = p_quote;
  update public.pack_requests set status = 'under_review' where id = q.request_id;
end $$;

-- 6. Admin: record the invoice and payment against the accepted quote
create or replace function public.admin_record_payment(p_quote uuid, p_invoice text, p_invoice_date date, p_paid date) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not allowed'; end if;
  update public.quotes set invoice_number = nullif(trim(p_invoice),''), invoice_date = p_invoice_date, paid_at = p_paid
  where id = p_quote and status = 'accepted';
end $$;

-- 7. Approval now needs an accepted quote, or an explicit waiver (e.g. demo or no-charge training)
drop function if exists public.approve_pack_request(uuid, timestamptz, text);
create or replace function public.approve_pack_request(p_request uuid, p_expires timestamptz default (now() + interval '3 days'), p_note text default null, p_waive boolean default false)
returns text language plpgsql security definer set search_path = public as $$
declare rq public.pack_requests; v_code text; v_r uuid;
begin
  if not public.is_admin() then raise exception 'Not allowed'; end if;
  select * into rq from public.pack_requests where id = p_request;
  if not found then raise exception 'Request not found'; end if;
  if rq.status = 'draft' then raise exception 'This request has not been submitted yet'; end if;
  if rq.status <> 'approved' then
    if rq.status <> 'accepted' and not p_waive then raise exception 'The organisation must accept a quote first, or waive the quote'; end if;
  end if;
  update public.pack_requests set status = 'approved', approved_at = coalesce(approved_at, now()),
    quote_waived = (quote_waived or (p_waive and rq.status <> 'accepted' and rq.status <> 'approved')),
    admin_note = coalesce(p_note, admin_note) where id = p_request;
  v_code := public.set_class_code(p_request, p_expires, false);
  for v_r in select distinct roster_id from public.pack_request_items where request_id = p_request loop
    perform public.materialise_roster(v_r);
  end loop;
  return v_code;
end $$;

-- admin_review_request must not wipe a quoted/accepted request back by accident
create or replace function public.admin_review_request(p_request uuid, p_status text, p_note text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not allowed'; end if;
  if p_status not in ('draft','submitted','under_review') then raise exception 'Use approve to approve a request'; end if;
  update public.pack_requests set status = p_status, admin_note = p_note
  where id = p_request and status not in ('approved','accepted');
end $$;

revoke execute on function public.admin_save_quote(uuid,jsonb,numeric,text,text,int,boolean), public.admin_record_payment(uuid,text,date,date),
  public.approve_pack_request(uuid,timestamptz,text,boolean) from public, anon;
revoke execute on function public.org_accept_quote(uuid,text), public.org_decline_quote(uuid,text) from public, anon;
grant execute on function public.admin_save_quote(uuid,jsonb,numeric,text,text,int,boolean), public.admin_record_payment(uuid,text,date,date),
  public.approve_pack_request(uuid,timestamptz,text,boolean), public.org_accept_quote(uuid,text), public.org_decline_quote(uuid,text) to authenticated;

-- ===== migration 006 =====
-- 006: support Mark's workbook template (v1.1): multi-select questions, critical items, outcomes,
-- richer reading blocks, practical detail and per-workbook settings. Enforces pass mark and
-- critical questions when a workbook is marked competent.

-- ---------- workbook details and settings ----------
alter table public.workbooks
  add column if not exists code text,
  add column if not exists author text,
  add column if not exists audience text,
  add column if not exists prerequisites text,
  add column if not exists source_documents text,
  add column if not exists est_duration_mins int,
  add column if not exists review_date date,
  add column if not exists max_attempts int,
  add column if not exists randomise boolean not null default false,
  add column if not exists practical_required boolean not null default true,
  add column if not exists practical_setting text,
  add column if not exists practical_pass_rule text not null default 'All items competent',
  add column if not exists practical_pass_percent int,
  add column if not exists practical_max_attempts int,
  add column if not exists assessor_requirements text,
  add column if not exists reasonable_adjustments text,
  add column if not exists certificate_title text,
  add column if not exists certificate_expiry_months int;

-- ---------- outcomes ----------
create table if not exists public.outcomes (
  id          uuid primary key default gen_random_uuid(),
  workbook_id uuid not null references public.workbooks(id) on delete cascade,
  position    int not null default 0,
  code        text not null,
  description text not null,
  assessed_by text not null default 'Both' check (assessed_by in ('Knowledge','Practical','Both'))
);
create index if not exists outcomes_wb on public.outcomes(workbook_id, position);
alter table public.outcomes enable row level security;
drop policy if exists admin_all on public.outcomes;
create policy admin_all on public.outcomes for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.outcomes to authenticated;
revoke all on public.outcomes from anon;

-- ---------- reading blocks and practice questions ----------
alter table public.learning_items
  add column if not exists block_type text,
  add column if not exists section_title text,
  add column if not exists section_code text,
  add column if not exists outcome_code text,
  add column if not exists image_url text,
  add column if not exists alt_text text,
  add column if not exists reference_source text,
  add column if not exists hint text,
  add column if not exists explanation_incorrect text;
alter table public.learning_items drop constraint if exists learning_items_qtype_check;
alter table public.learning_items add constraint learning_items_qtype_check
  check (qtype in ('multiple_choice','true_false','multi_select'));

-- ---------- knowledge questions ----------
alter table public.questions
  add column if not exists critical boolean not null default false,
  add column if not exists outcome_code text,
  add column if not exists source_section text;
alter table public.questions drop constraint if exists questions_qtype_check;
alter table public.questions add constraint questions_qtype_check
  check (qtype in ('short','long','multiple_choice','true_false','multi_select'));
-- feedback is admin-only (it can give the answer away), so it sits with the key
alter table public.question_keys add column if not exists feedback text;

-- ---------- practical skills ----------
alter table public.competencies
  add column if not exists critical boolean not null default false,
  add column if not exists task_group text,
  add column if not exists criteria text,
  add column if not exists method text,
  add column if not exists conditions text,
  add column if not exists resources text,
  add column if not exists evidence text,
  add column if not exists min_observations int,
  add column if not exists assessor_prompt text,
  add column if not exists outcome_code text;

-- ---------- helpers ----------
-- multi-select answers and keys are JSON arrays of the option texts; equal means same set
create or replace function public.multi_equal(a text, b text) returns boolean
language plpgsql immutable as $$
begin
  return (select coalesce(array_agg(x order by x), '{}') from jsonb_array_elements_text(a::jsonb) x)
       = (select coalesce(array_agg(x order by x), '{}') from jsonb_array_elements_text(b::jsonb) x);
exception when others then
  return false;
end $$;

-- ---------- learner submit: auto-mark multi-select too ----------
create or replace function public.submit_assignment(p_assignment uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a assignments; v_missing int;
begin
  select * into a from assignments where id = p_assignment;
  if a.id is null or a.learner_id <> auth.uid() then raise exception 'Not your workbook'; end if;
  if a.status not in ('in_progress','resubmit','not_started') then raise exception 'Already submitted'; end if;

  select count(*) into v_missing from questions q
  left join answers an on an.question_id = q.id and an.assignment_id = p_assignment
  where q.workbook_id = a.workbook_id
    and (coalesce(trim(an.response),'') = '' or (q.qtype = 'multi_select' and trim(an.response) = '[]'));
  if v_missing > 0 then raise exception 'Please answer all questions (% left)', v_missing; end if;

  update answers an set is_correct = (lower(trim(an.response)) = lower(trim(k.correct_answer)))
  from questions q join question_keys k on k.question_id = q.id
  where an.assignment_id = p_assignment and an.question_id = q.id
    and q.qtype in ('multiple_choice','true_false') and k.correct_answer is not null;

  update answers an set is_correct = public.multi_equal(an.response, k.correct_answer)
  from questions q join question_keys k on k.question_id = q.id
  where an.assignment_id = p_assignment and an.question_id = q.id
    and q.qtype = 'multi_select' and k.correct_answer is not null;

  update answers an set is_correct = null
  from questions q
  where an.assignment_id = p_assignment and an.question_id = q.id and q.qtype in ('short','long');

  update assignments set status = 'submitted', submitted_at = now() where id = p_assignment;
end $$;

-- ---------- admin marking: enforce pass mark and critical questions ----------
create or replace function public.finalise_review(p_assignment uuid, p_outcome text, p_notes text) returns void
language plpgsql security definer set search_path = public as $$
declare v_score numeric; v_pass int; v_crit int; v_wb uuid;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if p_outcome not in ('competent','resubmit') then raise exception 'Bad outcome'; end if;
  select workbook_id into v_wb from assignments where id = p_assignment;
  select round(100.0 * coalesce(sum(q.marks) filter (where an.is_correct), 0) / nullif(sum(q.marks),0), 1)
    into v_score
  from questions q join assignments a on a.workbook_id = q.workbook_id
  left join answers an on an.question_id = q.id and an.assignment_id = a.id
  where a.id = p_assignment;
  if p_outcome = 'competent' then
    select pass_percent into v_pass from workbooks where id = v_wb;
    if coalesce(v_score, 100) < coalesce(v_pass, 0) then
      raise exception 'Score % %% is below the pass mark of % %%. Mark more answers correct, or choose Resubmit.', v_score, v_pass;
    end if;
    select count(*) into v_crit from questions q
    left join answers an on an.question_id = q.id and an.assignment_id = p_assignment
    where q.workbook_id = v_wb and q.critical and coalesce(an.is_correct, false) = false;
    if v_crit > 0 then
      raise exception '% critical question(s) are not marked correct. A learner must answer every critical question correctly, so choose Resubmit.', v_crit;
    end if;
  end if;
  update assignments
     set status = p_outcome, score = v_score, reviewed_at = now(), reviewer_notes = p_notes,
         attempt = case when p_outcome = 'resubmit' then attempt + 1 else attempt end
   where id = p_assignment;
end $$;

-- ---------- checklist now carries the practical detail ----------
drop function if exists public.enrollment_competencies(uuid);
create function public.enrollment_competencies(p_enr uuid)
returns table(id uuid, description text, workbook_id uuid, group_title text, group_order int, item_order int,
              critical boolean, task_group text, criteria text, method text, conditions text, resources text,
              evidence text, min_observations int, assessor_prompt text,
              pass_rule text, pass_percent int)
language sql stable security definer set search_path = public as $$
  select c.id, c.description, c.workbook_id,
         coalesce(w.title, 'Whole package') as group_title,
         case when c.workbook_id is null then 9999 else coalesce(pw.position, 500) end as group_order,
         c.position as item_order,
         c.critical, c.task_group, c.criteria, c.method, c.conditions, c.resources,
         c.evidence, c.min_observations, c.assessor_prompt,
         coalesce(w.practical_pass_rule, 'All items competent'), w.practical_pass_percent
  from enrollments e
  join competencies c
    on (c.workbook_id in (select a.workbook_id from assignments a where a.enrollment_id = e.id))
    or (c.package_id is not null and c.package_id = e.package_id)
  left join workbooks w on w.id = c.workbook_id
  left join package_workbooks pw on pw.package_id = e.package_id and pw.workbook_id = c.workbook_id
  where e.id = p_enr and (public.is_admin() or e.learner_id = auth.uid())
  order by group_order, group_title, item_order;
$$;
revoke execute on function public.enrollment_competencies(uuid) from public, anon;
grant execute on function public.enrollment_competencies(uuid) to authenticated;

-- ===== migration 007 =====
-- 007: replace a workbook's content in place from an updated template, in one transaction.
-- The workbook keeps its id, so packages, prices, organisations and assignments stay linked.

-- no two workbooks may share a Workbook_ID
create unique index if not exists workbooks_code_uq on public.workbooks (lower(code)) where code is not null;

create or replace function public.admin_replace_workbook(p_workbook uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public as $f$
declare
  w workbooks; v jsonb := p_payload->'wb'; newcode text; newtitle text; locked int; started int;
  e jsonb; qid uuid; kept uuid[] := '{}'; sid uuid; n_items int := 0; n_q int := 0; n_sk int := 0; n_out int := 0; n_removed int;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  select * into w from workbooks where id = p_workbook for update;
  if w.id is null then raise exception 'Workbook not found'; end if;

  newcode := nullif(trim(v->>'code'), '');
  newtitle := nullif(trim(v->>'title'), '');
  if newtitle is null then raise exception 'The file has no Title'; end if;
  if newcode is null then raise exception 'The file has no Workbook_ID on the Cover tab'; end if;
  if w.code is not null and lower(w.code) <> lower(newcode) then
    raise exception 'The file is Workbook_ID %, but this workbook is %. Open the right workbook, or fix the Cover tab.', newcode, w.code;
  end if;
  if exists (select 1 from workbooks where id <> p_workbook and (lower(code) = lower(newcode) or lower(title) = lower(newtitle))) then
    raise exception 'Another workbook already uses that title or Workbook_ID';
  end if;

  select count(*) into locked from assignments where workbook_id = p_workbook and status in ('submitted','resubmit','competent');
  if locked > 0 then
    raise exception '% learner(s) have submitted, been returned or completed this workbook. Replacing would delete their answers. Use Save as new version instead.', locked;
  end if;
  select count(*) into started from assignments where workbook_id = p_workbook and status = 'in_progress';

  update workbooks set
    title = newtitle, code = newcode, version = coalesce(nullif(v->>'version',''), version), description = v->>'description',
    author = v->>'author', audience = v->>'audience', prerequisites = v->>'prerequisites', source_documents = v->>'source_documents',
    est_duration_mins = (v->>'est_duration_mins')::int, review_date = (v->>'review_date')::date,
    pass_percent = coalesce((v->>'pass_percent')::int, pass_percent), max_attempts = (v->>'max_attempts')::int,
    randomise = coalesce((v->>'randomise')::boolean, false), practical_required = coalesce((v->>'practical_required')::boolean, true),
    practical_setting = v->>'practical_setting', practical_pass_rule = coalesce(nullif(v->>'practical_pass_rule',''), 'All items competent'),
    practical_pass_percent = (v->>'practical_pass_percent')::int, practical_max_attempts = (v->>'practical_max_attempts')::int,
    assessor_requirements = v->>'assessor_requirements', reasonable_adjustments = v->>'reasonable_adjustments',
    certificate_title = v->>'certificate_title', certificate_expiry_months = (v->>'certificate_expiry_months')::int
  where id = p_workbook;

  -- content that nobody has recorded anything against: swap wholesale
  delete from outcomes where workbook_id = p_workbook;
  delete from learning_items where workbook_id = p_workbook;
  delete from questions where workbook_id = p_workbook;   -- keys and any in-progress answers cascade

  for e in select value from jsonb_array_elements(coalesce(p_payload->'outcomes','[]')) loop
    n_out := n_out + 1;
    insert into outcomes(workbook_id, position, code, description, assessed_by)
    values (p_workbook, n_out, e->>'code', e->>'description', coalesce(e->>'assessed_by','Both'));
  end loop;

  for e in select value from jsonb_array_elements(coalesce(p_payload->'items','[]')) loop
    n_items := n_items + 1;
    insert into learning_items(workbook_id, position, kind, block_type, section_code, section_title, outcome_code, title, body, image_url, alt_text,
                               reference_source, qtype, options, answer, hint, explanation, explanation_incorrect)
    values (p_workbook, n_items, e->>'kind', e->>'block_type', e->>'section_code', e->>'section_title', e->>'outcome_code', e->>'title',
            coalesce(e->>'body',''), e->>'image_url', e->>'alt_text', e->>'reference_source', e->>'qtype', coalesce(e->'options','[]'::jsonb),
            e->>'answer', e->>'hint', e->>'explanation', e->>'explanation_incorrect');
  end loop;

  for e in select value from jsonb_array_elements(coalesce(p_payload->'questions','[]')) loop
    n_q := n_q + 1;
    insert into questions(workbook_id, position, prompt, qtype, options, marks, critical, outcome_code, source_section)
    values (p_workbook, n_q, e->>'prompt', e->>'qtype', coalesce(e->'options','[]'::jsonb), coalesce((e->>'marks')::int, 1),
            coalesce((e->>'critical')::boolean, false), e->>'outcome_code', e->>'source_section')
    returning id into qid;
    insert into question_keys(question_id, correct_answer, marking_guide, feedback)
    values (qid, e->'key'->>'correct_answer', e->'key'->>'marking_guide', e->'key'->>'feedback');
  end loop;

  -- practical skills: keep an existing skill (and any recorded results) when the wording matches
  for e in select value from jsonb_array_elements(coalesce(p_payload->'skills','[]')) loop
    n_sk := n_sk + 1;
    select id into sid from competencies
     where workbook_id = p_workbook and description = (e->>'description') and id <> all(kept) order by position limit 1;
    if sid is null then
      insert into competencies(workbook_id, package_id, position, description) values (p_workbook, null, n_sk, e->>'description') returning id into sid;
    end if;
    kept := kept || sid;
    update competencies set position = n_sk, task_group = e->>'task_group', outcome_code = e->>'outcome_code', criteria = e->>'criteria',
      method = e->>'method', conditions = e->>'conditions', resources = e->>'resources', evidence = e->>'evidence',
      min_observations = coalesce((e->>'min_observations')::int, 1), critical = coalesce((e->>'critical')::boolean, false),
      assessor_prompt = e->>'assessor_prompt'
    where id = sid;
  end loop;
  delete from competencies where workbook_id = p_workbook and id <> all(kept);
  get diagnostics n_removed = row_count;

  return jsonb_build_object('outcomes', n_out, 'items', n_items, 'questions', n_q, 'skills', n_sk, 'skills_removed', n_removed, 'in_progress_reset', started);
end $f$;

revoke execute on function public.admin_replace_workbook(uuid, jsonb) from public, anon;
grant execute on function public.admin_replace_workbook(uuid, jsonb) to authenticated;
