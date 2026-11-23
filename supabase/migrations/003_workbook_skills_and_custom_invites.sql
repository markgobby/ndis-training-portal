-- Practical skills can belong to a workbook (so a package's checklist is built from its workbooks),
-- and invite codes can carry any selection of workbooks, with or without a package.

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
