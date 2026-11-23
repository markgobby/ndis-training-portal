import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY, BRAND } from './config.js';

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
export const state = { user: null, profile: null, org: '' };
export { BRAND };

// ---------------- helpers ----------------
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
export const view = (html) => { $('#app').innerHTML = html; window.scrollTo(0, 0); };
export const go = (hash) => { if (location.hash === hash) render(); else location.hash = hash; };

let toastTimer;
export function toast(msg, isErr = false) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'show' + (isErr ? ' err' : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.className = ''), isErr ? 6000 : 2800);
}
// Unwraps a Supabase response, showing a message on error
export function must(res, label = 'Something went wrong') {
  if (res.error) { console.error(res.error); toast(`${label}: ${res.error.message}`, true); throw res.error; }
  return res.data;
}
// Simple, safe formatting for learning text: blank line = new paragraph,
// lines starting "- " = bullet list, "## " = sub-heading, **bold**.
export function formatText(src) {
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  let out = '', list = [];
  const flush = () => { if (list.length) { out += `<ul>${list.map((l) => `<li>${inline(l)}</li>`).join('')}</ul>`; list = []; } };
  for (const raw of String(src ?? '').split('\n')) {
    const l = raw.trim();
    if (/^[-•]\s+/.test(l)) { list.push(l.replace(/^[-•]\s+/, '')); continue; }
    flush();
    if (!l) continue;
    out += /^##\s+/.test(l) ? `<h3>${inline(l.replace(/^##\s+/, ''))}</h3>` : `<p>${inline(l)}</p>`;
  }
  flush();
  return out;
}
export function formData(form) { return Object.fromEntries(new FormData(form).entries()); }

const STATUS = {
  not_started: ['Not started', ''], in_progress: ['In progress', 'info'], submitted: ['Awaiting review', 'warn'],
  resubmit: ['Resubmit required', 'bad'], competent: ['Competent', 'ok'],
  workbooks: ['Workbooks', 'info'], ready_for_practical: ['Ready for practical', 'warn'],
  practical_complete: ['Practical complete', 'ok'], completed: ['Completed', 'ok'], withdrawn: ['Withdrawn', 'bad'],
  draft: ['Draft', ''], not_yet_competent: ['Not yet competent', 'bad'],
};
export const badge = (s) => { const [l, c] = STATUS[s] || [s, '']; return `<span class="badge ${c}">${esc(l)}</span>`; };

export function stageSteps(status) {
  const order = ['workbooks', 'ready_for_practical', 'practical_complete', 'completed'];
  const labels = ['Workbooks', 'Practical', 'Final review', 'Certificate'];
  const idx = order.indexOf(status);
  return `<div class="steps" aria-label="Progress">${labels.map((l, i) =>
    `<div class="${i < idx || status === 'completed' ? 'done' : i === idx ? 'current' : ''}">${l}</div>`).join('')}</div>`;
}

export function ratingInput(name, label) {
  return `<fieldset style="border:0;padding:0;margin:.9rem 0 0"><legend style="font-weight:600">${esc(label)}</legend>
    <div class="stars">${[1, 2, 3, 4, 5].map((n) => `<label><input type="radio" name="${name}" value="${n}" required><span>${n}</span></label>`).join('')}</div>
    <div class="small muted">1 = poor, 5 = excellent</div></fieldset>`;
}

// ---------------- top bar ----------------
async function renderTopbar() {
  const bar = $('#topbar');
  if (!state.profile) { bar.innerHTML = `<div class="inner"><span class="title">${esc(BRAND.name)}</span></div>`; return; }
  const h = location.hash || '#/';
  if (state.profile.role === 'admin') {
    const orgs = must(await sb.from('organisations').select('id,name').order('name'));
    if (state.org && !orgs.some((o) => o.id === state.org)) state.org = '';
    const links = [['#/', 'Dashboard'], ['#/a/learners', 'Learners'], ['#/a/review', 'Review'], ['#/a/workbooks', 'Workbooks'],
      ['#/a/packages', 'Packages'], ['#/a/orgs', 'Organisations'], ['#/a/invites', 'Invite codes'], ['#/a/feedback', 'Feedback']];
    bar.innerHTML = `<div class="inner">
      <a class="title" href="#/">${esc(BRAND.name)} · Admin</a>
      <label class="small" style="margin:0;color:#fff" for="orgSwitch">Viewing</label>
      <select id="orgSwitch" aria-label="Organisation filter">
        <option value="">All organisations</option>
        ${orgs.map((o) => `<option value="${o.id}" ${o.id === state.org ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}
      </select>
      <button class="btn small" id="logout">Sign out</button>
      <nav>${links.map(([href, l]) => `<a href="${href}" class="${(href === '#/' ? h === '#/' : h.startsWith(href)) ? 'active' : ''}">${l}</a>`).join('')}</nav>
    </div>`;
    $('#orgSwitch').onchange = (e) => {
      state.org = e.target.value;
      try { localStorage.setItem('orgFilter', state.org); } catch {}
      render();
    };
  } else {
    bar.innerHTML = `<div class="inner"><a class="title" href="#/">${esc(BRAND.name)}</a>
      <span class="small">${esc(state.profile.full_name || '')}</span>
      <button class="btn small" id="logout">Sign out</button></div>`;
  }
  $('#logout').onclick = async () => { await sb.auth.signOut(); state.profile = null; go('#/login'); };
}

// ---------------- auth screens ----------------
function loginView() {
  view(`<div class="card narrow">
    <h1>Sign in</h1>
    <form id="f">
      <label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email" required>
      <label for="pw">Password</label><input id="pw" name="password" type="password" autocomplete="current-password" required>
      <button class="btn block">Sign in</button>
    </form>
    <p class="center"><button class="linkbtn" id="forgot">Forgot password?</button></p>
    <hr style="border:0;border-top:1px solid var(--line)">
    <p class="center">New learner with an invite code?</p>
    <a class="btn secondary block center" href="#/join">Create my account</a>
  </div>`);
  $('#f').onsubmit = async (e) => {
    e.preventDefault(); const d = formData(e.target);
    const { error } = await sb.auth.signInWithPassword({ email: d.email.trim(), password: d.password });
    if (error) return toast(error.message, true);
    await boot();
  };
  $('#forgot').onclick = async () => {
    const email = $('#email').value.trim();
    if (!email) return toast('Enter your email above first', true);
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    toast(error ? error.message : 'Check your email for a reset link', !!error);
  };
}

function joinView() {
  view(`<div class="card narrow">
    <h1>Create your account</h1>
    <p class="muted">Enter the invite code and package plan number you were given by your trainer.</p>
    <form id="f1">
      <label for="code">Invite code</label><input id="code" name="code" autocomplete="off" required style="text-transform:uppercase">
      <label for="pkg">Package plan number</label><input id="pkg" name="pkg" autocomplete="off">
      <div class="small muted">Leave blank if your trainer said it isn't needed.</div>
      <button class="btn block">Check code</button>
    </form>
    <div id="step2"></div>
    <p class="center small"><a href="#/login">Already have an account? Sign in</a></p>
  </div>`);
  $('#f1').onsubmit = async (e) => {
    e.preventDefault(); const d = formData(e.target);
    const [r] = must(await sb.rpc('check_invite', { p_code: d.code, p_package_code: d.pkg || null }), 'Could not check code');
    if (!r?.valid) return toast(r?.message || 'Invalid code', true);
    $('#f1').querySelectorAll('input,button').forEach((x) => (x.disabled = true));
    $('#step2').innerHTML = `<div class="notice info">Organisation: <b>${esc(r.organisation_name)}</b><br>Training: <b>${esc(r.package_name)}</b></div>
      <form id="f2">
        <label for="fn">Full name (as it should appear on your certificate)</label><input id="fn" name="full_name" autocomplete="name" required>
        <label for="ph">Mobile (optional)</label><input id="ph" name="phone" type="tel" autocomplete="tel">
        <label for="em">Email</label><input id="em" name="email" type="email" autocomplete="email" required>
        <label for="pw">Create a password (at least 8 characters)</label><input id="pw" name="password" type="password" minlength="8" autocomplete="new-password" required>
        <button class="btn block">Create account</button>
      </form>`;
    $('#f2').onsubmit = async (ev) => {
      ev.preventDefault(); const p = formData(ev.target);
      const btn = ev.target.querySelector('button'); btn.disabled = true;
      const { data, error } = await sb.auth.signUp({
        email: p.email.trim(), password: p.password,
        options: {
          emailRedirectTo: location.origin + location.pathname,
          data: { invite_code: d.code.trim(), package_code: (d.pkg || '').trim(), full_name: p.full_name.trim(), phone: p.phone.trim() },
        },
      });
      btn.disabled = false;
      if (error) return toast(error.message.includes('Database error') ? 'Your invite code could not be used. Please check it with your trainer.' : error.message, true);
      if (!data.session) {
        view(`<div class="card narrow center"><h1>Check your email</h1><p>We've sent a confirmation link to <b>${esc(p.email)}</b>. Click it, then sign in.</p><a class="btn" href="#/login">Go to sign in</a></div>`);
      } else { await boot(); }
    };
  };
}

function newPasswordView() {
  view(`<div class="card narrow"><h1>Set a new password</h1><form id="f">
    <label for="pw">New password</label><input id="pw" name="password" type="password" minlength="8" required autocomplete="new-password">
    <button class="btn block">Save password</button></form></div>`);
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    const { error } = await sb.auth.updateUser({ password: formData(e.target).password });
    if (error) return toast(error.message, true);
    toast('Password updated'); go('#/');
  };
}

// ---------------- router ----------------
let learner, admin, docs;
export async function render() {
  const h = location.hash || '#/';
  if (h === '#/newpass') return newPasswordView();
  if (!state.user) {
    await renderTopbar();
    return h === '#/join' ? joinView() : loginView();
  }
  await renderTopbar();
  const role = state.profile?.role;
  if (h.startsWith('#/doc/')) { docs ||= await import('./documents.js'); return docs.route(h); }
  if (role === 'admin') { admin ||= await import('./admin.js'); return admin.route(h); }
  if (role === 'learner') { learner ||= await import('./learner.js'); return learner.route(h); }
  view(`<div class="card narrow center"><h1>Account pending</h1><p>Your account has been created but hasn't been given access yet. Please contact your trainer.</p></div>`);
}

async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  state.user = session?.user || null;
  state.profile = null;
  if (state.user) {
    const { data } = await sb.from('profiles').select('*').eq('id', state.user.id).maybeSingle();
    state.profile = data;
    try { state.org = localStorage.getItem('orgFilter') || ''; } catch {}
    if (['#/login', '#/join'].includes(location.hash)) location.hash = '#/';
  }
  await render();
}

sb.auth.onAuthStateChange((event) => {
  if (event === 'PASSWORD_RECOVERY') location.hash = '#/newpass';
});
window.addEventListener('hashchange', () => render().catch(console.error));

if (SUPABASE_URL.includes('YOUR-PROJECT')) {
  view(`<div class="card narrow"><h1>Almost there</h1><p>Open <code>js/config.js</code> and paste in your Supabase project URL and publishable (anon) key. See README step 3.</p></div>`);
} else {
  boot().catch((e) => { console.error(e); view(`<div class="card narrow notice bad">Could not load: ${esc(e.message)}</div>`); });
}
