import { sb, state, BRAND, $, $$, esc, fmtDate, view, go, toast, must, formData, badge } from './app.js';

const reqBadge = (s) => badge(s === 'submitted' ? 'submitted_req' : s);
const MOD_LABEL = { skipped: 'Skipped', awaiting_activation: 'Awaiting first login', draft: 'Draft', submitted: 'Submitted', under_review: 'Under review' };
const modBadge = (s) => (MOD_LABEL[s] && !['skipped', 'awaiting_activation'].includes(s) ? reqBadge(s) : badge(s));

export async function route(h) {
  let m;
  if (h === '#/' || h === '') return dashboard();
  if (h === '#/o/learners') return learners();
  if (h === '#/o/requests') return requests();
  if ((m = h.match(/^#\/o\/request\/([\w-]+)$/))) return requestEditor(m[1]);
  view('<div class="card">Page not found. <a href="#/">Go to dashboard</a></div>');
}

const orgNameOf = async () => must(await sb.from('organisations').select('name').eq('id', state.profile.organisation_id).single()).name;

// ---------------- dashboard ----------------
async function dashboard() {
  const [rows, reqs] = await Promise.all([sb.rpc('org_learner_status'), sb.from('pack_requests').select('id,title,status,created_at,class_codes(code,expires_at)').order('created_at', { ascending: false })])
    .then((r) => r.map((x) => must(x)));
  const people = new Map();
  rows.forEach((r) => people.set(r.roster_id, r));
  const mods = rows.filter((r) => r.workbook_title);
  const done = mods.filter((r) => r.module_status === 'competent').length;
  const open = mods.filter((r) => ['in_progress', 'not_started', 'submitted', 'resubmit', 'awaiting_activation'].includes(r.module_status)).length;
  const approved = reqs.filter((r) => r.status === 'approved' && r.class_codes?.length);
  view(`<h1>Dashboard <span class="muted small">· ${esc(await orgNameOf())}</span></h1>
    <div class="grid">
      <div class="card"><div class="stat">${people.size}</div>Learners</div>
      <div class="card"><div class="stat">${[...people.values()].filter((p) => p.activated).length}</div>Activated</div>
      <div class="card"><div class="stat">${open}</div>Modules in progress</div>
      <div class="card"><div class="stat">${done}</div>Modules completed</div>
    </div>
    <section class="card"><div class="row between"><h2 style="margin:0">Pack requests</h2><a class="btn small" href="#/o/request/new">New request</a></div>
      ${reqs.length ? `<ul>${reqs.map((r) => `<li><a href="#/o/request/${r.id}">${esc(r.title)}</a> ${reqBadge(r.status)} <span class="small muted">${fmtDate(r.created_at)}</span></li>`).join('')}</ul>` : '<p class="muted">No requests yet. Start one to book training for your people.</p>'}
    </section>
    ${approved.length ? `<section class="card"><h2 style="margin-top:0">Class codes</h2>
      <p class="muted small">Give the code to learners on the training day, together with their username. It stops working after the date shown.</p>
      <ul>${approved.map((r) => `<li>${esc(r.title)}: <b style="letter-spacing:.1em">${esc(r.class_codes[0].code)}</b> <span class="small muted">valid until ${fmtDate(r.class_codes[0].expires_at)}</span></li>`).join('')}</ul></section>` : ''}`);
}

// ---------------- learners ----------------
async function learners() {
  const rows = must(await sb.rpc('org_learner_status'));
  const by = new Map();
  rows.forEach((r) => { if (!by.has(r.roster_id)) by.set(r.roster_id, { ...r, mods: [] }); if (r.workbook_title) by.get(r.roster_id).mods.push(r); });
  view(`<h1>Learners</h1>
    <section class="card"><h2 style="margin-top:0">Add a learner</h2>
      <form id="add" class="row"><input name="full_name" placeholder="Full name, as on the certificate" required style="flex:1;min-width:14rem"><button class="btn small">Add</button></form>
      <p class="small muted">A username is created for them, such as JohnSmith1. Choose their modules in a <a href="#/o/requests">pack request</a>.</p></section>
    ${by.size ? [...by.values()].map((p) => `<section class="card"><div class="row between"><div><b>${esc(p.full_name)}</b> <span class="small muted">username <code>${esc(p.username)}</code></span></div>
        <div class="row">${p.activated ? badge('competent').replace('Competent', 'Activated') : '<span class="badge warn">Not activated</span>'}
        ${p.activated ? `<button class="btn small secondary" data-reset="${p.roster_id}" data-name="${esc(p.full_name)}">Reset password</button>` : ''}</div></div>
      ${p.mods.length ? `<div class="table-wrap"><table><thead><tr><th>Module</th><th>Request</th><th>Status</th></tr></thead><tbody>${p.mods.map((m) => `<tr><td>${esc(m.workbook_title)}</td><td class="small">${esc(m.request_title)}</td>
        <td>${modBadge(m.module_status)} ${m.note ? `<span class="small muted">${esc(m.note)}</span>` : m.done_on ? `<span class="small muted">${fmtDate(m.done_on)}</span>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted small" style="margin-bottom:0">No modules yet.</p>'}
      </section>`).join('') : '<div class="card muted">No learners yet.</div>'}`);
  $('#add').onsubmit = async (e) => {
    e.preventDefault(); const d = formData(e.target);
    const r = must(await sb.rpc('org_add_learner', { p_name: d.full_name }), 'Could not add learner');
    toast(`Added. Username: ${r.username}`); learners();
  };
  $$('[data-reset]').forEach((b) => (b.onclick = async () => {
    const pw = prompt(`New password for ${b.dataset.name} (at least 8 characters). Tell them privately.`);
    if (!pw) return;
    must(await sb.rpc('reset_learner_password', { p_roster: b.dataset.reset, p_password: pw }), 'Could not reset');
    toast('Password reset');
  }));
}

// ---------------- pack requests ----------------
async function requests() {
  const rows = must(await sb.from('pack_requests').select('id,title,status,created_at,submitted_at,pack_request_items(count)').order('created_at', { ascending: false }));
  view(`<div class="row between"><h1>Pack requests</h1><a class="btn" href="#/o/request/new">New request</a></div>
    ${rows.length ? `<div class="card table-wrap"><table><thead><tr><th>Request</th><th>Status</th><th>Items</th><th>Created</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td><a href="#/o/request/${r.id}">${esc(r.title)}</a></td><td>${reqBadge(r.status)}</td><td>${r.pack_request_items[0]?.count ?? 0}</td><td>${fmtDate(r.created_at)}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="card muted">No requests yet.</div>'}`);
}

async function requestEditor(id) {
  const isNew = id === 'new';
  const [roster, cat, req, items, code] = await Promise.all([
    sb.from('roster_learners').select('id,full_name,username').eq('is_active', true).order('full_name'),
    sb.rpc('org_catalogue'),
    isNew ? { data: null } : sb.from('pack_requests').select('*').eq('id', id).single(),
    isNew ? { data: [] } : sb.from('pack_request_items').select('id,roster_id,workbook_id,skipped_reason').eq('request_id', id),
    isNew ? { data: [] } : sb.from('class_codes').select('code,expires_at').eq('request_id', id),
  ]).then((r) => r.map((x) => must(x)));
  const req0 = req || { title: '', preferred_dates: '', notes: '', status: 'draft' };
  const editable = req0.status === 'draft';
  const picked = new Set(items.map((i) => `${i.roster_id}|${i.workbook_id}`));
  const skipped = Object.fromEntries(items.filter((i) => i.skipped_reason).map((i) => [`${i.roster_id}|${i.workbook_id}`, i.skipped_reason]));

  const grid = roster.length && cat.length ? `<div class="table-wrap"><table><thead><tr><th>Learner</th>${cat.map((w) => `<th class="small">${esc(w.title)}</th>`).join('')}</tr></thead><tbody>
    ${roster.map((r) => `<tr><td>${esc(r.full_name)}<div class="small muted">${esc(r.username)}</div></td>${cat.map((w) => {
      const k = `${r.id}|${w.id}`;
      return `<td class="center"><input type="checkbox" data-k="${k}" aria-label="${esc(r.full_name)}: ${esc(w.title)}" ${picked.has(k) ? 'checked' : ''} ${editable ? '' : 'disabled'}>${skipped[k] ? `<div class="small muted">${esc(skipped[k])}</div>` : ''}</td>`;
    }).join('')}</tr>`).join('')}</tbody></table></div>`
    : `<p class="muted">${cat.length ? 'Add learners first, then pick their modules here.' : 'No modules are available to your organisation yet. Please contact the trainer.'}</p>`;

  view(`<p><a href="#/o/requests">← Pack requests</a></p>
    <div class="row between"><h1>${isNew ? 'New pack request' : esc(req0.title)}</h1>${isNew ? '' : reqBadge(req0.status)}</div>
    ${req0.admin_note ? `<div class="notice info"><b>Note from the trainer:</b> ${esc(req0.admin_note)}</div>` : ''}
    ${code[0] ? `<div class="notice info">Class code: <b style="letter-spacing:.1em">${esc(code[0].code)}</b> · valid until ${fmtDate(code[0].expires_at)}. Give it to learners on the training day with their username.</div>` : ''}
    ${req0.status === 'approved' && !code[0] ? '<div class="notice">Approved. The class code will appear here shortly.</div>' : ''}
    <form id="f" class="card">
      <label>Title</label><input name="title" required value="${esc(req0.title)}" placeholder="e.g. High intensity supports, February intake" ${editable ? '' : 'disabled'}>
      <label>Preferred dates (optional)</label><input name="preferred_dates" value="${esc(req0.preferred_dates)}" ${editable ? '' : 'disabled'}>
      <label>Notes (optional, no participant health details)</label><textarea name="notes" rows="2" ${editable ? '' : 'disabled'}>${esc(req0.notes)}</textarea>
    </form>
    <section class="card"><h2 style="margin-top:0">Modules per person</h2>${grid}
      ${editable ? `<form id="add" class="row" style="margin-top:1rem"><input name="full_name" placeholder="Add a new learner: full name" style="flex:1;min-width:14rem"><button class="btn small secondary">Add learner</button></form>` : ''}
    </section>
    ${editable ? `<div class="row"><button class="btn" id="save">Save draft</button><button class="btn ok" id="submit">Submit for review</button>${isNew ? '' : '<button class="btn danger" id="del">Delete</button>'}</div>
      <p class="small muted">Once submitted the trainer reviews it, confirms the quote and dates, then approves it. Learners already finished with a module are skipped automatically.</p>` : ''}`);

  const saveDraft = async () => {
    const d = formData($('#f'));
    if (!d.title?.trim()) { toast('Add a title first', true); throw new Error('title'); }
    const fields = { title: d.title.trim(), preferred_dates: d.preferred_dates || null, notes: d.notes || null };
    let rid = id;
    if (isNew) rid = must(await sb.from('pack_requests').insert({ ...fields, organisation_id: state.profile.organisation_id }).select('id').single()).id;
    else must(await sb.from('pack_requests').update(fields).eq('id', rid));
    const want = new Set($$('[data-k]:checked').map((c) => c.dataset.k));
    const have = new Map(items.map((i) => [`${i.roster_id}|${i.workbook_id}`, i.id]));
    const drop = [...have].filter(([k]) => !want.has(k)).map(([, v]) => v);
    const add = [...want].filter((k) => !have.has(k)).map((k) => { const [roster_id, workbook_id] = k.split('|'); return { request_id: rid, roster_id, workbook_id }; });
    if (drop.length) must(await sb.from('pack_request_items').delete().in('id', drop));
    if (add.length) must(await sb.from('pack_request_items').insert(add));
    return rid;
  };
  if (!editable) return;
  $('#save').onclick = async () => { try { const rid = await saveDraft(); toast('Draft saved'); go(`#/o/request/${rid}`); } catch {} };
  $('#submit').onclick = async () => {
    try {
      const rid = await saveDraft();
      must(await sb.rpc('submit_pack_request', { p_request: rid }), 'Could not submit');
      toast('Submitted for review'); go('#/o/requests');
    } catch {}
  };
  if ($('#del')) $('#del').onclick = async () => {
    if (!confirm('Delete this draft request?')) return;
    must(await sb.from('pack_requests').delete().eq('id', id)); toast('Deleted'); go('#/o/requests');
  };
  $('#add').onsubmit = async (e) => {
    e.preventDefault(); const name = formData(e.target).full_name?.trim();
    if (!name) return;
    try { const rid = await saveDraft(); const r = must(await sb.rpc('org_add_learner', { p_name: name }), 'Could not add learner'); toast(`Added. Username: ${r.username}`); go(`#/o/request/${rid}`); } catch {}
  };
}
