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
