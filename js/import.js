// Import a workbook from Mark's Excel template (NDIS_Workbook_Template v1.1).
// Reads the tabs by header name, skips EX- example rows, validates, shows a preview, then creates a NEW workbook.
import { sb, $, $$, esc, view, go, toast, must } from './app.js';

const XLSX_URL = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
export const TEMPLATE_URL = 'assets/NDIS_Workbook_Template_v1.1.xlsx';

const loadXlsx = () => window.XLSX ? Promise.resolve(window.XLSX) : new Promise((res, rej) => {
  const s = document.createElement('script'); s.src = XLSX_URL;
  s.onload = () => res(window.XLSX); s.onerror = () => rej(new Error('Could not load the Excel reader. Check your internet connection and try again.'));
  document.head.appendChild(s);
});

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
const str = (v) => (v instanceof Date ? dateStr(v) : String(v ?? '')).trim();
const dateStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const yes = (v) => /^(y|yes|true)$/i.test(str(v));
const isExample = (id) => /^EX-/i.test(str(id));
const intOrNull = (v) => { const t = str(v); return /^\d+$/.test(t) ? +t : null; };
const typeMap = { 'multiple choice': 'multiple_choice', 'multi-select': 'multi_select', 'multi select': 'multi_select', 'true/false': 'true_false', 'true / false': 'true_false', 'short answer': 'short' };
const BLOCKS = ['heading', 'text', 'bullets', 'callout', 'image', 'scenario', 'definition'];

// rows of a sheet as objects keyed by header, with the sheet row number kept
function rowsOf(X, wb, name, errors, required) {
  const ws = wb.Sheets[name];
  if (!ws) { errors.push(`The "${name}" tab is missing. Use Mark's template without renaming tabs.`); return []; }
  const raw = X.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });
  const head = (raw[0] || []).map(str);
  const miss = required.filter((h) => !head.includes(h));
  if (miss.length) { errors.push(`${name}: missing column${miss.length > 1 ? 's' : ''} ${miss.join(', ')}. Don't rename or remove template columns.`); return []; }
  return raw.slice(1).map((r, i) => {
    const o = { _row: i + 2 }; head.forEach((h, c) => { if (h) o[h] = r[c]; }); return o;
  });
}

export async function parseWorkbook(file) {
  const X = await loadXlsx();
  return parseBook(X, X.read(await file.arrayBuffer(), { type: 'array', cellDates: true }));
}

export async function parseBook(X, wb) {
  const errors = [], warnings = [];
  const err = (tab, row, msg) => errors.push(`${tab}${row ? ` row ${row}` : ''}: ${msg}`);
  const warn = (tab, row, msg) => warnings.push(`${tab}${row ? ` row ${row}` : ''}: ${msg}`);

  // ---- Cover ----
  const cover = {};
  if (!wb.Sheets.Cover) errors.push('The "Cover" tab is missing. Use Mark\'s template without renaming tabs.');
  else X.utils.sheet_to_json(wb.Sheets.Cover, { header: 1, defval: '', raw: true }).forEach((r) => { if (str(r[0]) && r[1] !== '') cover[str(r[0])] = r[1]; });
  const c = (k) => str(cover[k]);
  const title = c('Title');
  if (!title) err('Cover', 0, 'Title is empty.');
  else if (/^example/i.test(title)) warn('Cover', 0, 'Title still starts with "Example". Change it on the Cover tab if that is not intended.');
  const pass = c('Pass_Mark_Percent') === '' ? 100 : +c('Pass_Mark_Percent');
  if (!(pass >= 1 && pass <= 100)) err('Cover', 0, 'Pass_Mark_Percent must be a whole number from 1 to 100.');
  const rule = c('Practical_Pass_Rule') || 'All items competent';
  if (!['All items competent', 'All critical items plus pass %'].includes(rule)) err('Cover', 0, `Practical_Pass_Rule "${rule}" is not one of the listed values.`);
  const ppct = intOrNull(c('Practical_Pass_Percent'));
  if (rule !== 'All items competent' && !(ppct >= 1 && ppct <= 100)) err('Cover', 0, 'Practical_Pass_Percent (1 to 100) is needed for that pass rule.');
  const wbRow = {
    title, code: c('Workbook_ID') || null, version: c('Version') || '1.0', author: c('Author') || null, audience: c('Audience') || null,
    prerequisites: c('Prerequisites') || null, description: c('Description') || null, source_documents: c('Source_Documents') || null,
    est_duration_mins: intOrNull(c('Est_Duration_Mins')), review_date: /^\d{4}-\d{2}-\d{2}$/.test(c('Review_Date')) ? c('Review_Date') : null,
    pass_percent: pass, max_attempts: intOrNull(c('Knowledge_Max_Attempts')), randomise: yes(c('Randomise_Questions')),
    practical_required: c('Practical_Required') === '' ? true : yes(c('Practical_Required')),
    practical_setting: c('Practical_Setting') || null, practical_pass_rule: rule, practical_pass_percent: ppct,
    practical_max_attempts: intOrNull(c('Practical_Max_Attempts')), assessor_requirements: c('Assessor_Requirements') || null,
    reasonable_adjustments: c('Reasonable_Adjustments') || null, certificate_title: c('Certificate_Title') || null,
    certificate_expiry_months: intOrNull(c('Certificate_Expiry_Months')),
  };

  // ---- Outcomes ----
  const outcomes = [];
  rowsOf(X, wb, 'Outcomes', errors, ['Outcome_ID', 'Outcome', 'Assessed_By']).forEach((r) => {
    const id = str(r.Outcome_ID); if (!id || isExample(id)) return;
    if (outcomes.some((o) => o.code === id)) return err('Outcomes', r._row, `Duplicate Outcome_ID ${id}.`);
    const by = str(r.Assessed_By);
    if (!str(r.Outcome)) err('Outcomes', r._row, `${id} has no outcome text.`);
    if (!['Knowledge', 'Practical', 'Both'].includes(by)) err('Outcomes', r._row, `${id}: Assessed_By must be Knowledge, Practical or Both.`);
    outcomes.push({ code: id, description: str(r.Outcome), assessed_by: by });
  });
  const oc = new Set(outcomes.map((o) => o.code));
  const checkOutcome = (tab, row, id, what) => { if (id && !oc.has(id)) warn(tab, row, `${what} refers to outcome ${id}, which is not on the Outcomes tab.`); };

  // ---- Reading ----
  const sections = []; const secTitle = {}; const bySec = {}; const readingItems = [];
  const rd = rowsOf(X, wb, 'Reading', errors, ['Section_ID', 'Order', 'Section_Title', 'Block_Type', 'Content']);
  rd.forEach((r) => {
    const sid = str(r.Section_ID); if (!sid || isExample(sid)) return;
    const bt = str(r.Block_Type).toLowerCase(), content = str(r.Content);
    if (!str(r.Section_Title) || !bt || (!content && bt !== 'image')) return err('Reading', r._row, 'Missing section title, block type or content.');
    if (!BLOCKS.includes(bt)) return err('Reading', r._row, `Block_Type "${str(r.Block_Type)}" is not one of the listed types.`);
    if (!sections.includes(sid)) { sections.push(sid); secTitle[sid] = str(r.Section_Title); bySec[sid] = []; }
    const it = { kind: 'content', block_type: bt, section_code: sid, section_title: secTitle[sid], outcome_code: str(r.Outcome_ID) || null,
      title: null, body: content, image_url: null, alt_text: str(r.Alt_Text) || null, reference_source: str(r.Reference_Source) || null, _o: +r.Order || 0, _row: r._row };
    checkOutcome('Reading', r._row, it.outcome_code, `Row`);
    if (bt === 'heading') { it.title = content; it.body = ''; }
    else if (bt === 'bullets') it.body = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => `- ${l.replace(/^[-•*]\s*/, '')}`).join('\n');
    else if (bt === 'definition') { const m = content.match(/^([^:]+):\s*([\s\S]+)$/); it.body = m ? `**${m[1].trim()}:** ${m[2].trim()}` : content; if (!m) warn('Reading', r._row, 'Definition should be written as "Term: meaning".'); }
    else if (bt === 'image') {
      const u = str(r.Image_File_or_URL);
      if (!it.alt_text) return err('Reading', r._row, 'Image blocks need Alt_Text.');
      if (!/^https?:\/\//i.test(u)) warn('Reading', r._row, `Image "${u || '(none)'}" is not a web link, so the picture will not show yet (the description will). Upload support comes later.`);
      it.image_url = /^https?:\/\//i.test(u) ? u : null; it.body = u && !it.image_url ? u : '';
    }
    bySec[sid].push(it);
  });
  sections.forEach((sid) => bySec[sid].sort((a, b) => a._o - b._o || a._row - b._row));

  // ---- Trial questions (practice) placed after their section ----
  const trialBy = {}; let trialN = 0;
  const optsOf = (r, first) => { const o = {}; LETTERS.forEach((L) => { const v = str(r[`${first}${L}`]); if (v) o[L] = v; }); return o; };
  const answerOf = (tab, r, qt, opts, correct, label) => {
    const cc = str(correct);
    if (qt === 'true_false') { if (!/^(true|false)$/i.test(cc)) { err(tab, r._row, `${label}: Correct must be True or False.`); return null; } return /^t/i.test(cc) ? 'True' : 'False'; }
    const have = Object.keys(opts);
    if (have.length < 2) { err(tab, r._row, `${label}: needs at least two options.`); return null; }
    const ls = cc.toUpperCase().split(/[\s,;/&]+/).filter(Boolean);
    if (!ls.length || ls.some((l) => !opts[l])) { err(tab, r._row, `${label}: Correct "${cc}" must be letter(s) of filled options (${have.join(', ')}).`); return null; }
    if (qt === 'multiple_choice') { if (ls.length !== 1) { err(tab, r._row, `${label}: Multiple choice has exactly one correct letter. Use Multi-select for several.`); return null; } return opts[ls[0]]; }
    if (ls.length < 2) { err(tab, r._row, `${label}: Multi-select needs two or more correct letters.`); return null; }
    return JSON.stringify([...new Set(ls)].map((l) => opts[l]));
  };
  rowsOf(X, wb, 'Trial_Qs', errors, ['Q_ID', 'After_Section_ID', 'Type', 'Question', 'Correct']).forEach((r) => {
    const id = str(r.Q_ID); if (!id || isExample(id)) return;
    const qt = typeMap[str(r.Type).toLowerCase()];
    if (!qt || qt === 'short') return err('Trial_Qs', r._row, `${id}: practice questions can be Multiple choice, Multi-select or True/false.`);
    if (!str(r.Question)) return err('Trial_Qs', r._row, `${id}: no question text.`);
    const sid = str(r.After_Section_ID);
    if (!sections.includes(sid)) return err('Trial_Qs', r._row, `${id}: After_Section_ID "${sid}" is not a section on the Reading tab.`);
    const opts = qt === 'true_false' ? {} : optsOf(r, 'Option_');
    const ans = answerOf('Trial_Qs', r, qt, opts, r.Correct, id); if (ans === null) return;
    (trialBy[sid] ||= []).push({ kind: 'practice', block_type: null, section_code: sid, section_title: secTitle[sid], title: null, body: str(r.Question), qtype: qt,
      options: Object.values(opts), answer: ans, hint: str(r.Hint) || null, explanation: str(r.Feedback_Correct) || null, explanation_incorrect: str(r.Feedback_Incorrect) || null });
    trialN++;
  });
  const items = [];
  sections.forEach((sid) => { items.push(...bySec[sid]); items.push(...(trialBy[sid] || [])); });
  items.forEach((it) => { delete it._o; delete it._row; });

  // ---- Knowledge questions ----
  const questions = []; const qIds = new Set();
  rowsOf(X, wb, 'Knowledge_Qs', errors, ['Q_ID', 'Outcome_ID', 'Source_Section_ID', 'Type', 'Question', 'Correct', 'Marks', 'Critical']).forEach((r) => {
    const id = str(r.Q_ID); if (!id || isExample(id)) return;
    if (qIds.has(id)) return err('Knowledge_Qs', r._row, `Duplicate Q_ID ${id}.`); qIds.add(id);
    const qt = typeMap[str(r.Type).toLowerCase()];
    if (!qt) return err('Knowledge_Qs', r._row, `${id}: Type "${str(r.Type)}" is not one of the listed types.`);
    if (!str(r.Question)) return err('Knowledge_Qs', r._row, `${id}: no question text.`);
    const marks = str(r.Marks) === '' ? 1 : +str(r.Marks);
    if (!Number.isInteger(marks) || marks < 0) return err('Knowledge_Qs', r._row, `${id}: Marks must be a whole number.`);
    const oid = str(r.Outcome_ID); checkOutcome('Knowledge_Qs', r._row, oid, id);
    const ss = str(r.Source_Section_ID); if (ss && !sections.includes(ss)) warn('Knowledge_Qs', r._row, `${id}: Source_Section_ID ${ss} is not on the Reading tab.`);
    let opts = {}, ans = null;
    if (qt !== 'short' && qt !== 'true_false') opts = optsOf(r, 'Option_');
    if (qt !== 'short') { ans = answerOf('Knowledge_Qs', r, qt, opts, r.Correct, id); if (ans === null) return; }
    else if (!str(r.Marking_Guide)) warn('Knowledge_Qs', r._row, `${id}: short answer has no Marking_Guide for the assessor.`);
    questions.push({ qtype: qt, prompt: str(r.Question), options: Object.values(opts), marks, critical: yes(r.Critical), outcome_code: oid || null, source_section: ss || null,
      key: { correct_answer: ans, marking_guide: str(r.Marking_Guide) || null, feedback: str(r.Feedback) || null } });
  });

  // ---- Practical ----
  const skills = [];
  rowsOf(X, wb, 'Practical', errors, ['Item_ID', 'Task_Group', 'Outcome_ID', 'Competency_Item', 'Observable_Criteria', 'Assessment_Method', 'Critical']).forEach((r) => {
    const id = str(r.Item_ID); if (!id || isExample(id)) return;
    if (!str(r.Competency_Item) || !str(r.Observable_Criteria)) return err('Practical', r._row, `${id}: needs Competency_Item and Observable_Criteria.`);
    const oid = str(r.Outcome_ID); checkOutcome('Practical', r._row, oid, id);
    skills.push({ description: str(r.Competency_Item), task_group: str(r.Task_Group) || null, outcome_code: oid || null, criteria: str(r.Observable_Criteria), method: str(r.Assessment_Method) || null,
      conditions: str(r.Conditions) || null, resources: str(r.Resources_Required) || null, evidence: str(r.Evidence_Required) || null,
      min_observations: intOrNull(r.Min_Observations) || 1, critical: yes(r.Critical), assessor_prompt: str(r.Assessor_Prompt) || null });
  });

  // ---- whole-file checks ----
  if (!items.some((i) => i.kind === 'content')) warn('Reading', 0, 'No reading content found.');
  if (!questions.length) warn('Knowledge_Qs', 0, 'No knowledge questions found.');
  if (!skills.length) warn('Practical', 0, 'No practical items found.');
  const coverage = outcomes.map((o) => ({
    ...o, reading: items.filter((i) => i.kind === 'content' && i.outcome_code === o.code).length,
    knowledge: questions.filter((q) => q.outcome_code === o.code).length, practical: skills.filter((s) => s.outcome_code === o.code).length,
  }));
  coverage.forEach((o) => {
    if (!o.reading) warn('Outcomes', 0, `${o.code} is not taught in any Reading block.`);
    if (o.assessed_by !== 'Practical' && !o.knowledge) warn('Outcomes', 0, `${o.code} is marked ${o.assessed_by} but has no knowledge question.`);
    if (o.assessed_by !== 'Knowledge' && !o.practical) warn('Outcomes', 0, `${o.code} is marked ${o.assessed_by} but has no practical item.`);
  });
  if (title) {
    const dup = must(await sb.from('workbooks').select('id,title,code'));
    const t = dup.find((w) => w.title.toLowerCase() === title.toLowerCase() || (wbRow.code && w.code && w.code.toLowerCase() === wbRow.code.toLowerCase()));
    if (t) errors.push(`A workbook called "${t.title}" already exists. Change the Title (and Workbook_ID) on the Cover tab so this does not duplicate it.`);
  }
  return { wb: wbRow, outcomes, items, questions, skills, coverage, errors, warnings, trialN };
}

const chunk = (a, n = 200) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

export async function createFromParsed(p) {
  const w = must(await sb.from('workbooks').insert({ ...p.wb, is_active: true }).select('id').single());
  const wid = w.id;
  try {
    if (p.outcomes.length) must(await sb.from('outcomes').insert(p.outcomes.map((o, i) => ({ ...o, workbook_id: wid, position: i + 1 }))));
    for (const part of chunk(p.items.map((it, i) => ({ ...it, workbook_id: wid, position: i + 1 })))) must(await sb.from('learning_items').insert(part));
    const qrows = p.questions.map((q, i) => ({ id: crypto.randomUUID(), q, i }));
    for (const part of chunk(qrows)) must(await sb.from('questions').insert(part.map(({ id, q, i }) => ({ id, workbook_id: wid, position: i + 1, prompt: q.prompt,
      qtype: q.qtype, options: q.options, marks: q.marks, critical: q.critical, outcome_code: q.outcome_code, source_section: q.source_section }))));
    for (const part of chunk(qrows)) must(await sb.from('question_keys').insert(part.map(({ id, q }) => ({ question_id: id, ...q.key }))));
    for (const part of chunk(p.skills.map((s, i) => ({ ...s, workbook_id: wid, package_id: null, position: i + 1 })))) must(await sb.from('competencies').insert(part));
  } catch (e) {
    await sb.from('workbooks').delete().eq('id', wid); // cascades, so a failed import leaves nothing behind
    throw e;
  }
  return wid;
}

export async function importView() {
  view(`<div class="row"><a href="#/a/workbooks">← Workbooks</a></div>
    <div class="card"><h1>Import workbook from Excel</h1>
    <p>Choose a completed copy of the NDIS Workbook Template. Nothing is saved until you confirm on the next screen, and the import always creates a new workbook.</p>
    <p class="small muted"><a href="${TEMPLATE_URL}" download>Download the blank template (v1.1)</a> · example rows starting EX- are skipped automatically.</p>
    <label class="btn" style="display:inline-block;cursor:pointer">Choose Excel file<input type="file" id="f" accept=".xlsx,.xlsm" hidden></label>
    <div id="out" style="margin-top:1rem"></div></div>`);
  $('#f').onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    const out = $('#out'); out.innerHTML = '<p class="muted">Reading file…</p>';
    let p;
    try { p = await parseWorkbook(file); } catch (x) { out.innerHTML = `<div class="notice bad">${esc(x.message || 'Could not read that file.')}</div>`; return; }
    const li = (a) => a.map((m) => `<li>${esc(m)}</li>`).join('');
    const nContent = p.items.filter((i) => i.kind === 'content').length;
    out.innerHTML = `<h2>${esc(p.wb.title || '(no title)')} <span class="small muted">v${esc(p.wb.version)}${p.wb.code ? ` · ${esc(p.wb.code)}` : ''}</span></h2>
      <div class="table-wrap"><table><tbody>
        <tr><td>Learning outcomes</td><td>${p.outcomes.length}</td></tr>
        <tr><td>Reading blocks</td><td>${nContent}</td></tr>
        <tr><td>Practice questions (not assessed)</td><td>${p.trialN}</td></tr>
        <tr><td>Knowledge questions</td><td>${p.questions.length} (${p.questions.filter((q) => q.critical).length} critical, ${p.questions.reduce((t, q) => t + q.marks, 0)} marks, pass mark ${p.wb.pass_percent}%)</td></tr>
        <tr><td>Practical items</td><td>${p.skills.length} (${p.skills.filter((s) => s.critical).length} critical)</td></tr>
      </tbody></table></div>
      ${p.errors.length ? `<div class="notice bad"><b>Fix these in the file, then choose it again (${p.errors.length}):</b><ul>${li(p.errors)}</ul></div>` : '<div class="notice info">No errors found.</div>'}
      ${p.warnings.length ? `<div class="notice info"><b>Worth a look (${p.warnings.length}), but they won't stop the import:</b><ul>${li(p.warnings)}</ul></div>` : ''}
      ${p.coverage.length ? `<h3>Outcome coverage</h3><div class="table-wrap"><table><thead><tr><th>Outcome</th><th>Assessed by</th><th>Reading</th><th>Knowledge</th><th>Practical</th></tr></thead><tbody>
        ${p.coverage.map((o) => `<tr><td><b>${esc(o.code)}</b> ${esc(o.description)}</td><td>${esc(o.assessed_by)}</td><td>${o.reading}</td><td>${o.knowledge}</td><td>${o.practical}</td></tr>`).join('')}</tbody></table></div>` : ''}
      <div class="row" style="margin-top:1rem"><button class="btn ok" id="go" ${p.errors.length ? 'disabled' : ''}>Create workbook</button><a class="btn secondary" href="#/a/workbooks">Cancel</a></div>`;
    $('#go').onclick = async (ev) => {
      ev.target.disabled = true; ev.target.textContent = 'Creating…';
      try { const id = await createFromParsed(p); toast('Workbook imported'); go(`#/a/workbook/${id}`); }
      catch (x) { toast(x.message || 'Import failed. Nothing was saved.', true); ev.target.disabled = false; ev.target.textContent = 'Create workbook'; }
    };
  };
}
