import { sb, state, $, $$, esc, fmtDate, view, go, toast, must, formData, badge, stageSteps, ratingInput, formatText } from './app.js';

const partTabs = (id, active, hasLearning) => hasLearning ? `<div class="parts" role="tablist">
  <a role="tab" href="#/wb/${id}/learn" class="${active === 'learn' ? 'on' : ''}" aria-selected="${active === 'learn'}">Part 1 · Learning</a>
  <a role="tab" href="#/wb/${id}/assess" class="${active === 'assess' ? 'on' : ''}" aria-selected="${active === 'assess'}">Part 2 · Knowledge assessment</a></div>` : '';

// Decide which part to open: learning first until they've finished it
async function openWorkbook(id) {
  const a = must(await sb.from('assignments').select('status, learning_done_at, workbook_id').eq('id', id).single());
  const { count } = await sb.from('learning_items').select('id', { count: 'exact', head: true }).eq('workbook_id', a.workbook_id);
  const editable = ['not_started', 'in_progress', 'resubmit'].includes(a.status);
  location.replace(`#/wb/${id}/${count && !a.learning_done_at && editable ? 'learn' : 'assess'}`);
}

async function learn(id) {
  const a = must(await sb.from('assignments').select('*, workbooks(title, version, description)').eq('id', id).single());
  const items = must(await sb.from('learning_items').select('*').eq('workbook_id', a.workbook_id).order('position'));
  let pn = 0;
  const html = items.map((it) => {
    if (it.kind === 'content') return `<section class="learn-block">${it.title ? `<h2>${esc(it.title)}</h2>` : ''}${formatText(it.body)}</section>`;
    pn++;
    const opts = it.qtype === 'true_false' ? ['True', 'False'] : it.options || [];
    return `<section class="practice" data-p="${it.id}">
      <div class="small" style="font-weight:700;color:var(--brand)">Check your understanding ${pn}${it.title ? ' · ' + esc(it.title) : ''}</div>
      <div style="margin:.3rem 0">${esc(it.body).replace(/\n/g, '<br>')}</div>
      ${opts.map((o) => `<label class="choice"><input type="radio" name="p_${it.id}" value="${esc(o)}">${esc(o)}</label>`).join('')}
      <button type="button" class="btn small secondary" data-check="${it.id}">Check answer</button>
      <div class="pfb" aria-live="polite"></div></section>`;
  }).join('');
  view(`<p><a href="#/">← Back</a></p>
    <div class="card"><h1 style="margin:0 0 .3rem">${esc(a.workbooks.title)}</h1>
      ${partTabs(id, 'learn', true)}
      <div class="notice info small">Read through the material below and answer each "Check your understanding" question. They're just for practice, and your answers aren't saved or marked. When you reach the end, confirm you've read everything to unlock Part 2.</div>
      ${html || '<p class="muted">No learning material for this workbook.</p>'}
      <section class="ack">
        ${a.learning_done_at ? `<p class="small muted">You finished the learning material on ${fmtDate(a.learning_done_at)}.</p><a class="btn" href="#/wb/${id}/assess">Go to knowledge assessment →</a>`
          : `<h2 style="margin-top:0">Before you continue</h2>
          <p id="ackprogress" class="small"></p>
          <label class="choice"><input type="checkbox" id="ackbox" disabled>I have read and understood the learning material in Part 1.</label>
          <button class="btn block" id="done" disabled>Start the knowledge assessment →</button>`}
      </section></div>`);
  // The acknowledgement unlocks only once every practice question has been answered
  const practiceIds = items.filter((x) => x.kind === 'practice').map((x) => x.id);
  const answered = new Set();
  const refreshAck = () => {
    if (!$('#done')) return;
    const left = practiceIds.length - answered.size;
    $('#ackprogress').innerHTML = left > 0
      ? `Answer all the "Check your understanding" questions to continue: <b>${answered.size} of ${practiceIds.length}</b> done.`
      : practiceIds.length ? '✓ All practice questions answered.' : '';
    $('#ackbox').disabled = left > 0;
    if (left > 0) $('#ackbox').checked = false;
    $('#done').disabled = left > 0 || !$('#ackbox').checked;
  };
  refreshAck();
  $('#ackbox') && ($('#ackbox').onchange = refreshAck);
  $$('[data-check]').forEach((b) => (b.onclick = () => {
    const it = items.find((x) => x.id === b.dataset.check);
    const box = b.parentElement.querySelector('.pfb');
    const pick = $(`[name="p_${it.id}"]:checked`);
    if (!pick) { box.innerHTML = '<div class="notice small">Choose an answer first.</div>'; return; }
    const right = (it.answer || '').trim().toLowerCase() === pick.value.trim().toLowerCase();
    box.innerHTML = `<div class="notice ${right ? 'info' : 'bad'} small"><b>${right ? 'Correct.' : 'Not quite.'}</b>
      ${right ? '' : `The answer is <b>${esc(it.answer)}</b>.`} ${it.explanation ? esc(it.explanation) : ''}</div>`;
    answered.add(it.id); refreshAck();
  }));
  $('#done') && ($('#done').onclick = async () => {
    must(await sb.rpc('mark_learning_done', { p_assignment: id }), 'Could not continue');
    go(`#/wb/${id}/assess`);
  });
}

export async function route(h) {
  let m;
  if ((m = h.match(/^#\/wb\/([\w-]+)\/learn$/))) return learn(m[1]);
  if ((m = h.match(/^#\/wb\/([\w-]+)\/assess$/))) return workbook(m[1]);
  if ((m = h.match(/^#\/wb\/([\w-]+)$/))) return openWorkbook(m[1]);
  if ((m = h.match(/^#\/fb\/(a|p)\/([\w-]+)$/))) return feedbackForm(m[1], m[2]);
  return dashboard();
}

async function dashboard() {
  const uid = state.user.id;
  const [enrs, asg, prac, fb] = await Promise.all([
    sb.from('enrollments').select('*, packages(name, code)').eq('learner_id', uid).order('started_at'),
    sb.from('assignments').select('*, workbooks(title, description, version)').eq('learner_id', uid),
    sb.from('practical_assessments').select('*').order('assessed_on'),
    sb.from('feedback').select('assignment_id, practical_id').eq('learner_id', uid),
  ]).then((r) => r.map((x) => must(x)));

  const given = new Set(fb.flatMap((f) => [f.assignment_id, f.practical_id]).filter(Boolean));
  const pending = [
    ...asg.filter((a) => ['submitted', 'competent'].includes(a.status) && !given.has(a.id))
      .map((a) => `<li><a href="#/fb/a/${a.id}">Feedback on workbook: ${esc(a.workbooks.title)}</a></li>`),
    ...prac.filter((p) => p.outcome !== 'draft' && !given.has(p.id))
      .map((p) => `<li><a href="#/fb/p/${p.id}">Feedback on practical training (${fmtDate(p.assessed_on)})</a></li>`),
  ];

  const blocks = enrs.map((e) => {
    const mine = asg.filter((a) => a.enrollment_id === e.id).sort((a, b) => a.workbooks.title.localeCompare(b.workbooks.title));
    const done = mine.filter((a) => a.status === 'competent').length;
    const pr = prac.filter((p) => p.enrollment_id === e.id);
    let next = '';
    if (e.status === 'workbooks') next = `Complete your workbooks below (${done} of ${mine.length} marked competent).`;
    if (e.status === 'ready_for_practical') next = 'All workbooks are complete. Your trainer will contact you to book your practical training.';
    if (e.status === 'practical_complete') next = 'Practical complete. Your trainer is finalising your certificate.';
    if (e.status === 'completed') next = 'Congratulations, you have completed this training.';
    return `<section class="card">
      <div class="row between"><h2 style="margin:0">${esc(e.title || e.packages?.name || 'Training')}</h2>${badge(e.status)}</div>
      ${stageSteps(e.status)}
      <p>${next}</p>
      ${e.status === 'completed' ? `<div class="row"><a class="btn" href="#/doc/cert/${e.id}">View certificate</a><a class="btn secondary" href="#/doc/report/${e.id}">Training report</a></div>` : ''}
      <h3>Workbooks</h3>
      ${mine.length ? `<div class="table-wrap"><table><thead><tr><th>Workbook</th><th>Status</th><th></th></tr></thead><tbody>
        ${mine.map((a) => `<tr><td>${esc(a.workbooks.title)}<div class="small muted">${esc(a.workbooks.description || '')}</div>
          ${a.status === 'resubmit' && a.reviewer_notes ? `<div class="notice small">Trainer: ${esc(a.reviewer_notes)}</div>` : ''}</td>
          <td>${badge(a.status)}</td>
          <td class="right"><a class="btn small ${['submitted', 'competent'].includes(a.status) ? 'secondary' : ''}" href="#/wb/${a.id}">
            ${{ not_started: 'Start', in_progress: 'Continue', resubmit: 'Fix & resubmit' }[a.status] || 'View'}</a></td></tr>`).join('')}
      </tbody></table></div>` : '<p class="muted">No workbooks assigned yet.</p>'}
      ${pr.filter((p) => p.outcome !== 'draft').map((p) => `<p>Practical on ${fmtDate(p.assessed_on)}: ${badge(p.outcome)}</p>`).join('')}
    </section>`;
  }).join('');

  view(`<h1>Welcome, ${esc(state.profile.full_name?.split(' ')[0] || '')}</h1>
    ${pending.length ? `<div class="notice"><b>Please give feedback:</b><ul style="margin:.3rem 0 0">${pending.join('')}</ul></div>` : ''}
    ${blocks || '<div class="card">You are not enrolled in any training yet.</div>'}`);
}

async function workbook(id) {
  const a = must(await sb.from('assignments').select('*, workbooks(*)').eq('id', id).single());
  const [qs, ans] = await Promise.all([
    sb.from('questions').select('*').eq('workbook_id', a.workbook_id).order('position'),
    sb.from('answers').select('*').eq('assignment_id', id),
  ]).then((r) => r.map((x) => must(x)));
  const hasLearning = !!(await sb.from('learning_items').select('id', { count: 'exact', head: true }).eq('workbook_id', a.workbook_id)).count;
  const byQ = Object.fromEntries(ans.map((x) => [x.question_id, x]));
  const editable = ['not_started', 'in_progress', 'resubmit'].includes(a.status);
  let lastSection = null;

  const qHtml = qs.map((q, i) => {
    const an = byQ[q.id] || {};
    const val = an.response ?? '';
    const sec = q.section && q.section !== lastSection ? `<h2>${esc(q.section)}</h2>` : '';
    lastSection = q.section || lastSection;
    let input;
    const nm = `q_${q.id}`;
    if (!editable) input = `<div class="response">${esc(val) || '<span class="muted">No answer</span>'}</div>`;
    else if (q.qtype === 'multiple_choice' || q.qtype === 'true_false') {
      const opts = q.qtype === 'true_false' ? ['True', 'False'] : q.options || [];
      input = opts.map((o) => `<label class="choice"><input type="radio" name="${nm}" value="${esc(o)}" ${o === val ? 'checked' : ''}>${esc(o)}</label>`).join('');
    } else if (q.qtype === 'short') input = `<input name="${nm}" value="${esc(val)}" aria-labelledby="p_${q.id}">`;
    else input = `<textarea name="${nm}" aria-labelledby="p_${q.id}">${esc(val)}</textarea>`;
    const fb = !editable || a.status === 'resubmit'
      ? (an.is_correct === false ? `<div class="notice bad small">Needs work${an.marker_comment ? ': ' + esc(an.marker_comment) : ''}</div>`
        : an.marker_comment ? `<div class="notice info small">Trainer: ${esc(an.marker_comment)}</div>` : '') : '';
    return `${sec}<div class="question"><div id="p_${q.id}"><span class="qnum">Q${i + 1}.</span> ${esc(q.prompt).replace(/\n/g, '<br>')}</div>
      <div class="small muted">${q.marks} mark${q.marks === 1 ? '' : 's'}</div>${input}${fb}</div>`;
  }).join('');

  view(`<p><a href="#/">← Back</a></p>
    <div class="card"><div class="row between"><h1 style="margin:0">${esc(a.workbooks.title)}</h1>${badge(a.status)}</div>
      <p class="muted">Version ${esc(a.workbooks.version)}${a.attempt > 1 ? ` · Attempt ${a.attempt}` : ''}</p>
      ${partTabs(id, 'assess', hasLearning)}
      ${hasLearning && !a.learning_done_at && editable ? `<div class="notice">Please work through <a href="#/wb/${id}/learn">Part 1 · Learning</a> before you start the assessment.</div>` : ''}
      ${a.workbooks.description ? `<p>${esc(a.workbooks.description)}</p>` : ''}
      ${a.reviewer_notes && !editable ? `<div class="notice info">Trainer comments: ${esc(a.reviewer_notes)}</div>` : ''}
      ${a.status === 'resubmit' ? `<div class="notice">Your trainer has asked you to update some answers. ${esc(a.reviewer_notes || '')}</div>` : ''}
      ${editable ? '<p class="small muted">Your answers are saved when you press Save. You can come back and finish later.</p>' : ''}
      ${hasLearning && !a.learning_done_at && editable ? '</div>' : `<form id="wb">${qHtml || '<p class="muted">This workbook has no questions yet.</p>'}
      ${editable && qs.length ? `<div class="sticky-actions row"><button type="button" class="btn secondary" id="save">Save</button>
        <button class="btn" id="submit">Submit for marking</button></div>` : ''}</form>
    </div>`}`);
  if (!editable || !$('#wb')) return;

  const collect = () => {
    const out = {};
    for (const q of qs) {
      const els = $$(`[name="q_${q.id}"]`);
      const el = els.find((x) => x.type !== 'radio' || x.checked);
      out[q.id] = el ? el.value : '';
    }
    return out;
  };
  const save = async () => must(await sb.rpc('save_answers', { p_assignment: id, p_answers: collect() }), 'Could not save');
  $('#save').onclick = async () => { await save(); toast('Saved'); };
  $('#wb').onsubmit = async (e) => {
    e.preventDefault();
    const missing = Object.values(collect()).filter((v) => !v.trim()).length;
    if (missing) return toast(`Please answer all questions (${missing} left)`, true);
    if (!confirm('Submit this workbook for marking? You won\'t be able to change your answers unless your trainer returns it.')) return;
    await save();
    must(await sb.rpc('submit_assignment', { p_assignment: id }), 'Could not submit');
    toast('Submitted, thank you');
    const { data: had } = await sb.from('feedback').select('id').eq('assignment_id', id).maybeSingle();
    go(had ? '#/' : `#/fb/a/${id}`);
  };
}

async function feedbackForm(kind, id) {
  const label = kind === 'a'
    ? 'workbook: ' + (must(await sb.from('assignments').select('workbooks(title)').eq('id', id).single()).workbooks.title)
    : 'practical training';
  view(`<div class="card narrow" style="max-width:640px">
    <h1>Feedback</h1><p class="muted">Tell us about the ${esc(label)}. Your feedback helps improve the training.</p>
    <form id="f">
      ${ratingInput('rating_overall', 'Overall, how would you rate it?')}
      ${ratingInput('rating_content', 'Was the content clear and relevant to your work?')}
      ${ratingInput('rating_trainer', kind === 'a' ? 'How well were you supported by the trainer?' : 'How would you rate the trainer/assessor?')}
      ${ratingInput('confidence', 'How confident do you now feel with this support?')}
      <label for="liked">What worked well?</label><textarea id="liked" name="liked"></textarea>
      <label for="improve">What could be improved?</label><textarea id="improve" name="improve"></textarea>
      <button class="btn block">Send feedback</button>
    </form><p class="center"><a href="#/">Skip for now</a></p></div>`);
  $('#f').onsubmit = async (e) => {
    e.preventDefault(); const d = formData(e.target);
    const row = { learner_id: state.user.id, liked: d.liked, improve: d.improve,
      rating_overall: +d.rating_overall, rating_content: +d.rating_content, rating_trainer: +d.rating_trainer, confidence: +d.confidence };
    row[kind === 'a' ? 'assignment_id' : 'practical_id'] = id;
    must(await sb.from('feedback').insert(row), 'Could not send');
    toast('Thanks for your feedback'); go('#/');
  };
}
