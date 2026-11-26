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
