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
