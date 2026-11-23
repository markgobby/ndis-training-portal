-- Part 1 of each workbook: learning material (information sections + unrecorded practice questions)

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
