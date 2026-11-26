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
