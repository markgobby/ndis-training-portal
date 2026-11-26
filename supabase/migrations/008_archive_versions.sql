-- 008: archived versions may share a Workbook_ID/title with the active one.
-- Only ACTIVE workbooks must be unique, so "Save as new version" can archive the old copy and keep the same ID.
drop index if exists public.workbooks_code_uq;
create unique index if not exists workbooks_code_uq on public.workbooks (lower(code)) where code is not null and is_active;

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
  if exists (select 1 from workbooks where id <> p_workbook and is_active and (lower(code) = lower(newcode) or lower(title) = lower(newtitle))) then
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
