import { sb, state, BRAND, $, $$, esc, fmtDate, view, go, toast, must, formData, badge, stageSteps, formatText, money, blockHtml, parseMulti, ansText } from './app.js';
import { QUOTE_DEFAULTS } from './config.js';
import { importView, replaceView, TEMPLATE_URL } from './import.js';

const orgF = (q, col) => (state.org ? q.eq(col, state.org) : q);
const orgName = async () => state.org ? must(await sb.from('organisations').select('name').eq('id', state.org).single()).name : 'All organisations';
const opt = (rows, sel, label = (r) => r.name) => rows.map((r) => `<option value="${r.id}" ${r.id === sel ? 'selected' : ''}>${esc(label(r))}</option>`).join('');
const uuid = () => crypto.randomUUID();
export const tName = (e) => e?.title || e?.packages?.name || 'Training';

// ---- "Available to" organisation scoping for workbooks and packages (no rows = all organisations) ----
const availableTo = (links, org = state.org) => !org || !links?.length || links.some((l) => l.organisation_id === org);
const orgList = (links, orgsById) => links?.length ? links.map((l) => orgsById[l.organisation_id] || '?').join(', ') : 'All organisations';
const orgPicker = (orgsL, selected) => `<fieldset class="qedit" style="margin-top:1rem"><legend style="font-weight:700">Available to</legend>
  <label class="choice"><input type="radio" name="org_mode" value="all" ${selected.length ? '' : 'checked'}>All organisations</label>
  <label class="choice"><input type="radio" name="org_mode" value="some" ${selected.length ? 'checked' : ''}>Only these organisations</label>
  <div id="orgpick" style="padding-left:1.5rem" ${selected.length ? '' : 'hidden'}>${orgsL.map((o) =>
    `<label class="choice"><input type="checkbox" value="${o.id}" ${selected.includes(o.id) ? 'checked' : ''}>${esc(o.name)}</label>`).join('') || '<p class="muted small">No organisations yet.</p>'}</div>
  <div class="small muted">Used to filter lists and invite codes when you switch organisation at the top.</div></fieldset>`;
const wireOrgPicker = () => $$('[name="org_mode"]').forEach((r) => (r.onchange = () => ($('#orgpick').hidden = $('[name="org_mode"]:checked').value === 'all')));
const readOrgPicker = () => $('[name="org_mode"]:checked')?.value === 'some' ? $$('#orgpick input:checked').map((x) => x.value) : [];
async function saveOrgLinks(table, keyCol, id, orgIds) {
  must(await sb.from(table).delete().eq(keyCol, id));
  if (orgIds.length) must(await sb.from(table).insert(orgIds.map((o) => ({ [keyCol]: id, organisation_id: o }))));
}
const orgsMap = async () => Object.fromEntries(must(await sb.from('organisations').select('id,name')).map((o) => [o.id, o.name]));
// Keep ids for unchanged lines so past practical results stay linked
async function saveSkills(lines, existing, owner) {
  const keep = existing.filter((c) => lines.includes(c.description));
  const drop = existing.filter((c) => !lines.includes(c.description));
  if (drop.length) must(await sb.from('competencies').delete().in('id', drop.map((c) => c.id)));
  const rows = lines.map((l, i) => ({ id: keep.find((c) => c.description === l)?.id || uuid(), package_id: null, workbook_id: null, ...owner, position: i + 1, description: l }));
  if (rows.length) must(await sb.from('competencies').upsert(rows));
}

export async function route(h) {
  let m;
  if (h === '#/' || h === '') return dashboard();
  if (h === '#/a/learners') return learners();
  if ((m = h.match(/^#\/a\/learner\/([\w-]+)$/))) return learner(m[1]);
  if (h === '#/a/review') return reviewQueue();
  if ((m = h.match(/^#\/a\/review\/([\w-]+)$/))) return review(m[1]);
  if (h === '#/a/workbooks') return workbooks();
  if ((m = h.match(/^#\/a\/preview\/([\w-]+)$/))) return preview(m[1]);
  if ((m = h.match(/^#\/a\/workbook\/([\w-]+)$/))) return workbookEditor(m[1]);
  if (h === '#/a/packages') return packages();
  if ((m = h.match(/^#\/a\/package\/([\w-]+)$/))) return packageEditor(m[1]);
  if (h === '#/a/requests') return requestsList();
  if (h === '#/a/prices') return priceList();
  if (h === '#/a/import') return importView();
  if ((m = h.match(/^#\/a\/replace\/([\w-]+)$/))) return replaceView(m[1]);
  if ((m = h.match(/^#\/a\/request\/([\w-]+)$/))) return requestDetail(m[1]);
  if (h === '#/a/accounts') return accounts();
  if (h === '#/a/orgs') return orgs();
  if (h === '#/a/invites') return invites();
  if (h === '#/a/feedback') return feedback();
  if ((m = h.match(/^#\/a\/practical\/([\w-]+)\/([\w-]+)$/))) return practical(m[1], m[2]);
  view('<div class="card">Page not found. <a href="#/">Go to dashboard</a></div>');
}

// ---------------- dashboard ----------------
async function dashboard() {
  const [lc, queue, ready, cert, done] = await Promise.all([
    orgF(sb.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'learner'), 'organisation_id'),
    orgF(sb.from('assignments').select('id, submitted_at, workbooks(title), profiles(full_name), enrollments!inner(organisation_id)').eq('status', 'submitted').order('submitted_at'), 'enrollments.organisation_id'),
    orgF(sb.from('enrollments').select('id, learner_id, profiles(full_name), title, packages(name), organisations(name)').eq('status', 'ready_for_practical'), 'organisation_id'),
    orgF(sb.from('enrollments').select('id, learner_id, profiles(full_name), title, packages(name), organisations(name)').eq('status', 'practical_complete'), 'organisation_id'),
    orgF(sb.from('enrollments').select('id', { count: 'exact', head: true }).eq('status', 'completed'), 'organisation_id'),
  ]);
  [lc, queue, ready, cert, done].forEach((r) => must(r));
  const list = (rows, empty, fn) => rows.length ? `<ul>${rows.map(fn).join('')}</ul>` : `<p class="muted">${empty}</p>`;
  view(`<h1>Dashboard <span class="muted small">· ${esc(await orgName())}</span></h1>
    <div class="grid">
      <div class="card"><div class="stat">${lc.count ?? 0}</div>Learners</div>
      <a class="card" href="#/a/review" style="text-decoration:none;color:inherit"><div class="stat">${queue.data.length}</div>Workbooks to mark</a>
      <div class="card"><div class="stat">${ready.data.length}</div>Ready for practical</div>
      <div class="card"><div class="stat">${cert.data.length}</div>Awaiting certificate</div>
      <div class="card"><div class="stat">${done.count ?? 0}</div>Completed</div>
    </div>
    <div class="grid">
      <section class="card"><h2 style="margin-top:0">To mark</h2>${list(queue.data.slice(0, 8), 'Nothing waiting.', (a) =>
        `<li><a href="#/a/review/${a.id}">${esc(a.profiles?.full_name)} – ${esc(a.workbooks.title)}</a> <span class="small muted">${fmtDate(a.submitted_at)}</span></li>`)}${queue.data.length > 8 ? `<p><a href="#/a/review">View all ${queue.data.length} in the review queue →</a></p>` : ''}</section>
      <section class="card"><h2 style="margin-top:0">Ready for practical training</h2>${list(ready.data, 'No one yet.', (e) =>
        `<li><a href="#/a/learner/${e.learner_id}">${esc(e.profiles?.full_name)}</a> – ${esc(tName(e))} <span class="small muted">${esc(e.organisations?.name || '')}</span></li>`)}</section>
      <section class="card"><h2 style="margin-top:0">Ready to issue certificate</h2>${list(cert.data, 'No one yet.', (e) =>
        `<li><a href="#/a/learner/${e.learner_id}">${esc(e.profiles?.full_name)}</a> – ${esc(tName(e))}</li>`)}</section>
    </div>`);
}

// ---------------- learners ----------------
let showGuests = false;
async function learners() {
  const all = must(await orgF(sb.from('profiles').select('id, full_name, email, dob, created_at, organisations(name), enrollments!enrollments_learner_id_fkey(status, title, packages(name))')
    .in('role', ['learner', 'pending']).order('full_name'), 'organisation_id'));
  const guests = all.filter((p) => !p.email);   // guest demo accounts have no email
  const rows = showGuests ? all : all.filter((p) => p.email);
  view(`<div class="row between"><h1>Learners <span class="muted small">· ${esc(await orgName())}</span></h1>
      <input id="search" placeholder="Search name or email" style="max-width:280px"></div>
    <p class="small muted">Learners create their own accounts with an <a href="#/a/invites">invite code</a>.
      ${guests.length ? `<label style="display:inline;font-weight:400;margin-left:.5rem"><input type="checkbox" id="sg" ${showGuests ? 'checked' : ''}>Show ${guests.length} demo guest${guests.length === 1 ? '' : 's'}</label>
        ${showGuests ? '<button class="btn small danger" id="delguests">Remove all demo guests</button>' : ''}` : ''}</p>
    <div class="card table-wrap"><table><thead><tr><th>Name</th><th>Organisation</th><th>Training</th><th>Joined</th></tr></thead><tbody>
    ${rows.map((p) => `<tr class="click" data-id="${p.id}" data-s="${esc((p.full_name + ' ' + p.email).toLowerCase())}">
      <td>${esc(p.full_name || '(no name)')}${p.email ? '' : ' <span class="badge warn">Demo guest</span>'}<div class="small muted">${esc(p.email)}</div></td>
      <td>${esc(p.organisations?.name || '—')}</td>
      <td>${p.enrollments.map((e) => `${esc(tName(e))} ${badge(e.status)}`).join('<br>') || '—'}</td>
      <td class="nowrap">${fmtDate(p.created_at)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No learners yet.</td></tr>'}
    </tbody></table></div>`);
  $$('tr.click').forEach((tr) => (tr.onclick = () => go(`#/a/learner/${tr.dataset.id}`)));
  $('#search').oninput = (e) => $$('tr.click').forEach((tr) => (tr.hidden = !tr.dataset.s.includes(e.target.value.toLowerCase())));
  $('#sg') && ($('#sg').onchange = (e) => { showGuests = e.target.checked; learners(); });
  $('#delguests') && ($('#delguests').onclick = async () => {
    if (!confirm(`Remove all ${guests.length} demo guest accounts and their demo answers?`)) return;
    must(await sb.from('profiles').delete().in('id', guests.map((g) => g.id)));
    toast('Demo guests removed'); learners();
  });
}

async function learner(id) {
  const [p, orgsL, enrs, asg, pracs, wbs, pkgs] = await Promise.all([
    sb.from('profiles').select('*').eq('id', id).single(),
    sb.from('organisations').select('id,name').order('name'),
    sb.from('enrollments').select('*, packages(name, code)').eq('learner_id', id).order('started_at'),
    sb.from('assignments').select('*, workbooks(title, version)').eq('learner_id', id),
    sb.from('practical_assessments').select('*, enrollments!inner(learner_id)').eq('enrollments.learner_id', id).order('assessed_on'),
    sb.from('workbooks').select('id,title,version').eq('is_active', true).order('title'),
    sb.from('packages').select('id,name,code').eq('is_active', true).order('name'),
  ]).then((r) => r.map((x) => must(x)));

  const enrHtml = enrs.map((e) => {
    const mine = asg.filter((a) => a.enrollment_id === e.id);
    const pr = pracs.filter((x) => x.enrollment_id === e.id);
    const avail = wbs.filter((w) => !mine.some((a) => a.workbook_id === w.id));
    return `<section class="card">
      <div class="row between"><h2 style="margin:0">${esc(tName(e))} <span class="small muted">${esc(e.packages?.code || 'Custom selection')}</span></h2>${badge(e.status)}</div>
      ${stageSteps(e.status)}
      <h3>Workbooks</h3>
      <div class="table-wrap"><table><thead><tr><th>Workbook</th><th>Status</th><th>Score</th><th>Submitted</th><th></th></tr></thead><tbody>
      ${mine.map((a) => `<tr><td>${esc(a.workbooks.title)} <span class="small muted">v${esc(a.workbooks.version)}</span>${a.attempt > 1 ? ` <span class="small muted">· attempt ${a.attempt}</span>` : ''}${a.learning_done_at ? `<div class="small muted">Learning read ${fmtDate(a.learning_done_at)}</div>` : ''}</td>
        <td>${badge(a.status)}</td><td>${a.score != null ? a.score + '%' : '—'}</td><td>${fmtDate(a.submitted_at)}</td>
        <td class="right nowrap">${['submitted', 'competent', 'resubmit'].includes(a.status) ? `<a class="btn small" href="#/a/review/${a.id}">${a.status === 'submitted' ? 'Mark' : 'View'}</a>` : ''}
          ${a.status === 'not_started' ? `<button class="btn small danger" data-unassign="${a.id}">Remove</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">None</td></tr>'}
      </tbody></table></div>
      ${avail.length ? `<div class="row" style="margin-top:.6rem"><select data-wbsel="${e.id}" style="max-width:340px"><option value="">Assign another workbook…</option>
        ${avail.map((w) => `<option value="${w.id}">${esc(w.title)} (v${esc(w.version)})</option>`).join('')}</select>
        <button class="btn small" data-assign="${e.id}">Assign</button></div>` : ''}
      <h3>Practical training</h3>
      ${pr.map((x) => `<p>${fmtDate(x.assessed_on)} ${esc(x.location || '')} ${badge(x.outcome)} <a href="#/a/practical/${e.id}/${x.id}">Open</a></p>`).join('') || '<p class="muted">Not recorded yet.</p>'}
      <a class="btn small secondary" href="#/a/practical/${e.id}/new">Record practical assessment</a>
      <h3>Completion</h3>
      <label for="tc_${e.id}">Trainer comments for the report</label>
      <textarea id="tc_${e.id}">${esc(e.trainer_comments || '')}</textarea>
      <div class="row" style="margin-top:.6rem">
        <button class="btn small secondary" data-savecomments="${e.id}">Save comments</button>
        ${['practical_complete', 'completed'].includes(e.status) ? `<button class="btn small ok" data-issue="${e.id}">${e.status === 'completed' ? 'Re-issue certificate' : 'Issue certificate'}</button>` : ''}
        <a class="btn small secondary" href="#/doc/report/${e.id}">Training report</a>
        ${e.status === 'completed' ? `<a class="btn small secondary" href="#/doc/cert/${e.id}">Certificate</a>` : ''}
        ${e.status !== 'completed' ? `<button class="btn small danger" data-withdraw="${e.id}" data-st="${e.status}">${e.status === 'withdrawn' ? 'Reinstate' : 'Withdraw'}</button>` : ''}
      </div>
      ${e.certificate_number ? `<p class="small muted">Certificate ${esc(e.certificate_number)} · completed ${fmtDate(e.completed_at)}${e.expires_at ? ' · expires ' + fmtDate(e.expires_at) : ''}</p>` : ''}
    </section>`;
  }).join('');

  view(`<p><a href="#/a/learners">← Learners</a></p>
    <h1>${esc(p.full_name || p.email)}</h1>
    <section class="card"><h2 style="margin-top:0">Details</h2>
      <form id="pf"><div class="inline-fields">
        <div><label>Full name</label><input name="full_name" value="${esc(p.full_name)}"></div>
        <div><label>Date of birth</label><input type="date" name="dob" value="${esc(p.dob)}"></div>
        <div><label>Phone</label><input name="phone" value="${esc(p.phone)}"></div>
        <div><label>Organisation</label><select name="organisation_id"><option value="">—</option>${opt(orgsL, p.organisation_id)}</select></div>
        <div><label>Access</label><select name="role">${['learner', 'pending', 'admin'].map((r) => `<option ${r === p.role ? 'selected' : ''}>${r}</option>`).join('')}</select></div>
      </div><p class="small muted">Email: ${esc(p.email)}</p><button class="btn small">Save details</button></form>
    </section>
    ${enrHtml}
    <section class="card"><h2 style="margin-top:0">Enrol in another package</h2>
      <div class="row"><select id="newpkg" style="max-width:340px"><option value="">Choose package…</option>${opt(pkgs.filter((k) => !enrs.some((e) => e.package_id === k.id)), '', (k) => `${k.name} (${k.code})`)}</select>
      <button class="btn small" id="enrol">Enrol</button></div></section>`);

  $('#pf').onsubmit = async (e) => {
    e.preventDefault(); const d = formData(e.target);
    if (d.role === 'admin' && !confirm('Give this person full admin access?')) return;
    must(await sb.from('profiles').update({ ...d, dob: d.dob || null, organisation_id: d.organisation_id || null }).eq('id', id));
    // keep enrolments' organisation in step with the learner
    if (d.organisation_id) must(await sb.from('enrollments').update({ organisation_id: d.organisation_id }).eq('learner_id', id));
    toast('Saved');
  };
  $$('[data-assign]').forEach((b) => (b.onclick = async () => {
    const wb = $(`[data-wbsel="${b.dataset.assign}"]`).value; if (!wb) return;
    must(await sb.from('assignments').insert({ enrollment_id: b.dataset.assign, learner_id: id, workbook_id: wb }));
    toast('Workbook assigned'); learner(id);
  }));
  $$('[data-unassign]').forEach((b) => (b.onclick = async () => {
    if (!confirm('Remove this workbook from the learner?')) return;
    must(await sb.from('assignments').delete().eq('id', b.dataset.unassign)); learner(id);
  }));
  $$('[data-savecomments]').forEach((b) => (b.onclick = async () => {
    must(await sb.from('enrollments').update({ trainer_comments: $(`#tc_${b.dataset.savecomments}`).value }).eq('id', b.dataset.savecomments)); toast('Saved');
  }));
  $$('[data-issue]').forEach((b) => (b.onclick = async () => {
    const no = must(await sb.rpc('issue_certificate', { p_enr: b.dataset.issue, p_comments: $(`#tc_${b.dataset.issue}`).value }));
    toast(`Certificate ${no} issued`); go(`#/doc/cert/${b.dataset.issue}`);
  }));
  $$('[data-withdraw]').forEach((b) => (b.onclick = async () => {
    const reinstate = b.dataset.st === 'withdrawn';
    if (!confirm(reinstate ? 'Reinstate this enrolment?' : 'Withdraw this learner from the package?')) return;
    must(await sb.from('enrollments').update({ status: reinstate ? 'workbooks' : 'withdrawn' }).eq('id', b.dataset.withdraw));
    if (reinstate) await sb.rpc('enroll_learner', { p_learner: id, p_package: enrs.find((e) => e.id === b.dataset.withdraw).package_id, p_org: p.organisation_id });
    learner(id);
  }));
  $('#enrol').onclick = async () => {
    const pk = $('#newpkg').value; if (!pk) return;
    must(await sb.rpc('enroll_learner', { p_learner: id, p_package: pk, p_org: p.organisation_id }));
    toast('Enrolled'); learner(id);
  };
}

// ---------------- marking ----------------
const RQ = { q: '', org: '', wb: '', from: '', to: '', group: 'none', page: 1, sel: new Set() };
const PAGE = 25;

async function reviewQueue() {
  const rows = must(await orgF(sb.from('assignments')
    .select('id, status, submitted_at, attempt, workbook_id, workbooks(title), profiles(full_name), enrollments!inner(organisation_id, organisations(name))')
    .in('status', ['submitted', 'resubmit']).order('submitted_at'), 'enrollments.organisation_id'));
  // Auto-marked, all correct: every question is multiple choice / true-false and every answer is correct
  const subIds = rows.filter((r) => r.status === 'submitted').map((r) => r.id);
  const [ansR, qR] = await Promise.all([
    subIds.length ? sb.from('answers').select('assignment_id, is_correct').in('assignment_id', subIds) : { data: [] },
    sb.from('questions').select('workbook_id, qtype'),
  ]);
  const ans = must(ansR), qs = must(qR);
  const wbInfo = {};
  qs.forEach((q) => { const w = (wbInfo[q.workbook_id] ||= { n: 0, auto: true }); w.n++; if (!['multiple_choice', 'true_false', 'multi_select'].includes(q.qtype)) w.auto = false; });
  const byA = {};
  ans.forEach((x) => { const o = (byA[x.assignment_id] ||= { n: 0, ok: 0 }); o.n++; if (x.is_correct === true) o.ok++; });
  rows.forEach((r) => {
    const w = wbInfo[r.workbook_id], o = byA[r.id];
    r.auto = r.status === 'submitted' && !!w && w.n > 0 && w.auto && !!o && o.n === w.n && o.ok === w.n;
  });

  const orgs = [...new Set(rows.map((r) => r.enrollments.organisations?.name).filter(Boolean))].sort();
  const wbs = [...new Set(rows.map((r) => r.workbooks.title))].sort();
  const draw = () => {
    const q = RQ.q.trim().toLowerCase();
    let list = rows.filter((r) =>
      (!q || (r.profiles?.full_name || '').toLowerCase().includes(q)) &&
      (!RQ.org || r.enrollments.organisations?.name === RQ.org) &&
      (!RQ.wb || r.workbooks.title === RQ.wb) &&
      (!RQ.from || (r.submitted_at || '') >= RQ.from) &&
      (!RQ.to || (r.submitted_at || '').slice(0, 10) <= RQ.to));
    const pages = Math.max(1, Math.ceil(list.length / PAGE));
    RQ.page = Math.min(RQ.page, pages);
    try { sessionStorage.setItem('reviewQueue', JSON.stringify(list.filter((r) => r.status === 'submitted').map((r) => r.id))); } catch {}
    const shown = list.slice((RQ.page - 1) * PAGE, RQ.page * PAGE);
    const autoAll = list.filter((r) => r.auto);
    const tr = (a) => `<tr class="click" data-id="${a.id}"><td>${a.auto ? `<input type="checkbox" class="sel" data-id="${a.id}" ${RQ.sel.has(a.id) ? 'checked' : ''} aria-label="Select ${esc(a.profiles?.full_name)}">` : ''}</td>
      <td>${esc(a.profiles?.full_name)}</td><td>${esc(a.workbooks.title)}${a.attempt > 1 ? ` <span class="small muted">attempt ${a.attempt}</span>` : ''}</td>
      <td>${esc(a.enrollments.organisations?.name || '')}</td><td>${badge(a.status)}${a.auto ? ' <span class="badge ok">Auto-marked, all correct</span>' : ''}</td><td>${fmtDate(a.submitted_at)}</td></tr>`;
    const keyOf = (a) => (RQ.group === 'org' ? a.enrollments.organisations?.name : a.workbooks.title) || 'Other';
    let body;
    if (RQ.group === 'none') body = shown.map(tr).join('');
    else {
      const g = {}; shown.forEach((a) => (g[keyOf(a)] ||= []).push(a));
      body = Object.entries(g).map(([k, v]) => `<tr class="grp"><td colspan="6"><b>${esc(k)}</b> <span class="muted small">${v.length} on this page</span></td></tr>${v.map(tr).join('')}`).join('');
    }
    $('#rq').innerHTML = `
      <div class="row" style="gap:.5rem">
        <input id="fq" placeholder="Search learner" value="${esc(RQ.q)}" style="max-width:200px">
        <select id="fo" style="max-width:200px"><option value="">All organisations</option>${orgs.map((o) => `<option ${o === RQ.org ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>
        <select id="fw" style="max-width:240px"><option value="">All workbooks</option>${wbs.map((o) => `<option ${o === RQ.wb ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>
        <label class="small" style="margin:0">From</label><input id="ff" type="date" value="${RQ.from}" style="max-width:150px">
        <label class="small" style="margin:0">To</label><input id="ft" type="date" value="${RQ.to}" style="max-width:150px">
        <select id="fg" style="max-width:180px"><option value="none" ${RQ.group === 'none' ? 'selected' : ''}>No grouping</option><option value="org" ${RQ.group === 'org' ? 'selected' : ''}>Group by organisation</option><option value="wb" ${RQ.group === 'wb' ? 'selected' : ''}>Group by workbook</option></select>
      </div>
      ${autoAll.length ? `<div class="notice info" style="margin-top:.75rem"><b>${autoAll.length}</b> submission${autoAll.length === 1 ? '' : 's'} auto-marked with every answer correct (no written answers).
        <button class="btn small secondary" id="selauto">Select all ${autoAll.length}</button>
        <button class="btn small ok" id="bulk" ${[...RQ.sel].some((id) => rows.find((r) => r.id === id)) ? '' : 'disabled'}>Mark ${[...RQ.sel].filter((id) => rows.find((r) => r.id === id)).length} selected competent</button></div>` : ''}
      <div class="card table-wrap" style="margin-top:.75rem"><table><thead><tr><th></th><th>Learner</th><th>Workbook</th><th>Organisation</th><th>Status</th><th>Submitted</th></tr></thead><tbody>
      ${body || '<tr><td colspan="6" class="muted">Nothing to review.</td></tr>'}</tbody></table></div>
      <div class="row between"><span class="small muted">${list.length} of ${rows.length} · oldest first</span>
        <span class="row"><button class="btn small secondary" id="pp" ${RQ.page <= 1 ? 'disabled' : ''}>Previous</button><span class="small">Page ${RQ.page} of ${pages}</span><button class="btn small secondary" id="pn" ${RQ.page >= pages ? 'disabled' : ''}>Next</button></span></div>`;
    const bind = (id, key, ev = 'onchange') => { $(id)[ev] = (e) => { RQ[key] = e.target.value; RQ.page = 1; draw(); if (key === 'q') { const i = $('#fq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }; };
    bind('#fq', 'q', 'oninput'); bind('#fo', 'org'); bind('#fw', 'wb'); bind('#ff', 'from'); bind('#ft', 'to'); bind('#fg', 'group');
    $('#pp').onclick = () => { RQ.page--; draw(); }; $('#pn').onclick = () => { RQ.page++; draw(); };
    $$('tr.click').forEach((t) => (t.onclick = (e) => { if (e.target.closest('input')) return; go(`#/a/review/${t.dataset.id}`); }));
    $$('.sel').forEach((c) => (c.onchange = () => { c.checked ? RQ.sel.add(c.dataset.id) : RQ.sel.delete(c.dataset.id); draw(); }));
    if ($('#selauto')) $('#selauto').onclick = () => { autoAll.forEach((r) => RQ.sel.add(r.id)); draw(); };
    if ($('#bulk')) $('#bulk').onclick = async () => {
      const ids = [...RQ.sel].filter((id) => rows.find((r) => r.id === id && r.auto));
      if (!ids.length) return;
      if (!confirm(`Mark ${ids.length} submission${ids.length === 1 ? '' : 's'} competent? Every answer in each was auto-marked correct.`)) return;
      let done = 0;
      for (const id of ids) { must(await sb.rpc('finalise_review', { p_assignment: id, p_outcome: 'competent', p_notes: '' })); done++; }
      RQ.sel.clear(); toast(`${done} marked competent`); reviewQueue();
    };
  };
  view(`<h1>Review <span class="muted small">· ${esc(await orgName())}</span></h1><div id="rq"></div>`);
  draw();
}

async function review(id) {
  const a = must(await sb.from('assignments').select('*, workbooks(*), profiles(full_name, id)').eq('id', id).single());
  const [qs, ans] = await Promise.all([
    sb.from('questions').select('*').eq('workbook_id', a.workbook_id).order('position'),
    sb.from('answers').select('*').eq('assignment_id', id),
  ]).then((r) => r.map((x) => must(x)));
  const keys = qs.length ? must(await sb.from('question_keys').select('*').in('question_id', qs.map((q) => q.id))) : [];
  const k = Object.fromEntries(keys.map((x) => [x.question_id, x]));
  const byQ = Object.fromEntries(ans.map((x) => [x.question_id, x]));
  const locked = a.status !== 'submitted';

  let qids = []; try { qids = JSON.parse(sessionStorage.getItem('reviewQueue') || '[]'); } catch {}
  const qi = qids.indexOf(id), prevId = qi > 0 ? qids[qi - 1] : null, nextId = qi >= 0 && qi < qids.length - 1 ? qids[qi + 1] : null;
  view(`<div class="row between"><span><a href="#/a/review">← Queue</a> &middot; <a href="#/a/learner/${a.profiles.id}">${esc(a.profiles.full_name)}</a></span>
    ${qi >= 0 ? `<span class="row small">${prevId ? `<a class="btn small secondary" href="#/a/review/${prevId}">Previous</a>` : ''}<span class="muted">${qi + 1} of ${qids.length}</span>${nextId ? `<a class="btn small secondary" href="#/a/review/${nextId}">Next</a>` : ''}</span>` : ''}</div>
    <div class="card"><div class="row between"><h1 style="margin:0">${esc(a.workbooks.title)}</h1>${badge(a.status)}</div>
    <p class="muted">${esc(a.profiles.full_name)} · submitted ${fmtDate(a.submitted_at)} · attempt ${a.attempt} · pass mark ${a.workbooks.pass_percent}%</p>
    ${locked ? `<div class="notice info">This workbook is ${a.status === 'competent' ? 'marked competent' : a.status === 'resubmit' ? 'back with the learner for resubmission' : 'not submitted yet'}. You can still view it${a.status === 'competent' ? ' or re-open it below' : ''}.</div>` : ''}
    <form id="rv">
    ${qs.map((q, i) => {
      const an = byQ[q.id] || {}; const key = k[q.id] || {};
      return `<div class="question" data-ans="${an.id || ''}">
        <div><span class="qnum">Q${i + 1}.</span> ${esc(q.prompt).replace(/\n/g, '<br>')} <span class="small muted">(${q.marks} mark${q.marks === 1 ? '' : 's'})</span>${q.critical ? ' <span class="badge bad">Critical</span>' : ''}</div>
        <div class="response" style="margin:.4rem 0">${esc(ansText(an.response)) || '<span class="muted">No answer</span>'}</div>
        ${key.correct_answer ? `<div class="small"><b>Expected:</b> ${esc(ansText(key.correct_answer))}</div>` : ''}
        ${key.feedback ? `<div class="small muted"><b>Feedback note:</b> ${esc(key.feedback)}</div>` : ''}
        ${key.marking_guide ? `<div class="small muted"><b>Marking guide:</b> ${esc(key.marking_guide)}</div>` : ''}
        ${an.id ? `<div class="row" style="margin-top:.4rem">
          <label class="choice" style="margin:0"><input type="radio" name="c_${an.id}" value="1" ${an.is_correct === true ? 'checked' : ''} ${locked ? 'disabled' : ''}>Satisfactory</label>
          <label class="choice" style="margin:0"><input type="radio" name="c_${an.id}" value="0" ${an.is_correct === false ? 'checked' : ''} ${locked ? 'disabled' : ''}>Not satisfactory</label>
        </div>
        <input name="m_${an.id}" placeholder="Comment to learner (optional)" value="${esc(an.marker_comment)}" ${locked ? 'disabled' : ''} style="margin-top:.4rem">` : ''}
      </div>`;
    }).join('')}
    <label for="notes">Overall comments to learner</label><textarea id="notes" name="notes" ${locked ? 'disabled' : ''}>${esc(a.reviewer_notes)}</textarea>
    <div class="sticky-actions row">
      ${locked ? (a.status === 'competent' ? '<button type="button" class="btn danger" id="reopen">Re-open for resubmission</button>' : '')
        : `<button type="button" class="btn ok" id="comp">Mark competent</button><button type="button" class="btn danger" id="resub">Return for resubmission</button>`}
    </div></form></div>`);

  const saveMarks = async () => {
    const rows = $$('[data-ans]').filter((d) => d.dataset.ans).map((d) => {
      const aid = d.dataset.ans; const c = $(`[name="c_${aid}"]:checked`);
      return { id: aid, is_correct: c ? c.value === '1' : null, marker_comment: $(`[name="m_${aid}"]`).value || null };
    });
    for (const r of rows) must(await sb.from('answers').update({ is_correct: r.is_correct, marker_comment: r.marker_comment }).eq('id', r.id), 'Could not save marks');
    return rows;
  };
  const finish = async (outcome) => {
    const rows = await saveMarks();
    if (outcome === 'competent') {
      const unmarked = rows.filter((r) => r.is_correct === null).length;
      if (unmarked) return toast(`Mark every answer first (${unmarked} left)`, true);
      const total = qs.reduce((s, q) => s + q.marks, 0);
      const got = qs.reduce((s, q) => s + (byQ[q.id] && rows.find((r) => r.id === byQ[q.id].id)?.is_correct ? q.marks : 0), 0);
      const pct = total ? Math.round((got / total) * 100) : 100;
      if (pct < a.workbooks.pass_percent && !confirm(`Score is ${pct}%, below the ${a.workbooks.pass_percent}% pass mark. Mark competent anyway?`)) return;
    }
    must(await sb.rpc('finalise_review', { p_assignment: id, p_outcome: outcome, p_notes: $('#notes').value }));
    toast(outcome === 'competent' ? 'Marked competent' : 'Returned to learner');
    if (qi >= 0) { const rest = qids.filter((x) => x !== id); try { sessionStorage.setItem('reviewQueue', JSON.stringify(rest)); } catch {} return go(rest.length ? `#/a/review/${nextId || rest[Math.max(0, qi - 1)]}` : '#/a/review'); }
    go(`#/a/learner/${a.profiles.id}`);
  };
  $('#comp') && ($('#comp').onclick = () => finish('competent'));
  $('#resub') && ($('#resub').onclick = () => finish('resubmit'));
  $('#reopen') && ($('#reopen').onclick = async () => {
    if (!confirm('Send this workbook back to the learner?')) return;
    must(await sb.rpc('finalise_review', { p_assignment: id, p_outcome: 'resubmit', p_notes: a.reviewer_notes })); review(id);
  });
}

// ---------------- workbooks ----------------
async function workbooks() {
  const [rows, orgsById] = await Promise.all([
    sb.from('workbooks').select('*, questions(count), learning_items(count), competencies(count), assignments(count), workbook_organisations(organisation_id), package_workbooks(packages(code))').order('title').then((r) => must(r)),
    orgsMap(),
  ]);
  const list = rows.filter((w) => availableTo(w.workbook_organisations));
  const n = (x) => x?.[0]?.count ?? 0;
  const row = (w) => `<tr class="click" data-id="${w.id}">
      <td><b>${esc(w.title)}</b> <span class="small muted">v${esc(w.version)}</span> ${w.is_active ? '' : '<span class="badge">Archived</span>'}
        <div class="small muted">${esc(orgList(w.workbook_organisations, orgsById))}</div></td>
      <td>${n(w.learning_items)}</td><td>${n(w.questions)}</td><td>${n(w.competencies)}</td>
      <td class="small">${w.package_workbooks.map((x) => esc(x.packages?.code)).join(', ') || '—'}</td>
      <td>${n(w.assignments)}</td>
      <td class="right nowrap"><a class="btn small secondary" href="#/a/preview/${w.id}" data-stop>Preview</a></td></tr>`;
  const live = list.filter((w) => w.is_active), old = list.filter((w) => !w.is_active);
  view(`<div class="row between"><h1>Workbook library <span class="muted small">· ${esc(await orgName())}</span></h1><span class="row"><a class="btn secondary" href="#/a/prices">Price list</a><a class="btn secondary" href="#/a/workbook/new">New blank workbook</a><a class="btn" href="#/a/import">Import from Excel</a></span></div>
    <p class="small muted">Each workbook has Part 1 learning material, Part 2 knowledge questions and the practical skills it covers. ${state.org ? 'Showing workbooks available to this organisation.' : ''}</p>
    <div class="card table-wrap"><table><thead><tr><th>Workbook</th><th>Learning</th><th>Questions</th><th>Practical skills</th><th>In packages</th><th>Assigned</th><th></th></tr></thead><tbody>
    ${live.map(row).join('') || '<tr><td colspan="7" class="muted">No workbooks yet.</td></tr>'}
    </tbody></table></div>
    ${old.length ? `<details class="card" style="margin-top:1rem"><summary><b>Archived workbooks</b> <span class="small muted">· ${old.length} · old versions. Not offered for new learners or packages. Learners already on them can finish, and trainer marking carries on as normal.</span></summary>
      <div class="table-wrap"><table><thead><tr><th>Workbook</th><th>Learning</th><th>Questions</th><th>Practical skills</th><th>In packages</th><th>Assigned</th><th></th></tr></thead><tbody>${old.map(row).join('')}</tbody></table></div></details>` : ''}`);
  $$('[data-stop]').forEach((a) => (a.onclick = (e) => e.stopPropagation()));
  $$('tr.click').forEach((tr) => (tr.onclick = () => go(`#/a/workbook/${tr.dataset.id}`)));
}

// What the learner sees, without needing a learner account
async function preview(id) {
  const [w, items, qs, skills] = await Promise.all([
    sb.from('workbooks').select('*').eq('id', id).single(),
    sb.from('learning_items').select('*').eq('workbook_id', id).order('position'),
    sb.from('questions').select('*').eq('workbook_id', id).order('position'),
    sb.from('competencies').select('*').eq('workbook_id', id).order('position'),
  ]).then((r) => r.map((x) => must(x)));
  let pn = 0;
  view(`<div class="row"><a href="#/a/workbook/${id}">← Edit workbook</a><span class="badge warn">Preview – nothing is saved</span></div>
    <div class="card"><h1>${esc(w.title)}</h1>
    <h2>Part 1 · Learning</h2>
    ${items.map((it, ix) => it.kind === 'content' ? blockHtml(it, items[ix - 1])
      : `<section class="practice"><div class="small" style="font-weight:700;color:var(--brand)">Check your understanding ${++pn}</div><div>${esc(it.body)}</div>
        <ul>${(it.qtype === 'true_false' ? ['True', 'False'] : it.options).map((o) => `<li>${esc(o)}${(it.qtype === 'multi_select' ? (parseMulti(it.answer) || []).includes(o) : o === it.answer) ? ' ✓' : ''}</li>`).join('')}</ul>
        ${it.explanation ? `<div class="small muted">${esc(it.explanation)}</div>` : ''}</section>`).join('') || '<p class="muted">No learning material.</p>'}
    <h2>Part 2 · Knowledge assessment</h2>
    ${qs.map((q, i) => `<div class="question"><span class="qnum">Q${i + 1}.</span> ${esc(q.prompt)} <span class="small muted">(${q.qtype.replace('_', ' ')}, ${q.marks} mark${q.marks === 1 ? '' : 's'})</span>${q.critical ? ' <span class="badge bad">Critical</span>' : ''}
      ${['multiple_choice', 'multi_select'].includes(q.qtype) ? `<ul>${q.options.map((o) => `<li>${esc(o)}</li>`).join('')}</ul>` : ''}</div>`).join('') || '<p class="muted">No questions.</p>'}
    <h2>Practical skills assessed</h2>
    ${skills.length ? `<ol>${skills.map((c) => `<li>${esc(c.description)}${c.critical ? ' <span class="badge bad">Critical</span>' : ''}${c.criteria ? `<div class="small muted">${esc(c.criteria)}</div>` : ''}</li>`).join('')}</ol>` : '<p class="muted">None linked to this workbook.</p>'}
    </div>`);
}

function parseCSV(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

async function workbookEditor(id) {
  const isNew = id === 'new';
  let w = { title: '', description: '', version: '1.0', pass_percent: 100, is_active: true }, qs = [], used = 0, lis = [], skills = [], wOrgs = [], outcomes = [];
  const orgsL = must(await sb.from('organisations').select('id,name').order('name'));
  if (!isNew) {
    w = must(await sb.from('workbooks').select('*').eq('id', id).single());
    const raw = must(await sb.from('questions').select('*').eq('workbook_id', id).order('position'));
    const keys = must(await sb.from('question_keys').select('*').in('question_id', raw.map((q) => q.id).concat(uuid())));
    const km = Object.fromEntries(keys.map((k) => [k.question_id, k]));
    qs = raw.map((q) => ({ ...q, correct_answer: km[q.id]?.correct_answer || '', marking_guide: km[q.id]?.marking_guide || '', feedback: km[q.id]?.feedback || '' }));
    outcomes = must(await sb.from('outcomes').select('*').eq('workbook_id', id).order('position'));
    used = (await sb.from('assignments').select('id', { count: 'exact', head: true }).eq('workbook_id', id).neq('status', 'not_started')).count || 0;
    lis = must(await sb.from('learning_items').select('*').eq('workbook_id', id).order('position'));
    skills = must(await sb.from('competencies').select('*').eq('workbook_id', id).order('position'));
    wOrgs = must(await sb.from('workbook_organisations').select('organisation_id').eq('workbook_id', id)).map((x) => x.organisation_id);
  }
  const original = new Set(qs.map((q) => q.id));
  const originalLi = new Set(lis.map((x) => x.id));

  // ----- Part 1: learning material editor -----
  const liBlock = (it, i) => it.kind === 'content' ? `<div class="qedit learn-item" data-li="${it.id}" data-kind="content">
      <div class="row between"><b>Information section</b>${liBtns(i)}</div>
      ${it.block_type ? `<div class="small muted">${it.section_title ? esc(it.section_title) + ' · ' : ''}${esc(it.block_type)} block${it.outcome_code ? ' · outcome ' + esc(it.outcome_code) : ''}</div>` : ''}
      <label>Heading</label><input data-f="title" value="${esc(it.title)}">
      <label>Text</label><textarea data-f="body" style="min-height:9rem">${esc(it.body)}</textarea>
      ${it.block_type === 'image' ? `<label>Image link (https://…)</label><input data-f="image_url" value="${esc(it.image_url)}"><label>Description for screen readers</label><input data-f="alt_text" value="${esc(it.alt_text)}">` : ''}
      <div class="small muted">Blank line = new paragraph · start a line with "- " for bullet points · **bold** · "## " for a sub-heading</div>
    </div>` : `<div class="qedit learn-item practice-item" data-li="${it.id}" data-kind="practice">
      <div class="row between"><b>Practice question (not recorded)</b>${liBtns(i)}</div>
      <div class="inline-fields"><div><label>Type</label><select data-f="qtype">${[['multiple_choice', 'Multiple choice'], ['multi_select', 'Multi-select'], ['true_false', 'True / False']]
        .map(([v, l]) => `<option value="${v}" ${it.qtype === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
      <label>Question</label><textarea data-f="body" style="min-height:3.5rem">${esc(it.body)}</textarea>
      <div ${it.qtype === 'true_false' ? 'hidden' : ''}><label>Options (one per line)</label><textarea data-f="options" style="min-height:4rem">${esc((it.options || []).join('\n'))}</textarea></div>
      ${it.qtype === 'multi_select'
        ? `<label>Correct answers (one per line, matching the options exactly)</label><textarea data-f="answer" style="min-height:3.5rem">${esc((parseMulti(it.answer) || []).join('\n'))}</textarea>`
        : `<label>Correct answer</label><input data-f="answer" value="${esc(it.answer)}">`}
      <label>Feedback when correct</label><input data-f="explanation" value="${esc(it.explanation)}">
      <label>Feedback when incorrect (optional)</label><input data-f="explanation_incorrect" value="${esc(it.explanation_incorrect)}">
      <label>Hint (optional)</label><input data-f="hint" value="${esc(it.hint)}">
    </div>`;
  const liBtns = (i) => `<div class="row"><button type="button" class="btn small secondary" data-liup="${i}" aria-label="Move up">↑</button>
      <button type="button" class="btn small secondary" data-lidown="${i}" aria-label="Move down">↓</button>
      <button type="button" class="btn small danger" data-lidel="${i}">Delete</button></div>`;
  const readLi = () => $$('[data-li]').map((el) => {
    const g = (f) => el.querySelector(`[data-f="${f}"]`)?.value ?? '';
    const kind = el.dataset.kind;
    const prev = lis.find((x) => x.id === el.dataset.li) || {};
    const lines = (f) => g(f).split('\n').map((x) => x.trim()).filter(Boolean);
    if (kind === 'content') return { ...prev, id: el.dataset.li, kind, title: g('title').trim(), body: g('body'),
      ...(prev.block_type === 'image' ? { image_url: g('image_url').trim() || null, alt_text: g('alt_text').trim() || null } : {}) };
    const qtype = g('qtype');
    return { ...prev, id: el.dataset.li, kind, qtype, body: g('body').trim(), options: lines('options'),
      answer: qtype === 'multi_select' ? JSON.stringify(lines('answer')) : g('answer').trim(), explanation: g('explanation').trim(),
      explanation_incorrect: g('explanation_incorrect').trim() || null, hint: g('hint').trim() || null };
  });
  const drawLi = () => {
    $('#lis').innerHTML = lis.map(liBlock).join('') || '<p class="muted">No learning material yet. Learners will go straight to the knowledge assessment.</p>';
    $$('[data-lidel]').forEach((b) => (b.onclick = () => { lis = readLi(); lis.splice(+b.dataset.lidel, 1); drawLi(); }));
    $$('[data-liup]').forEach((b) => (b.onclick = () => { lis = readLi(); const i = +b.dataset.liup; if (i > 0) [lis[i - 1], lis[i]] = [lis[i], lis[i - 1]]; drawLi(); }));
    $$('[data-lidown]').forEach((b) => (b.onclick = () => { lis = readLi(); const i = +b.dataset.lidown; if (i < lis.length - 1) [lis[i + 1], lis[i]] = [lis[i], lis[i + 1]]; drawLi(); }));
    $$('[data-li] [data-f="qtype"]').forEach((s) => (s.onchange = () => { lis = readLi(); drawLi(); }));
  };

  const qBlock = (q, i) => `<div class="qedit" data-q="${q.id}">
    <div class="row between"><b>Question ${i + 1}</b><div class="row">
      <button type="button" class="btn small secondary" data-up="${i}" aria-label="Move up">↑</button>
      <button type="button" class="btn small secondary" data-down="${i}" aria-label="Move down">↓</button>
      <button type="button" class="btn small danger" data-del="${i}">Delete</button></div></div>
    <div class="inline-fields">
      <div><label>Type</label><select data-f="qtype">${[['short', 'Short answer'], ['long', 'Long answer'], ['multiple_choice', 'Multiple choice'], ['multi_select', 'Multi-select'], ['true_false', 'True / False']]
        .map(([v, l]) => `<option value="${v}" ${q.qtype === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div><label>Marks</label><input type="number" min="0" data-f="marks" value="${q.marks}"></div>
      <div><label>Section (optional)</label><input data-f="section" value="${esc(q.section)}"></div>
    </div>
    <label class="choice" style="max-width:420px"><input type="checkbox" data-f="critical" ${q.critical ? 'checked' : ''}>Critical: the learner must answer this correctly to be competent</label>
    <label>Question</label><textarea data-f="prompt" style="min-height:4rem">${esc(q.prompt)}</textarea>
    <div ${['multiple_choice', 'multi_select'].includes(q.qtype) ? '' : 'hidden'} data-show="mc"><label>Options (one per line)</label><textarea data-f="options" style="min-height:4rem">${esc((q.options || []).join('\n'))}</textarea></div>
    ${q.qtype === 'multi_select'
      ? `<label>Correct answers (one per line, matching the options exactly – auto-marked all-and-only)</label><textarea data-f="correct_answer" style="min-height:3.5rem">${esc((parseMulti(q.correct_answer) || []).join('\n'))}</textarea>`
      : `<label>${['multiple_choice', 'true_false'].includes(q.qtype) ? 'Correct answer (must match an option exactly – auto-marked)' : 'Model answer (shown only to you)'}</label>
    <input data-f="correct_answer" value="${esc(q.correct_answer)}">`}
    <label>Marking guide (optional, only you see this)</label><input data-f="marking_guide" value="${esc(q.marking_guide)}">
  </div>`;

  const readQs = () => $$('[data-q]').map((el) => {
    const g = (f) => el.querySelector(`[data-f="${f}"]`).value;
    const prev = qs.find((x) => x.id === el.dataset.q) || {};
    const qtype = g('qtype');
    const ca = qtype === 'multi_select' ? JSON.stringify(g('correct_answer').split('\n').map((s) => s.trim()).filter(Boolean)) : g('correct_answer').trim();
    return { ...prev, id: el.dataset.q, qtype, marks: +g('marks') || 0, section: g('section').trim() || null, prompt: g('prompt').trim(), critical: el.querySelector('[data-f="critical"]').checked,
      options: g('options').split('\n').map((s) => s.trim()).filter(Boolean), correct_answer: ca, marking_guide: g('marking_guide').trim() };
  });
  const drawQs = () => {
    $('#qs').innerHTML = qs.map(qBlock).join('') || '<p class="muted">No questions yet.</p>';
    $$('[data-del]').forEach((b) => (b.onclick = () => { qs = readQs(); qs.splice(+b.dataset.del, 1); drawQs(); }));
    $$('[data-up]').forEach((b) => (b.onclick = () => { qs = readQs(); const i = +b.dataset.up; if (i > 0) [qs[i - 1], qs[i]] = [qs[i], qs[i - 1]]; drawQs(); }));
    $$('[data-down]').forEach((b) => (b.onclick = () => { qs = readQs(); const i = +b.dataset.down; if (i < qs.length - 1) [qs[i + 1], qs[i]] = [qs[i], qs[i + 1]]; drawQs(); }));
    $$('[data-f="qtype"]').forEach((s) => (s.onchange = () => { qs = readQs(); drawQs(); }));
  };

  view(`<p><a href="#/a/workbooks">← Workbooks</a></p>
    ${isNew ? `<p><a class="btn" href="#/a/import">Import from Excel</a> <span class="small muted">Already built it in Mark's template? Upload it and skip the typing.</span></p>` : ''}
    <h1>${isNew ? 'New workbook' : esc(w.title)}</h1>
    ${used ? `<div class="notice">${used} learner(s) have already started or submitted this workbook. Small wording fixes are fine. For bigger changes use <b>Save as new version</b> so existing answers stay intact.</div>` : ''}
    <form id="wf" class="card">
      <div class="inline-fields">
        <div style="grid-column:span 2"><label>Title</label><input name="title" required value="${esc(w.title)}"></div>
        <div><label>Version</label><input name="version" value="${esc(w.version)}"></div>
        <div><label>Pass mark %</label><input name="pass_percent" type="number" min="0" max="100" value="${w.pass_percent}"></div>
      </div>
      <label>Description / instructions for learners</label><textarea name="description">${esc(w.description)}</textarea>
      <label class="choice" style="max-width:260px"><input type="checkbox" name="is_active" ${w.is_active ? 'checked' : ''}>Active (can be assigned)</label>
      ${orgPicker(orgsL, wOrgs)}
      ${!isNew ? `<p class="row"><a class="btn small secondary" href="#/a/preview/${id}">Preview as learner</a><a class="btn small" href="#/a/replace/${id}">Replace with updated template</a></p>` : ''}
      <h2>Part 1 · Learning material</h2>
      <p class="small muted">What the learner needs to know, with optional practice questions. Practice answers are never recorded.</p>
      <div id="lis"></div>
      <div class="row"><button type="button" class="btn secondary" id="addc">+ Information section</button>
        <button type="button" class="btn secondary" id="addp">+ Practice question</button></div>
      <h2>Part 2 · Knowledge assessment</h2>
      <p class="small muted">Marked questions. Multiple choice and true/false are marked automatically; you mark written answers.</p>
      <div id="qs"></div>
      <div class="row"><button type="button" class="btn secondary" id="addq">+ Add question</button>
        <button type="button" class="btn secondary" id="impbtn">Import from CSV</button></div>
      <div id="imp" hidden class="qedit">
        <p class="small">CSV columns (first row is headings): <code>section, question, type, options, answer, marks</code><br>
        type = short, long, multiple_choice or true_false. Separate options with <code>|</code>, e.g. <code>10 mL|20 mL|50 mL</code>.
        Make it in Excel or Google Sheets, then File › Download › CSV. <button type="button" class="linkbtn" id="tmpl">Download a template</button></p>
        <input type="file" id="csv" accept=".csv,text/csv">
      </div>
      ${outcomes.length ? `<h2>Learning outcomes</h2>
      <p class="small muted">Set by the Excel import. Re-import to change them. Coverage counts what teaches and assesses each outcome.</p>
      <div class="table-wrap"><table><thead><tr><th>Outcome</th><th>Assessed by</th><th>Reading</th><th>Knowledge</th><th>Practical</th><th></th></tr></thead><tbody>
      ${outcomes.map((o) => { const rd = lis.filter((x) => x.kind === 'content' && x.outcome_code === o.code).length, kq = qs.filter((q) => q.outcome_code === o.code).length, pr = skills.filter((c) => c.outcome_code === o.code).length;
        const gap = !rd || (o.assessed_by !== 'Practical' && !kq) || (o.assessed_by !== 'Knowledge' && !pr);
        return `<tr><td><b>${esc(o.code)}</b> ${esc(o.description)}</td><td>${esc(o.assessed_by)}</td><td>${rd}</td><td>${kq}</td><td>${pr}</td><td>${gap ? '<span class="badge warn">Gap</span>' : '<span class="badge ok">Covered</span>'}</td></tr>`; }).join('')}
      </tbody></table></div>` : ''}
      <h2>Practical skills</h2>
      <p class="small muted">The skills from this workbook that you'll check in the practical assessment, one per line. They're added automatically to the practical checklist of any package or invite that includes this workbook.</p>
      <textarea name="skills" style="min-height:8rem" placeholder="Performs hand hygiene and uses PPE correctly&#10;Positions the participant correctly&#10;…">${esc(skills.map((c) => c.description).join('\n'))}</textarea>
      <div class="sticky-actions row"><button class="btn">Save workbook</button>
        ${!isNew ? '<button type="button" class="btn secondary" id="dup">Save as new version</button>' : ''}</div>
    </form>`);
  drawQs();
  drawLi();
  wireOrgPicker();
  $('#addc').onclick = () => { lis = readLi(); lis.push({ id: uuid(), kind: 'content', title: '', body: '' }); drawLi(); };
  $('#addp').onclick = () => { lis = readLi(); lis.push({ id: uuid(), kind: 'practice', qtype: 'multiple_choice', body: '', options: [], answer: '', explanation: '' }); drawLi(); };

  $('#addq').onclick = () => { qs = readQs(); qs.push({ id: uuid(), qtype: 'short', marks: 1, prompt: '', options: [], correct_answer: '', marking_guide: '', section: qs.at(-1)?.section || '' }); drawQs(); };
  $('#impbtn').onclick = () => ($('#imp').hidden = !$('#imp').hidden);
  $('#tmpl').onclick = () => {
    const csv = 'section,question,type,options,answer,marks\nSafety,What is the first thing you do before any procedure?,short,,Perform hand hygiene,1\nSafety,Which volume is used to flush the tube?,multiple_choice,10 mL|30 mL|100 mL,30 mL,1\nSafety,You should check the care plan before each procedure.,true_false,,True,1\n';
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'workbook-template.csv'; a.click();
  };
  $('#csv').onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    const rows = parseCSV(await file.text());
    const head = rows.shift().map((h) => h.trim().toLowerCase());
    const col = (r, n) => (r[head.indexOf(n)] ?? '').trim();
    const types = { short: 'short', long: 'long', multiple_choice: 'multiple_choice', 'multiple choice': 'multiple_choice', mc: 'multiple_choice', true_false: 'true_false', 'true/false': 'true_false', tf: 'true_false' };
    const added = rows.map((r) => ({ id: uuid(), section: col(r, 'section'), prompt: col(r, 'question') || col(r, 'prompt'),
      qtype: types[col(r, 'type').toLowerCase()] || 'short', options: col(r, 'options').split('|').map((s) => s.trim()).filter(Boolean),
      correct_answer: col(r, 'answer'), marking_guide: col(r, 'marking guide'), marks: +col(r, 'marks') || 1 })).filter((q) => q.prompt);
    qs = readQs().concat(added); drawQs(); $('#imp').hidden = true; e.target.value = '';
    toast(`${added.length} questions imported – press Save`);
  };

  const save = async (asNew) => {
    const d = formData($('#wf'));
    qs = readQs(); lis = readLi();
    const badLi = lis.findIndex((x) => x.kind === 'practice' && (!x.body || !x.answer || (x.qtype === 'multiple_choice' && (x.options.length < 2 || !x.options.includes(x.answer))) || (x.qtype === 'multi_select' && (x.options.length < 2 || (parseMulti(x.answer) || []).length < 2 || !(parseMulti(x.answer) || []).every((a) => x.options.includes(a)))) || (x.qtype === 'true_false' && !['True', 'False'].includes(x.answer))));
    if (badLi >= 0) return toast(`Learning item ${badLi + 1}: practice questions need a question, options, and a correct answer that matches an option exactly`, true);
    const isOpt = (q) => ['multiple_choice', 'multi_select'].includes(q.qtype);
    const bad = qs.findIndex((q) => !q.prompt || (isOpt(q) && q.options.length < 2));
    if (bad >= 0) return toast(`Question ${bad + 1} needs text${isOpt(qs[bad]) ? ' and at least 2 options' : ''}`, true);
    const mcBad = qs.findIndex((q) => (q.qtype === 'multiple_choice' && q.correct_answer && !q.options.includes(q.correct_answer)) ||
      (q.qtype === 'true_false' && q.correct_answer && !['True', 'False'].includes(q.correct_answer)) ||
      (q.qtype === 'multi_select' && ((parseMulti(q.correct_answer) || []).length < 2 || !(parseMulti(q.correct_answer) || []).every((a) => q.options.includes(a)))));
    if (mcBad >= 0) return toast(`Question ${mcBad + 1}: correct answer must match one of the options exactly`, true);
    const rec = { title: d.title.trim(), description: d.description, version: d.version || '1.0', pass_percent: +d.pass_percent || 0, is_active: !!d.is_active };
    if (asNew) for (const k of ['code', 'author', 'audience', 'prerequisites', 'source_documents', 'est_duration_mins', 'review_date', 'max_attempts', 'randomise', 'practical_required',
      'practical_setting', 'practical_pass_rule', 'practical_pass_percent', 'practical_max_attempts', 'assessor_requirements', 'reasonable_adjustments', 'certificate_title', 'certificate_expiry_months']) rec[k] = w[k];
    let wid = id;
    if (isNew || asNew) {
      if (asNew) { rec.version = prompt('Version number for the new copy?', String((parseFloat(w.version) || 1) + 1)) || rec.version; }
      if (asNew) must(await sb.from('workbooks').update({ is_active: false }).eq('id', id)); // archive the old version first so the Workbook_ID stays unique among active workbooks
      const ins = await sb.from('workbooks').insert({ ...rec, is_active: true }).select('id').single();
      if (ins.error) { if (asNew) await sb.from('workbooks').update({ is_active: true }).eq('id', id); must(ins); }
      wid = ins.data.id;
      if (asNew && outcomes.length) must(await sb.from('outcomes').insert(outcomes.map((o) => ({ workbook_id: wid, position: o.position, code: o.code, description: o.description, assessed_by: o.assessed_by }))));
      if (asNew) { qs = qs.map((q) => ({ ...q, id: uuid() })); lis = lis.map((x) => ({ ...x, id: uuid() })); }
    } else {
      must(await sb.from('workbooks').update(rec).eq('id', id));
      const removed = [...original].filter((x) => !qs.some((q) => q.id === x));
      if (removed.length) {
        if (used && !confirm(`Delete ${removed.length} question(s)? Learner answers to them will be lost.`)) return;
        must(await sb.from('questions').delete().in('id', removed));
      }
      const removedLi = [...originalLi].filter((x) => !lis.some((l) => l.id === x));
      if (removedLi.length) must(await sb.from('learning_items').delete().in('id', removedLi));
    }
    if (lis.length) {
      must(await sb.from('learning_items').upsert(lis.map((x, i) => ({ id: x.id, workbook_id: wid, position: i + 1, kind: x.kind, title: x.title || null, body: x.body,
        qtype: x.kind === 'practice' ? x.qtype : null,
        options: x.kind === 'practice' && ['multiple_choice', 'multi_select'].includes(x.qtype) ? x.options : [],
        answer: x.kind === 'practice' ? x.answer : null, explanation: x.kind === 'practice' ? x.explanation || null : null,
        explanation_incorrect: x.kind === 'practice' ? x.explanation_incorrect || null : null, hint: x.kind === 'practice' ? x.hint || null : null,
        block_type: x.block_type || null, section_title: x.section_title || null, section_code: x.section_code || null, outcome_code: x.outcome_code || null,
        image_url: x.image_url || null, alt_text: x.alt_text || null, reference_source: x.reference_source || null }))));
    }
    if (qs.length) {
      must(await sb.from('questions').upsert(qs.map((q, i) => ({ id: q.id, workbook_id: wid, position: i + 1, section: q.section, prompt: q.prompt, qtype: q.qtype,
        options: ['multiple_choice', 'multi_select'].includes(q.qtype) ? q.options : [], marks: q.marks,
        critical: !!q.critical, outcome_code: q.outcome_code || null, source_section: q.source_section || null }))));
      must(await sb.from('question_keys').upsert(qs.map((q) => ({ question_id: q.id, correct_answer: q.correct_answer || null, marking_guide: q.marking_guide || null, feedback: q.feedback || null }))));
    }
    const skillLines = (d.skills || '').split('\n').map((x) => x.trim()).filter(Boolean);
    await saveSkills(skillLines, asNew ? [] : skills, { workbook_id: wid });
    if (asNew && skills.length) { // carry the practical detail (criteria, critical, etc.) over to the new version
      const fresh = must(await sb.from('competencies').select('id,description').eq('workbook_id', wid));
      for (const f of fresh) {
        const o = skills.find((c) => c.description === f.description); if (!o) continue;
        const { id: _i, workbook_id: _w, package_id: _p, position: _pos, description: _d, ...detail } = o;
        must(await sb.from('competencies').update(detail).eq('id', f.id));
      }
    }
    await saveOrgLinks('workbook_organisations', 'workbook_id', wid, readOrgPicker());
    if (asNew) { // move packages and invite codes that used the old version onto the new one (existing enrolments stay on the old version)
      const pk = must(await sb.from('package_workbooks').update({ workbook_id: wid }).eq('workbook_id', id).select('package_id'));
      const iv = must(await sb.from('invite_workbooks').update({ workbook_id: wid }).eq('workbook_id', id).select('invite_id'));
      toast(`New version saved. Old version archived. ${pk.length} package(s) and ${iv.length} invite code(s) moved to the new version.`);
    }
    else toast('Workbook saved');
    go(`#/a/workbook/${wid}`);
  };
  $('#wf').onsubmit = (e) => { e.preventDefault(); save(false); };
  $('#dup') && ($('#dup').onclick = () => save(true));
}

// ---------------- packages ----------------
async function packages() {
  const [rows, orgsById] = await Promise.all([
    sb.from('packages').select('*, package_workbooks(workbooks(title, competencies(count))), competencies(count), enrollments(count), package_organisations(organisation_id)').order('code').then((r) => must(r)),
    orgsMap(),
  ]);
  const list = rows.filter((p) => availableTo(p.package_organisations));
  view(`<div class="row between"><h1>Packages <span class="muted small">· ${esc(await orgName())}</span></h1><a class="btn" href="#/a/package/new">New package</a></div>
    <p class="small muted">A package bundles one or more workbooks. Its practical checklist is built from the skills in those workbooks, plus any whole-package skills you add.</p>
    <div class="card table-wrap"><table><thead><tr><th>Package</th><th>Workbooks</th><th>Practical skills</th><th>Enrolled</th><th>Status</th></tr></thead><tbody>
    ${list.map((p) => {
      const skillCount = p.package_workbooks.reduce((t, x) => t + (x.workbooks?.competencies?.[0]?.count ?? 0), 0) + (p.competencies[0]?.count ?? 0);
      return `<tr class="click" data-id="${p.id}"><td><b>${esc(p.code)}</b> ${esc(p.name)}<div class="small muted">${esc(orgList(p.package_organisations, orgsById))}</div></td>
      <td class="small">${p.package_workbooks.map((x) => esc(x.workbooks?.title)).join('<br>') || '—'}</td>
      <td>${skillCount}</td><td>${p.enrollments[0]?.count ?? 0}</td><td>${p.is_active ? '<span class="badge ok">Active</span>' : '<span class="badge">Inactive</span>'}</td></tr>`;
    }).join('') || '<tr><td colspan="5" class="muted">No packages yet.</td></tr>'}
    </tbody></table></div>`);
  $$('tr.click').forEach((tr) => (tr.onclick = () => go(`#/a/package/${tr.dataset.id}`)));
}

async function packageEditor(id) {
  const isNew = id === 'new';
  const [allWb, orgsL] = await Promise.all([
    sb.from('workbooks').select('id,title,version,is_active, learning_items(count), questions(count), competencies(id, description, position), workbook_organisations(organisation_id)').order('title').then((r) => must(r)),
    sb.from('organisations').select('id,name').order('name').then((r) => must(r)),
  ]);
  let p = { code: '', name: '', description: '', validity_months: '', is_active: true }, chosen = [], comps = [], pOrgs = [];
  if (!isNew) {
    p = must(await sb.from('packages').select('*').eq('id', id).single());
    chosen = must(await sb.from('package_workbooks').select('*').eq('package_id', id).order('position')).map((x) => x.workbook_id);
    comps = must(await sb.from('competencies').select('*').eq('package_id', id).order('position'));
    pOrgs = must(await sb.from('package_organisations').select('organisation_id').eq('package_id', id)).map((x) => x.organisation_id);
  }
  const before = new Set(chosen);
  // chosen workbooks first (in package order), then the rest of the library
  const wbList = [...chosen.map((cid) => allWb.find((w) => w.id === cid)).filter(Boolean),
    ...allWb.filter((w) => !chosen.includes(w.id) && w.is_active)];
  const n = (x) => x?.[0]?.count ?? 0;
  view(`<p><a href="#/a/packages">← Packages</a></p><h1>${isNew ? 'New package' : esc(p.name)}</h1>
    <form id="pf" class="card">
      <div class="inline-fields">
        <div><label>Package plan number</label><input name="code" required value="${esc(p.code)}" placeholder="e.g. HIS-PEG-01"></div>
        <div style="grid-column:span 2"><label>Name</label><input name="name" required value="${esc(p.name)}" placeholder="e.g. Enteral Feeding & Management"></div>
        <div><label>Certificate valid for (months)</label><input name="validity_months" type="number" min="1" value="${esc(p.validity_months)}" placeholder="Blank = no expiry"></div>
      </div>
      <label>Description (shown on report)</label><textarea name="description">${esc(p.description)}</textarea>
      <label class="choice" style="max-width:260px"><input type="checkbox" name="is_active" ${p.is_active ? 'checked' : ''}>Active</label>
      ${orgPicker(orgsL, pOrgs)}
      <h2>Workbooks in this package</h2>
      <p class="small muted">Tick as many as you need. Each brings its learning material, knowledge questions and practical skills. Use ↑ ↓ to set the order learners see them.</p>
      <div id="wbs">${wbList.map((w) => `<div class="choice row between" data-wb="${w.id}" style="flex-wrap:nowrap">
        <label style="margin:0;font-weight:400;display:flex;align-items:center;flex:1"><input type="checkbox" value="${w.id}" ${chosen.includes(w.id) ? 'checked' : ''}>
        <span><b>${esc(w.title)}</b> <span class="small muted">v${esc(w.version)}${w.is_active ? '' : ' · archived'}</span><br>
        <span class="small muted">${n(w.learning_items)} learning items · ${n(w.questions)} questions · ${w.competencies.length} practical skills${w.workbook_organisations.length ? ' · limited orgs' : ''}</span></span></label>
        <span class="nowrap"><button type="button" class="btn small secondary" data-wup aria-label="Move up">↑</button><button type="button" class="btn small secondary" data-wdown aria-label="Move down">↓</button></span></div>`).join('') || '<p class="muted">Create a workbook first.</p>'}</div>
      <h2>Whole-package practical skills <span class="small muted">(optional)</span></h2>
      <p class="small muted">Skills that aren't tied to one workbook, one per line.</p>
      <textarea name="comps" style="min-height:6rem" placeholder="Communicates respectfully with the participant&#10;…">${esc(comps.map((c) => c.description).join('\n'))}</textarea>
      <h2>Practical checklist preview</h2>
      <div id="checklist" class="small"></div>
      <div class="sticky-actions"><button class="btn">Save package</button></div>
    </form>`);
  wireOrgPicker();
  const drawChecklist = () => {
    const sel = $$('#wbs input:checked').map((x) => allWb.find((w) => w.id === x.value));
    const extra = $('[name="comps"]').value.split('\n').map((x) => x.trim()).filter(Boolean);
    const groups = sel.filter((w) => w.competencies.length).map((w) => `<b>${esc(w.title)}</b><ol>${[...w.competencies].sort((a, b) => a.position - b.position).map((c) => `<li>${esc(c.description)}</li>`).join('')}</ol>`);
    if (extra.length) groups.push(`<b>Whole package</b><ol>${extra.map((c) => `<li>${esc(c)}</li>`).join('')}</ol>`);
    $('#checklist').innerHTML = groups.join('') || '<p class="muted">No practical skills yet. Add them in each workbook (Practical skills) or above.</p>';
  };
  drawChecklist();
  $('#wbs').onchange = drawChecklist; $('[name="comps"]').oninput = drawChecklist;
  $$('[data-wup]').forEach((b) => (b.onclick = () => { const r = b.closest('[data-wb]'); r.previousElementSibling && r.parentNode.insertBefore(r, r.previousElementSibling); drawChecklist(); }));
  $$('[data-wdown]').forEach((b) => (b.onclick = () => { const r = b.closest('[data-wb]'); r.nextElementSibling && r.parentNode.insertBefore(r.nextElementSibling, r); drawChecklist(); }));
  $('#pf').onsubmit = async (e) => {
    e.preventDefault(); const d = formData(e.target);
    const sel = $$('#wbs input:checked').map((x) => x.value);
    if (!sel.length && !confirm('This package has no workbooks. Save anyway?')) return;
    const rec = { code: d.code.trim().toUpperCase(), name: d.name.trim(), description: d.description, validity_months: d.validity_months ? +d.validity_months : null, is_active: !!d.is_active };
    const pid = isNew ? must(await sb.from('packages').insert(rec).select('id').single()).id : (must(await sb.from('packages').update(rec).eq('id', id)), id);
    must(await sb.from('package_workbooks').delete().eq('package_id', pid));
    if (sel.length) must(await sb.from('package_workbooks').insert(sel.map((w, i) => ({ package_id: pid, workbook_id: w, position: i + 1 }))));
    await saveSkills(d.comps.split('\n').map((x) => x.trim()).filter(Boolean), comps, { package_id: pid });
    await saveOrgLinks('package_organisations', 'package_id', pid, readOrgPicker());
    const added = sel.filter((w) => !before.has(w));
    if (!isNew && added.length) {
      const enrs = must(await sb.from('enrollments').select('id, learner_id').eq('package_id', pid).in('status', ['workbooks', 'ready_for_practical']));
      if (enrs.length && confirm(`Also assign the ${added.length} new workbook(s) to the ${enrs.length} learner(s) currently in this package?`)) {
        must(await sb.from('assignments').upsert(enrs.flatMap((en) => added.map((w) => ({ enrollment_id: en.id, learner_id: en.learner_id, workbook_id: w }))),
          { onConflict: 'enrollment_id,workbook_id', ignoreDuplicates: true }));
      }
    }
    toast('Package saved'); go(`#/a/package/${pid}`);
  };
}

// ---------------- pack requests (organisation requests, review, approval, class codes) ----------------
const reqBadge = (st) => badge(st === 'submitted' ? 'submitted_req' : st);
async function requestsList() {
  const rows = must(await orgF(sb.from('pack_requests').select('id,title,status,created_at,submitted_at,organisations(name),pack_request_items(count)').neq('status', 'draft').order('submitted_at', { ascending: false }), 'organisation_id'));
  const order = { submitted: 0, under_review: 1, quoted: 2, accepted: 3, approved: 4 };
  rows.sort((a, b) => (order[a.status] - order[b.status]) || (new Date(b.submitted_at) - new Date(a.submitted_at)));
  view(`<h1>Pack requests <span class="muted small">· ${esc(await orgName())}</span></h1>
    ${rows.length ? `<div class="card table-wrap"><table><thead><tr><th>Organisation</th><th>Request</th><th>Status</th><th>Items</th><th>Submitted</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td>${esc(r.organisations?.name)}</td><td><a href="#/a/request/${r.id}">${esc(r.title)}</a></td><td>${reqBadge(r.status)}</td><td>${r.pack_request_items[0]?.count ?? 0}</td><td>${fmtDate(r.submitted_at)}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="card muted">No submitted requests yet.</div>'}`);
}

let quoteEdit = null;
const D = (c) => (Number(c || 0) / 100).toFixed(2);
async function requestDetail(id) {
  const [rq, items, code, quotes, prices] = await Promise.all([
    sb.from('pack_requests').select('*, organisations(name)').eq('id', id).single(),
    sb.from('pack_request_items').select('id, workbook_id, skipped_reason, assignment_id, roster_learners(id, full_name, username, profile_id), workbooks(title)').eq('request_id', id),
    sb.from('class_codes').select('code, expires_at').eq('request_id', id),
    sb.from('quotes').select('*').eq('request_id', id).order('version', { ascending: false }),
    sb.from('workbook_prices').select('workbook_id, price_cents'),
  ]).then((r) => r.map((x) => must(x)));
  const people = new Map();
  items.forEach((i) => { const r = i.roster_learners; if (!people.has(r.id)) people.set(r.id, { ...r, mods: [] }); people.get(r.id).mods.push(i); });
  const locked = rq.status === 'approved';
  const in3 = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
  const cc = code[0];
  const live = quotes.find((q) => q.status !== 'superseded');          // latest quote that still counts
  const expired = live?.status === 'sent' && new Date(live.valid_until) < new Date();
  const building = !locked && rq.status !== 'accepted' && (!live || live.status === 'draft' || live.status === 'declined' || expired || quoteEdit === id);
  const priceOf = Object.fromEntries(prices.map((p) => [p.workbook_id, p.price_cents]));

  const quoteCard = () => {
    if (building) {
      return `<section class="card" id="qcard"><h2 style="margin-top:0">Quote</h2>
        ${live?.status === 'declined' ? `<div class="notice">The organisation declined the last quote${live.decline_note ? `: ${esc(live.decline_note)}` : ''}. Revise and send a new one.</div>` : ''}
        ${expired ? '<div class="notice">The last quote expired. Re-send to start a new 14-day window.</div>' : ''}
        <div class="table-wrap"><table><thead><tr><th>Description</th><th style="width:5rem">Qty</th><th style="width:8rem">Unit price (ex GST)</th><th class="right" style="width:7rem">Line total</th><th style="width:2rem"></th></tr></thead><tbody id="qlines"></tbody></table></div>
        <div class="row" style="margin:.6rem 0"><button class="btn small secondary" id="qadd">Add line</button><button class="btn small secondary" id="qfill">Fill from price list</button><a class="small" href="#/a/prices">Edit price list</a></div>
        <div class="grid" style="margin-top:.5rem">
          <div><label for="qgst">GST %</label><input id="qgst" type="number" min="0" step="0.1" value="${live?.gst_percent ?? QUOTE_DEFAULTS.gst_percent}"></div>
          <div><label for="qdays">Valid for (days)</label><input id="qdays" type="number" min="1" max="90" value="${live?.valid_days ?? QUOTE_DEFAULTS.valid_days}"></div>
        </div>
        <p id="qtot" class="right" style="margin:.6rem 0 0"></p>
        <label for="qpay">Payment terms</label><textarea id="qpay" rows="2">${esc(live?.payment_terms ?? QUOTE_DEFAULTS.payment_terms)}</textarea>
        <label for="qterms">Terms the organisation agrees to</label><textarea id="qterms" rows="3">${esc(live?.terms ?? QUOTE_DEFAULTS.terms)}</textarea>
        <div class="row" style="margin-top:.9rem"><button class="btn secondary" id="qsave">Save draft</button><button class="btn" id="qsend">Send quote to organisation</button></div>
        <p class="small muted">A sent quote locks the request until the organisation accepts or declines, and expires after the valid period. Prices on a sent quote never change if the price list does.</p></section>`;
    }
    if (!live) return '';
    const lines = live.lines.map((l) => `<tr><td>${esc(l.description)}</td><td>${l.qty}</td><td>${money(l.unit_cents)}</td><td class="right">${money(Math.round(l.qty * l.unit_cents))}</td></tr>`).join('');
    const acc = live.status === 'accepted';
    return `<section class="card"><div class="row between"><h2 style="margin:0">Quote v${live.version}</h2>${badge(acc ? 'accepted' : 'quoted')}</div>
      <div class="table-wrap"><table><thead><tr><th>Description</th><th>Qty</th><th>Unit</th><th class="right">Total</th></tr></thead><tbody>${lines}</tbody></table></div>
      <p class="right" style="margin:.5rem 0 0">Subtotal ${money(live.subtotal_cents)} · GST ${money(live.gst_cents)} · <b>Total ${money(live.total_cents)}</b></p>
      <p class="small muted">${acc ? `Accepted by <b>${esc(live.accepted_name)}</b> on ${fmtDate(live.accepted_at)}` : `Sent ${fmtDate(live.sent_at)}, valid until ${fmtDate(live.valid_until)}. Waiting for the organisation.`}</p>
      ${acc ? `<h3>Invoice and payment</h3><div class="inline-fields"><div><label for="inv">Invoice number</label><input id="inv" value="${esc(live.invoice_number)}"></div>
        <div><label for="invd">Invoice date</label><input id="invd" type="date" value="${live.invoice_date || ''}"></div>
        <div><label for="paid">Paid on</label><input id="paid" type="date" value="${live.paid_at || ''}"></div></div>
        <button class="btn small secondary" id="paysave" style="margin-top:.6rem">Save invoice details</button>`
        : !locked ? '<button class="btn small secondary" id="qrevise">Revise and re-send</button>' : ''}</section>`;
  };

  view(`<p><a href="#/a/requests">← Pack requests</a></p>
    <div class="row between"><h1>${esc(rq.title)}</h1>${reqBadge(rq.status)}</div>
    <p class="muted">${esc(rq.organisations?.name)} · submitted ${fmtDate(rq.submitted_at)}${rq.preferred_dates ? ` · preferred dates: ${esc(rq.preferred_dates)}` : ''}</p>
    ${rq.notes ? `<div class="card"><b>Organisation notes</b><p style="margin:.3rem 0 0">${esc(rq.notes)}</p></div>` : ''}
    <section class="card"><h2 style="margin-top:0">People and modules</h2>
      ${[...people.values()].map((p) => `<div style="margin-bottom:.8rem"><b>${esc(p.full_name)}</b> <span class="small muted">${esc(p.username)} · ${p.profile_id ? 'activated' : 'not activated'}</span>
        ${p.profile_id ? `<button class="btn small secondary" data-reset="${p.id}" data-name="${esc(p.full_name)}" style="margin-left:.5rem">Reset password</button>` : ''}
        <ul style="margin:.2rem 0">${p.mods.map((m) => `<li>${esc(m.workbooks?.title)} ${m.skipped_reason ? `<span class="badge">${esc(m.skipped_reason)}</span>` : m.assignment_id ? '<span class="badge ok">Assigned</span>' : ''}</li>`).join('')}</ul></div>`).join('') || '<p class="muted">No items.</p>'}
    </section>
    ${quoteCard()}
    <section class="card"><h2 style="margin-top:0">Review and approval</h2>
      <label>Note to the organisation (anything to change, dates)</label><textarea id="note" rows="3">${esc(rq.admin_note)}</textarea>
      ${locked ? `<div class="notice info">Class code: <b style="letter-spacing:.1em">${esc(cc?.code || '…')}</b> · valid until ${fmtDate(cc?.expires_at)}${rq.quote_waived ? ' · quote waived' : ''}</div>
        <div class="row"><label class="small" style="margin:0">New expiry</label><input type="date" id="exp" value="${cc ? new Date(cc.expires_at).toISOString().slice(0, 10) : in3}">
        <button class="btn small secondary" id="extend">Update expiry</button><button class="btn small danger" id="newcode">Issue a new code</button></div>`
      : `${['quoted', 'accepted'].includes(rq.status) ? '' : '<div class="row" style="margin-top:.8rem"><button class="btn secondary" id="review">Mark under review</button><button class="btn secondary" id="back">Send back to draft</button></div>'}
        <hr style="border:0;border-top:1px solid var(--line)">
        ${rq.status === 'accepted' ? '' : `<label class="choice" style="max-width:34rem"><input type="checkbox" id="waive"> No quote needed (waive, e.g. demo or no-charge training)</label>`}
        <div class="row"><label class="small" style="margin:0">Class code valid until</label><input type="date" id="exp" value="${in3}"><button class="btn ok" id="approve" ${rq.status === 'accepted' ? '' : 'disabled'}>Approve and create class code</button></div>
        <p class="small muted">${rq.status === 'accepted' ? 'The quote is accepted. Approval creates the enrolments for anyone already activated; new learners get theirs when they activate with the code.' : 'The class code is only issued after the organisation accepts a quote, or you waive it.'}</p>`}
    </section>`);

  const note = () => $('#note').value.trim() || null;
  const expiry = () => new Date(`${$('#exp').value}T23:59:59+08:00`).toISOString();
  const status = (s, msg) => async () => { must(await sb.rpc('admin_review_request', { p_request: id, p_status: s, p_note: note() })); toast(msg); requestDetail(id); };

  // ----- quote builder -----
  if (building) {
    let L = (live?.lines || []).map((l) => ({ ...l }));
    const calc = () => {
      const sub = L.reduce((s, l) => s + Math.round((Number(l.qty) || 0) * (Number(l.unit_cents) || 0)), 0);
      const gst = Math.round(sub * (Number($('#qgst').value) || 0) / 100);
      $('#qtot').innerHTML = `Subtotal ${money(sub)} · GST ${money(gst)} · <b>Total ${money(sub + gst)}</b>`;
    };
    const draw = () => {
      $('#qlines').innerHTML = L.map((l, i) => `<tr><td><input data-f="description" data-i="${i}" value="${esc(l.description)}" aria-label="Description"></td>
        <td><input data-f="qty" data-i="${i}" type="number" min="0" step="1" value="${l.qty}" aria-label="Quantity"></td>
        <td><input data-f="unit" data-i="${i}" type="number" min="0" step="0.01" value="${D(l.unit_cents)}" aria-label="Unit price"></td>
        <td class="right" id="lt${i}">${money(Math.round(l.qty * l.unit_cents))}</td><td><button class="linkbtn" data-del="${i}" aria-label="Remove line">&times;</button></td></tr>`).join('') || '<tr><td colspan="5" class="muted">No lines yet.</td></tr>';
      $$('#qlines input').forEach((inp) => (inp.oninput = () => {
        const l = L[inp.dataset.i];
        if (inp.dataset.f === 'description') l.description = inp.value;
        else if (inp.dataset.f === 'qty') l.qty = Number(inp.value);
        else l.unit_cents = Math.round((Number(inp.value) || 0) * 100);
        $(`#lt${inp.dataset.i}`).textContent = money(Math.round((l.qty || 0) * (l.unit_cents || 0))); calc();
      }));
      $$('[data-del]').forEach((b) => (b.onclick = () => { L.splice(Number(b.dataset.del), 1); draw(); }));
      calc();
    };
    $('#qgst').oninput = calc;
    $('#qadd').onclick = () => { L.push({ description: '', qty: 1, unit_cents: 0 }); draw(); };
    $('#qfill').onclick = () => {
      const by = new Map();
      items.filter((i) => !i.skipped_reason).forEach((i) => { const o = by.get(i.workbook_id) || { t: i.workbooks?.title, n: 0 }; o.n++; by.set(i.workbook_id, o); });
      const missing = [];
      [...by].forEach(([wid, o]) => {
        if (priceOf[wid] == null) missing.push(o.t);
        const d = `${o.t} (per person)`; const ex = L.find((l) => l.description === d);
        if (ex) { ex.qty = o.n; ex.unit_cents = priceOf[wid] ?? ex.unit_cents; } else L.push({ description: d, qty: o.n, unit_cents: priceOf[wid] ?? 0 });
      });
      draw(); if (missing.length) toast(`No price set for: ${missing.join(', ')}`, true);
    };
    const save = async (send) => {
      if (!L.length) return toast('Add at least one line', true);
      must(await sb.rpc('admin_save_quote', { p_request: id, p_lines: L.map((l) => ({ description: String(l.description || '').trim(), qty: Number(l.qty), unit_cents: Number(l.unit_cents) })),
        p_gst: Number($('#qgst').value) || 0, p_payment_terms: $('#qpay').value, p_terms: $('#qterms').value, p_valid_days: Number($('#qdays').value) || 14, p_send: send }), 'Could not save quote');
      quoteEdit = null; toast(send ? 'Quote sent to the organisation' : 'Draft saved'); requestDetail(id);
    };
    $('#qsave').onclick = () => save(false);
    $('#qsend').onclick = () => { if (confirm('Send this quote to the organisation? The request will be locked until they respond.')) save(true); };
    draw();
  }
  $('#qrevise') && ($('#qrevise').onclick = () => { quoteEdit = id; requestDetail(id); });
  $('#paysave') && ($('#paysave').onclick = async () => {
    must(await sb.rpc('admin_record_payment', { p_quote: live.id, p_invoice: $('#inv').value, p_invoice_date: $('#invd').value || null, p_paid: $('#paid').value || null }), 'Could not save');
    toast('Invoice details saved'); requestDetail(id);
  });

  if (!locked) {
    $('#review') && ($('#review').onclick = status('under_review', 'Marked under review'));
    $('#back') && ($('#back').onclick = status('draft', 'Sent back to the organisation'));
    $('#waive') && ($('#waive').onchange = (e) => { $('#approve').disabled = !e.target.checked; });
    $('#approve').onclick = async () => {
      const c = must(await sb.rpc('approve_pack_request', { p_request: id, p_expires: expiry(), p_note: note(), p_waive: !!$('#waive')?.checked }), 'Could not approve');
      toast(`Approved. Class code ${c}`); requestDetail(id);
    };
  } else {
    $('#extend').onclick = async () => { must(await sb.rpc('set_class_code', { p_request: id, p_expires: expiry(), p_new: false })); toast('Expiry updated'); requestDetail(id); };
    $('#newcode').onclick = async () => { if (!confirm('The old code will stop working. Issue a new one?')) return; must(await sb.rpc('set_class_code', { p_request: id, p_expires: expiry(), p_new: true })); toast('New code issued'); requestDetail(id); };
  }
  $$('[data-reset]').forEach((b) => (b.onclick = async () => {
    const pw = prompt(`New password for ${b.dataset.name} (at least 8 characters).`);
    if (!pw) return;
    must(await sb.rpc('reset_learner_password', { p_roster: b.dataset.reset, p_password: pw }), 'Could not reset'); toast('Password reset');
  }));
}

// ---------------- price list ----------------
async function priceList() {
  const [wbs, prices] = await Promise.all([
    sb.from('workbooks').select('id,title,version').order('title'),
    sb.from('workbook_prices').select('workbook_id, price_cents'),
  ]).then((r) => r.map((x) => must(x)));
  const pm = Object.fromEntries(prices.map((p) => [p.workbook_id, p.price_cents]));
  view(`<p><a href="#/a/requests">← Pack requests</a></p><h1>Price list</h1>
    <p class="muted">Price per person per workbook, excluding GST. Used by "Fill from price list" when you build a quote. Changing a price never alters a quote already sent.</p>
    <div class="card table-wrap"><table><thead><tr><th>Workbook</th><th style="width:11rem">Price (ex GST)</th></tr></thead><tbody>
    ${wbs.map((w) => `<tr><td>${esc(w.title)} <span class="small muted">v${esc(w.version)}</span></td><td><input type="number" min="0" step="0.01" data-w="${w.id}" value="${pm[w.id] != null ? D(pm[w.id]) : ''}" placeholder="Not set"></td></tr>`).join('')}
    </tbody></table></div><button class="btn" id="psave">Save prices</button>`);
  $('#psave').onclick = async () => {
    const rows = $$('[data-w]').filter((i) => i.value !== '').map((i) => ({ workbook_id: i.dataset.w, price_cents: Math.round(Number(i.value) * 100), updated_at: new Date().toISOString() }));
    const clear = $$('[data-w]').filter((i) => i.value === '').map((i) => i.dataset.w);
    if (rows.length) must(await sb.from('workbook_prices').upsert(rows), 'Could not save prices');
    if (clear.length) must(await sb.from('workbook_prices').delete().in('workbook_id', clear));
    toast('Prices saved');
  };
}

// ---------------- accounts: approve organisation sign-ups ----------------
async function accounts() {
  const [pend, orgsL, orgUsers] = await Promise.all([
    sb.from('profiles').select('id,full_name,email,phone,requested_org,created_at').eq('role', 'pending').order('created_at'),
    sb.from('organisations').select('id,name').order('name'),
    sb.from('profiles').select('id,full_name,email,organisations(name)').eq('role', 'organisation').order('full_name'),
  ]).then((r) => r.map((x) => must(x)));
  const guess = (n) => orgsL.find((o) => o.name.toLowerCase() === String(n || '').trim().toLowerCase())?.id;
  view(`<h1>Accounts</h1>
    <section class="card"><h2 style="margin-top:0">Waiting for approval</h2>
      ${pend.length ? pend.map((p) => `<form class="inline-fields" data-pend="${p.id}">
        <div><b>${esc(p.full_name)}</b><div class="small muted">${esc(p.email)}${p.phone ? ' · ' + esc(p.phone) : ''}</div><div class="small">Asked for: ${esc(p.requested_org || '—')}</div></div>
        <div><label>Organisation</label><select name="org" required><option value="">Choose…</option>${opt(orgsL, guess(p.requested_org))}</select></div>
        <div style="align-self:end"><button class="btn small">Approve as organisation</button></div></form>`).join('<hr style="border:0;border-top:1px solid var(--line)">')
      : '<p class="muted">Nobody waiting. New organisation contacts appear here after they request an account.</p>'}
      ${orgsL.length ? '' : '<div class="notice">Add an <a href="#/a/orgs">organisation</a> first.</div>'}
    </section>
    <section class="card"><h2 style="margin-top:0">Organisation accounts</h2>
      ${orgUsers.length ? `<ul>${orgUsers.map((u) => `<li>${esc(u.full_name)} <span class="small muted">${esc(u.email)} · ${esc(u.organisations?.name)}</span></li>`).join('')}</ul>` : '<p class="muted">None yet.</p>'}</section>`);
  $$('[data-pend]').forEach((f) => (f.onsubmit = async (e) => {
    e.preventDefault();
    must(await sb.from('profiles').update({ role: 'organisation', organisation_id: formData(f).org }).eq('id', f.dataset.pend));
    toast('Approved'); accounts();
  }));
}

// ---------------- organisations ----------------
async function orgs() {
  const rows = must(await sb.from('organisations').select('*, profiles(count)').order('name'));
  const form = (o = {}) => `<form class="inline-fields" data-org="${o.id || ''}">
    <div><label>Name</label><input name="name" required value="${esc(o.name)}"></div>
    <div><label>Contact name</label><input name="contact_name" value="${esc(o.contact_name)}"></div>
    <div><label>Contact email</label><input name="contact_email" type="email" value="${esc(o.contact_email)}"></div>
    <div><label>Phone</label><input name="phone" value="${esc(o.phone)}"></div>
    <div style="align-self:end"><button class="btn small">${o.id ? 'Save' : 'Add organisation'}</button></div></form>`;
  view(`<h1>Organisations</h1>
    <section class="card"><h2 style="margin-top:0">Add organisation</h2>${form()}</section>
    ${rows.map((o) => `<section class="card"><div class="row between"><b>${esc(o.name)}</b><span class="small muted">${o.profiles[0]?.count ?? 0} people</span></div>${form(o)}</section>`).join('')}`);
  $$('[data-org]').forEach((f) => (f.onsubmit = async (e) => {
    e.preventDefault(); const d = formData(f);
    if (f.dataset.org) must(await sb.from('organisations').update(d).eq('id', f.dataset.org));
    else must(await sb.from('organisations').insert(d));
    toast('Saved'); orgs();
  }));
}

// ---------------- invites ----------------
async function invites() {
  const [orgsL, pkgs, wbs, rows] = await Promise.all([
    sb.from('organisations').select('id,name').order('name'),
    sb.from('packages').select('id,name,code, package_organisations(organisation_id), package_workbooks(workbook_id)').eq('is_active', true).order('code'),
    sb.from('workbooks').select('id,title,version, workbook_organisations(organisation_id), questions(count), competencies(count)').eq('is_active', true).order('title'),
    orgF(sb.from('invites').select('*, organisations(name), packages(name, code), invite_workbooks(workbooks(title))').order('created_at', { ascending: false }), 'organisation_id'),
  ]).then((r) => r.map((x) => must(x)));
  const joinUrl = location.origin + location.pathname + '#/join';
  const genCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');
  const training = (i) => i.title || i.packages?.name || 'training';
  const needsPlan = (i) => !i.packages && !i.invite_workbooks.length;
  const message = (i) => `Hi, you've been enrolled in ${training(i)} with ${BRAND.name}.\n\n1. Go to ${joinUrl}\n2. Enter invite code: ${i.code}${needsPlan(i) ? '\n3. Enter the package plan number you were given' : ''}\n${needsPlan(i) ? '4' : '3'}. Fill in your details to create your login.\n\nAny questions, contact ${BRAND.trainerName} at ${BRAND.contactEmail}.`;
  view(`<h1>Invite codes <span class="muted small">· ${esc(await orgName())}</span></h1>
    ${orgsL.length ? '' : '<div class="notice">Add an <a href="#/a/orgs">organisation</a> first.</div>'}
    <section class="card"><h2 style="margin-top:0">Create a code</h2>
      <p class="small muted">Choose a package, tick individual workbooks, or both. Anyone who signs up with the code is linked to the organisation and gets exactly this training. One code can be shared with a whole group.</p>
      <form id="inv">
        <div class="inline-fields">
          <div><label>Organisation</label><select name="organisation_id" id="invorg" required>${opt(orgsL, state.org)}</select></div>
          <div><label>Package <span class="small muted">(optional)</span></label><select name="package_id" id="invpkg"></select></div>
          <div style="grid-column:span 2"><label>Training name <span class="small muted">(shown to learners and on certificates)</span></label><input name="title" id="invtitle" placeholder="e.g. Enteral Feeding – Team B"></div>
        </div>
        <label>Workbooks <span class="small muted">(tick any; added on top of the package, if one is chosen)</span></label>
        <div id="invwbs"></div>
        <div class="inline-fields" style="margin-top:.5rem">
          <div><label>Max uses</label><input name="max_uses" type="number" min="1" placeholder="Unlimited"></div>
          <div><label>Expires</label><input name="expires_at" type="date"></div>
          <div><label>Note (only you see it)</label><input name="note" placeholder="e.g. March cohort"></div>
          <div style="align-self:end"><button class="btn">Create code</button></div>
        </div>
      </form></section>
    <div class="card table-wrap"><table><thead><tr><th>Code</th><th>Organisation</th><th>Training</th><th>Used</th><th>Expires</th><th></th></tr></thead><tbody>
    ${rows.map((i) => `<tr><td><b style="font-family:monospace;font-size:1.05rem">${esc(i.code)}</b>${i.note ? `<div class="small muted">${esc(i.note)}</div>` : ''}</td>
      <td>${esc(i.organisations?.name)}</td>
      <td>${i.title || i.packages ? `<b>${esc(training(i))}</b>` : ''}${i.packages ? `<div class="small">Package ${esc(i.packages.code)}</div>` : ''}
        ${i.invite_workbooks.length ? `<div class="small muted">${i.packages ? '+ ' : ''}${i.invite_workbooks.map((x) => esc(x.workbooks?.title)).join(', ')}</div>` : ''}
        ${needsPlan(i) ? '<span class="muted small">Learner enters plan number</span>' : ''}</td>
      <td>${i.uses}${i.max_uses ? ' / ' + i.max_uses : ''}</td><td>${fmtDate(i.expires_at)}</td>
      <td class="right nowrap">${i.is_active ? `<button class="btn small" data-copy="${i.id}">Copy message</button> <button class="btn small danger" data-off="${i.id}">Deactivate</button>` : '<span class="badge">Inactive</span>'}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No codes yet.</td></tr>'}
    </tbody></table></div>`);

  // Only offer packages / workbooks available to the chosen organisation
  const drawChoices = () => {
    const org = $('#invorg').value;
    const prevPkg = $('#invpkg').value; const prevWb = new Set($$('#invwbs input:checked').map((x) => x.value));
    const pk = pkgs.filter((k) => availableTo(k.package_organisations, org));
    $('#invpkg').innerHTML = `<option value="">No package</option>${opt(pk, prevPkg, (k) => `${k.code} – ${k.name}`)}`;
    const inPkg = new Set(pkgs.find((k) => k.id === $('#invpkg').value)?.package_workbooks.map((x) => x.workbook_id) || []);
    const wl = wbs.filter((w) => availableTo(w.workbook_organisations, org));
    $('#invwbs').innerHTML = wl.map((w) => `<label class="choice"><input type="checkbox" value="${w.id}" ${prevWb.has(w.id) && !inPkg.has(w.id) ? 'checked' : ''} ${inPkg.has(w.id) ? 'disabled checked' : ''}>
      <span>${esc(w.title)} <span class="small muted">v${esc(w.version)} · ${w.questions[0]?.count ?? 0} questions · ${w.competencies[0]?.count ?? 0} practical skills${inPkg.has(w.id) ? ' · in package' : ''}</span></span></label>`).join('')
      || '<p class="muted small">No workbooks available to this organisation.</p>';
  };
  drawChoices();
  $('#invorg').onchange = drawChoices; $('#invpkg').onchange = drawChoices;

  $('#inv').onsubmit = async (e) => {
    e.preventDefault(); const d = formData(e.target);
    const picked = $$('#invwbs input:checked:not(:disabled)').map((x) => x.value);
    if (!d.package_id && picked.length && !d.title.trim()) return toast('Give this training a name. It appears on the learner\'s dashboard and certificate.', true);
    if (!d.package_id && !picked.length && !confirm('No package or workbooks chosen. Learners will have to type a package plan number when they sign up. Continue?')) return;
    const rec = { code: genCode(), organisation_id: d.organisation_id, package_id: d.package_id || null, title: d.title.trim() || null,
      max_uses: d.max_uses ? +d.max_uses : null, expires_at: d.expires_at ? new Date(d.expires_at + 'T23:59:59').toISOString() : null, note: d.note || null };
    const inv = must(await sb.from('invites').insert(rec).select('id').single());
    if (picked.length) must(await sb.from('invite_workbooks').insert(picked.map((w, i) => ({ invite_id: inv.id, workbook_id: w, position: i + 1 }))));
    toast(`Code ${rec.code} created`); invites();
  };
  $$('[data-copy]').forEach((b) => (b.onclick = async () => {
    const text = message(rows.find((r) => r.id === b.dataset.copy));
    try { await navigator.clipboard.writeText(text); toast('Invite message copied – paste it into an email or SMS'); }
    catch { prompt('Copy this message:', text); }
  }));
  $$('[data-off]').forEach((b) => (b.onclick = async () => {
    if (!confirm('Deactivate this code? People who already signed up are not affected.')) return;
    must(await sb.from('invites').update({ is_active: false }).eq('id', b.dataset.off)); invites();
  }));
}

// ---------------- practical assessment ----------------
async function practical(enrId, pid) {
  const e = must(await sb.from('enrollments').select('*, profiles(full_name, id), packages(name)').eq('id', enrId).single());
  const comps = must(await sb.rpc('enrollment_competencies', { p_enr: enrId }));
  let p = { assessed_on: new Date().toISOString().slice(0, 10), location: '', notes: '', outcome: 'draft', assessor_name: BRAND.trainerName }, res = {};
  if (pid !== 'new') {
    p = must(await sb.from('practical_assessments').select('*').eq('id', pid).single());
    res = Object.fromEntries(must(await sb.from('practical_results').select('*').eq('practical_id', pid)).map((r) => [r.competency_id, r]));
  }
  const signed = !!p.signed_off_at;
  const R = [['competent', '✓ Competent', 'ok'], ['not_yet', '✗ Not yet', 'bad'], ['not_applicable', 'N/A', ''], ['not_assessed', 'Not seen', '']];
  view(`<p><a href="#/a/learner/${e.profiles.id}">← ${esc(e.profiles.full_name)}</a></p>
    <h1>Practical assessment</h1><p class="muted">${esc(e.profiles.full_name)} · ${esc(tName(e))}</p>
    ${e.status === 'workbooks' ? '<div class="notice">Heads up: this learner still has workbooks outstanding.</div>' : ''}
    ${signed ? `<div class="notice info">Signed off ${fmtDate(p.signed_off_at)}. You can still correct it.</div>` : ''}
    <form id="pf" class="card">
      <div class="inline-fields">
        <div><label>Date</label><input type="date" name="assessed_on" required value="${esc(p.assessed_on)}"></div>
        <div><label>Location</label><input name="location" value="${esc(p.location)}" placeholder="e.g. participant's home, simulation lab"></div>
        <div><label>Assessor</label><input name="assessor_name" value="${esc(p.assessor_name)}"></div>
      </div>
      <h2>Observation checklist</h2>
      <p class="small muted">Tap a result for each skill you observe. Tick "Add notes" only where you want to record something.</p>
      ${comps.length ? comps.map((c, i) => `${i === 0 || comps[i - 1].group_title !== c.group_title ? `<h3>${esc(c.group_title)}</h3>` : ''}<div class="obs">
        <div class="obs-q">${i + 1}. ${esc(c.description)}${c.critical ? ' <span class="badge bad">Critical</span>' : ''}</div>
        ${c.criteria ? `<div class="small muted"><b>Look for:</b> ${esc(c.criteria)}</div>` : ''}
        ${c.assessor_prompt ? `<div class="small muted"><b>Prompt:</b> ${esc(c.assessor_prompt)}</div>` : ''}
        ${c.method || c.conditions || c.resources || c.evidence || c.min_observations > 1 ? `<details class="small muted"><summary>Assessment detail</summary>${[['Method', c.method], ['Conditions', c.conditions], ['Resources', c.resources], ['Evidence', c.evidence], ['Observations needed', c.min_observations > 1 ? c.min_observations : '']].filter(([, v]) => v).map(([k, v]) => `<div><b>${k}:</b> ${esc(v)}</div>`).join('')}</details>` : ''}
        <div class="seg" role="radiogroup" aria-label="Result for item ${i + 1}">${R.map(([v, l, cls]) => `<label class="${cls}"><input type="radio" name="r_${c.id}" value="${v}" ${(res[c.id]?.result || 'not_assessed') === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>
        <label class="notetoggle"><input type="checkbox" data-note="${c.id}" ${res[c.id]?.notes ? 'checked' : ''}>Add notes</label>
        <textarea name="n_${c.id}" class="obsnote" placeholder="What did you observe?" ${res[c.id]?.notes ? '' : 'hidden'}>${esc(res[c.id]?.notes)}</textarea></div>`).join('')
        : `<div class="notice">No practical skills apply yet. Add them under <b>Practical skills</b> in each workbook${e.package_id ? `, or to the <a href="#/a/package/${e.package_id}">package</a>` : ''}.</div>`}
      <label for="notes">Assessor notes</label><textarea id="notes" name="notes">${esc(p.notes)}</textarea>
      <div class="sticky-actions row"><button class="btn secondary" value="draft">Save draft</button>
        <button class="btn ok" value="competent">Sign off: Competent</button>
        <button class="btn danger" value="not_yet_competent">Sign off: Not yet competent</button></div>
    </form>`);
  $$('[data-note]').forEach((cb) => (cb.onchange = () => {
    const box = $(`[name="n_${cb.dataset.note}"]`); box.hidden = !cb.checked; if (cb.checked) box.focus();
  }));
  $('#pf').onsubmit = async (ev) => {
    ev.preventDefault(); const outcome = ev.submitter?.value || 'draft'; const d = formData(ev.target);
    // notes only count where "Add notes" is ticked
    comps.forEach((c) => { if (!$(`[data-note="${c.id}"]`).checked) d[`n_${c.id}`] = ''; });
    if (outcome === 'competent') {
      // pass rules are enforced per workbook: critical items must be Competent, then the workbook's pass rule applies
      const fails = [];
      const groups = {}; comps.forEach((c) => (groups[c.group_title] ||= []).push(c));
      for (const [gname, items] of Object.entries(groups)) {
        const counted = items.filter((c) => d[`r_${c.id}`] !== 'not_applicable');
        const ok = counted.filter((c) => d[`r_${c.id}`] === 'competent');
        const crit = counted.filter((c) => c.critical && d[`r_${c.id}`] !== 'competent');
        if (crit.length) fails.push(`${gname}: ${crit.length} critical item(s) not Competent (${crit.map((c) => c.description).join('; ')})`);
        const rule = items[0].pass_rule, pct = items[0].pass_percent;
        if (rule === 'All critical items plus pass %') { const got = counted.length ? Math.round(100 * ok.length / counted.length) : 100; if (got < (pct || 100)) fails.push(`${gname}: ${got}% competent, pass mark is ${pct}%`); }
        else if (counted.length - ok.length > crit.length) fails.push(`${gname}: ${counted.length - ok.length} item(s) not marked Competent (rule: all items competent)`);
      }
      if (fails.length) return toast(`Can't sign off as Competent. ${fails.join(' · ')}. Mark them Competent, or sign off as Not yet competent.`, true);
    }
    const rec = { enrollment_id: enrId, assessed_on: d.assessed_on, location: d.location, assessor_name: d.assessor_name, notes: d.notes, outcome,
      signed_off_at: outcome === 'draft' ? null : (p.signed_off_at || new Date().toISOString()) };
    const id = pid === 'new' ? must(await sb.from('practical_assessments').insert(rec).select('id').single()).id
      : (must(await sb.from('practical_assessments').update(rec).eq('id', pid)), pid);
    if (comps.length) must(await sb.from('practical_results').upsert(comps.map((c) => ({ practical_id: id, competency_id: c.id, result: d[`r_${c.id}`], notes: d[`n_${c.id}`] || null }))));
    toast(outcome === 'draft' ? 'Draft saved' : 'Practical signed off');
    go(outcome === 'draft' ? `#/a/practical/${enrId}/${id}` : `#/a/learner/${e.profiles.id}`);
  };
}

// ---------------- feedback ----------------
async function feedback() {
  const rows = must(await orgF(sb.from('feedback')
    .select('*, profiles!inner(full_name, organisation_id, organisations(name)), assignments(workbooks(title)), practical_assessments(assessed_on)')
    .order('created_at', { ascending: false }), 'profiles.organisation_id'));
  const avg = (k) => rows.length ? (rows.reduce((s, r) => s + (r[k] || 0), 0) / rows.filter((r) => r[k]).length || 0).toFixed(1) : '—';
  view(`<h1>Feedback <span class="muted small">· ${esc(await orgName())}</span></h1>
    <div class="grid">
      <div class="card"><div class="stat">${rows.length}</div>Responses</div>
      <div class="card"><div class="stat">${avg('rating_overall')}</div>Overall (out of 5)</div>
      <div class="card"><div class="stat">${avg('rating_content')}</div>Content</div>
      <div class="card"><div class="stat">${avg('rating_trainer')}</div>Trainer</div>
      <div class="card"><div class="stat">${avg('confidence')}</div>Learner confidence</div>
    </div>
    <div class="card table-wrap"><table><thead><tr><th>Date</th><th>Learner</th><th>About</th><th>Ratings O/C/T/Conf</th><th>Comments</th></tr></thead><tbody>
    ${rows.map((f) => `<tr><td class="nowrap">${fmtDate(f.created_at)}</td><td>${esc(f.profiles.full_name)}<div class="small muted">${esc(f.profiles.organisations?.name || '')}</div></td>
      <td>${f.assignments ? esc(f.assignments.workbooks.title) : 'Practical ' + fmtDate(f.practical_assessments?.assessed_on)}</td>
      <td class="nowrap">${[f.rating_overall, f.rating_content, f.rating_trainer, f.confidence].map((x) => x ?? '–').join(' / ')}</td>
      <td>${f.liked ? `<div><b>Good:</b> ${esc(f.liked)}</div>` : ''}${f.improve ? `<div><b>Improve:</b> ${esc(f.improve)}</div>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No feedback yet.</td></tr>'}
    </tbody></table></div>`);
}
