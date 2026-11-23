import { sb, state, BRAND, esc, fmtDate, view, must } from './app.js';

function pageSize(landscape) {
  let s = document.getElementById('pagesize');
  if (!s) { s = document.createElement('style'); s.id = 'pagesize'; document.head.appendChild(s); }
  s.textContent = landscape ? '@page { size: A4 landscape; margin: 8mm; }' : '@page { size: A4 portrait; margin: 14mm; }';
  window.addEventListener('hashchange', () => (s.textContent = ''), { once: true });
}

const toolbar = (back) => `<div class="row no-print" style="margin-bottom:1rem">
  <a class="btn secondary" href="${back}">← Back</a>
  <button class="btn" onclick="window.print()">Print / Save as PDF</button>
  <span class="small muted">In the print dialog choose "Save as PDF" to email it.</span></div>`;

const logo = () => (BRAND.logoUrl ? `<img src="${esc(BRAND.logoUrl)}" alt="">` : '');
const RES = { competent: 'Competent', not_yet: 'Not yet competent', not_applicable: 'N/A', not_assessed: 'Not assessed' };

async function load(enrId) {
  const e = must(await sb.from('enrollments')
    .select('*, packages(*), organisations(name, contact_name), profiles(id, full_name, dob, email)').eq('id', enrId).single());
  const [asg, pracs, comps] = await Promise.all([
    sb.from('assignments').select('*, workbooks(title, version)').eq('enrollment_id', enrId),
    sb.from('practical_assessments').select('*, practical_results(*)').eq('enrollment_id', enrId).neq('outcome', 'draft').order('assessed_on'),
    sb.from('competencies').select('*').eq('package_id', e.package_id).order('position'),
  ]).then((r) => r.map((x) => must(x)));
  return { e, asg, pracs, comps };
}

export async function route(h) {
  const m = h.match(/^#\/doc\/(report|cert)\/([\w-]+)$/);
  if (!m) return view('<div class="card">Not found</div>');
  const back = state.profile.role === 'admin' ? null : '#/';
  const { e, asg, pracs, comps } = await load(m[2]);
  const backLink = back || `#/a/learner/${e.profiles.id}`;
  return m[1] === 'cert' ? certificate(e, backLink) : report(e, asg, pracs, comps, backLink);
}

function report(e, asg, pracs, comps, back) {
  pageSize(false);
  const last = pracs.at(-1);
  const resMap = Object.fromEntries((last?.practical_results || []).map((r) => [r.competency_id, r]));
  view(`${toolbar(back)}
  <article class="doc">
    <header><div><div class="small muted">${esc(BRAND.name)}</div><h1 style="margin:.2rem 0 0">Post-Training Report</h1>
      <div class="muted">${esc(BRAND.tagline)}</div></div>${logo()}</header>

    <h2>Participant</h2>
    <div class="kv">
      <div>Name</div><div><b>${esc(e.profiles.full_name)}</b></div>
      ${e.profiles.dob ? `<div>Date of birth</div><div>${fmtDate(e.profiles.dob)}</div>` : ''}
      <div>Organisation</div><div>${esc(e.organisations?.name || '—')}</div>
      <div>Training package</div><div>${esc(e.packages.name)} (${esc(e.packages.code)})</div>
      <div>Enrolled</div><div>${fmtDate(e.started_at)}</div>
      <div>Status</div><div>${e.status === 'completed' ? '<b>Completed – competent</b>' : esc(e.status.replace(/_/g, ' '))}</div>
      ${e.certificate_number ? `<div>Certificate no.</div><div>${esc(e.certificate_number)}</div>
      <div>Completed</div><div>${fmtDate(e.completed_at)}</div>` : ''}
      ${e.expires_at ? `<div>Refresher due</div><div>${fmtDate(e.expires_at)}</div>` : ''}
    </div>
    ${e.packages.description ? `<p>${esc(e.packages.description)}</p>` : ''}

    <h2>Theory – workbooks</h2>
    <table><thead><tr><th>Workbook</th><th>Version</th><th>Attempts</th><th>Score</th><th>Result</th><th>Date</th></tr></thead><tbody>
      ${asg.map((a) => `<tr><td>${esc(a.workbooks.title)}${a.learning_done_at ? `<div class="small muted">Learning material completed ${fmtDate(a.learning_done_at)}</div>` : ''}</td><td>${esc(a.workbooks.version)}</td><td>${a.attempt}</td>
        <td>${a.score != null ? a.score + '%' : '—'}</td><td>${a.status === 'competent' ? 'Competent' : esc(a.status.replace(/_/g, ' '))}</td>
        <td>${fmtDate(a.reviewed_at || a.submitted_at)}</td></tr>`).join('') || '<tr><td colspan="6">None</td></tr>'}
    </tbody></table>

    <h2>Practical assessment</h2>
    ${last ? `<div class="kv">
        <div>Date</div><div>${fmtDate(last.assessed_on)}</div>
        <div>Location</div><div>${esc(last.location || '—')}</div>
        <div>Assessor</div><div>${esc(last.assessor_name || BRAND.trainerName)}</div>
        <div>Outcome</div><div><b>${last.outcome === 'competent' ? 'Competent' : 'Not yet competent'}</b></div>
      </div>
      ${comps.length ? `<table style="margin-top:.75rem"><thead><tr><th>#</th><th>Competency</th><th>Result</th><th>Notes</th></tr></thead><tbody>
        ${comps.map((c, i) => `<tr><td>${i + 1}</td><td>${esc(c.description)}</td><td class="nowrap">${RES[resMap[c.id]?.result] || 'Not assessed'}</td><td>${esc(resMap[c.id]?.notes || '')}</td></tr>`).join('')}
      </tbody></table>` : ''}
      ${last.notes ? `<p><b>Assessor notes:</b> ${esc(last.notes)}</p>` : ''}
      ${pracs.length > 1 ? `<p class="small muted">Earlier attempts: ${pracs.slice(0, -1).map((p) => `${fmtDate(p.assessed_on)} (${p.outcome === 'competent' ? 'competent' : 'not yet competent'})`).join(', ')}</p>` : ''}`
      : '<p class="muted">Not yet completed.</p>'}

    <h2>Trainer comments</h2>
    <p>${esc(e.trainer_comments || '—').replace(/\n/g, '<br>')}</p>

    <div class="sign">
      <div>${esc(BRAND.trainerName)}<br>${esc(BRAND.trainerTitle)}</div>
      <div>Date: ${fmtDate(e.completed_at || new Date())}</div>
    </div>
    <p class="small muted" style="margin-top:2rem">${esc(BRAND.name)}${BRAND.abn ? ' · ABN ' + esc(BRAND.abn) : ''} · ${esc(BRAND.contactEmail)}.
    This report contains personal information. Handle it in line with the Australian Privacy Principles.</p>
  </article>`);
}

function certificate(e, back) {
  pageSize(true);
  if (e.status !== 'completed') return view(`${toolbar(back)}<div class="card">The certificate is available once training is completed and issued.</div>`);
  view(`${toolbar(back)}
  <article class="cert"><div class="frame">
    ${logo()}
    <div class="eyebrow">${esc(BRAND.name)}</div>
    <h1>Certificate of Completion</h1>
    <div>This is to certify that</div>
    <div class="name">${esc(e.profiles.full_name)}</div>
    <div>has successfully completed theory and practical assessment and been deemed competent in</div>
    <div class="course" style="margin-top:.5rem">${esc(e.packages.name)}</div>
    <div class="muted">${esc(BRAND.tagline)}</div>
    ${e.organisations?.name ? `<div class="small muted" style="margin-top:.4rem">${esc(e.organisations.name)}</div>` : ''}
    <div class="meta">
      <div>${esc(BRAND.trainerName)}<br><span class="small">${esc(BRAND.trainerTitle)}</span></div>
      <div>Date of completion<br><b>${fmtDate(e.completed_at)}</b></div>
      <div>Certificate no.<br><b>${esc(e.certificate_number)}</b>${e.expires_at ? `<br><span class="small">Refresher due ${fmtDate(e.expires_at)}</span>` : ''}</div>
    </div>
  </div></article>`);
}
