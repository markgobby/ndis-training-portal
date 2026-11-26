import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY, BRAND, DEMO_INVITE_CODE, LEARNER_EMAIL_DOMAIN } from './config.js';
const learnerEmail = (u) => `${String(u).trim().toLowerCase()}@${LEARNER_EMAIL_DOMAIN}`;

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
  submitted_req: ['Submitted', 'info'], under_review: ['Under review', 'warn'], approved: ['Approved', 'ok'],
  awaiting_activation: ['Awaiting first login', 'warn'], skipped: ['Skipped', ''],
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
  if (!state.profile) {
    const loggedOut = !state.user;
    bar.innerHTML = `<div class="inner"><a class="title" href="#/">${esc(BRAND.name)}</a>${loggedOut ? `<nav class="pubnav"><a href="#/">Home</a><a href="#/login">Sign in</a><a href="#/activate">Begin learning</a><a href="#/org-signup">Organisations</a></nav>` : ''}</div>`;
    return;
  }
  const h = location.hash || '#/';
  if (state.profile.role === 'admin') {
    const orgs = must(await sb.from('organisations').select('id,name').order('name'));
    if (state.org && !orgs.some((o) => o.id === state.org)) state.org = '';
    const links = [['#/', 'Dashboard'], ['#/a/learners', 'Learners'], ['#/a/review', 'Review'], ['#/a/workbooks', 'Workbooks'],
      ['#/a/packages', 'Packages'], ['#/a/requests', 'Pack requests'], ['#/a/accounts', 'Accounts'], ['#/a/orgs', 'Organisations'], ['#/a/invites', 'Invite codes'], ['#/a/feedback', 'Feedback']];
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
  } else if (state.profile.role === 'organisation') {
    const links = [['#/', 'Dashboard'], ['#/o/learners', 'Learners'], ['#/o/requests', 'Pack requests']];
    bar.innerHTML = `<div class="inner"><a class="title" href="#/">${esc(BRAND.name)} · Organisation</a>
      <span class="small">${esc(state.profile.full_name || '')}</span>
      <button class="btn small" id="logout">Sign out</button>
      <nav>${links.map(([href, l]) => `<a href="${href}" class="${(href === '#/' ? h === '#/' : h.startsWith(href)) ? 'active' : ''}">${l}</a>`).join('')}</nav></div>`;
  } else {
    const guest = state.user?.is_anonymous;
    bar.innerHTML = `<div class="inner"><a class="title" href="#/">${esc(BRAND.name)}</a>
      <span class="small">${esc(state.profile.full_name || '')}</span>
      <button class="btn small" id="logout">${guest ? 'End demo' : 'Sign out'}</button></div>
      ${guest ? '<div class="guestbar">Demo mode: explore freely. Nothing you do here is real or kept.</div>' : ''}`;
  }
  $('#logout').onclick = async () => { await sb.auth.signOut(); state.profile = null; go('#/login'); };
}

// ---------------- auth screens ----------------
function loginView() {
  view(`<div class="card narrow">
    <h1>Sign in</h1>
    <form id="f">
      <label for="who">Username or email</label><input id="who" name="who" autocomplete="username" autocapitalize="none" spellcheck="false" required>
      <div class="small muted">Learners: your username, such as JohnSmith1. Organisations and trainers: your email.</div>
      <label for="pw">Password</label><input id="pw" name="password" type="password" autocomplete="current-password" required>
      <button class="btn block">Sign in</button>
    </form>
    <p class="center"><button class="linkbtn" id="forgot">Forgot password?</button></p>
    <hr style="border:0;border-top:1px solid var(--line)">
    <a class="btn secondary block center" href="#/activate">First time? Activate with a class code</a>
    <p class="center small" style="margin-top:1rem"><a href="#/org-signup">Organisation? Request an account</a></p>
    <p class="center small"><a href="#/">&larr; Back to home</a></p>
  </div>`);
  $('#f').onsubmit = async (e) => {
    e.preventDefault(); const d = formData(e.target); const who = d.who.trim();
    const email = who.includes('@') ? who : learnerEmail(who);
    const { error } = await sb.auth.signInWithPassword({ email, password: d.password });
    if (error) return toast(error.message === 'Invalid login credentials' ? 'Username or password not recognised' : error.message, true);
    await boot();
  };
  $('#forgot').onclick = async () => {
    const who = $('#who').value.trim();
    if (!who) return toast('Enter your username or email above first', true);
    if (!who.includes('@')) return toast('Learners: ask your organisation or trainer to reset your password.', true);
    const { error } = await sb.auth.resetPasswordForEmail(who, { redirectTo: location.origin + location.pathname });
    toast(error ? error.message : 'Check your email for a reset link', !!error);
  };
}

// First login: username + class code from the training day, then the learner sets their own password
function activateView() {
  view(`<div class="card narrow">
    <h1>Activate your account</h1>
    <p class="muted">Enter your username and the class code given at your training session.</p>
    <form id="f1">
      <label for="un">Username</label><input id="un" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required>
      <label for="cc">Class code</label><input id="cc" name="code" autocomplete="off" required style="text-transform:uppercase">
      <button class="btn block">Check</button>
    </form>
    <div id="step2"></div>
    <p class="center small"><a href="#/login">Already activated? Sign in</a> &middot; <a href="#/">Home</a></p>
  </div>`);
  $('#f1').onsubmit = async (e) => {
    e.preventDefault(); const d = formData(e.target);
    const [r] = must(await sb.rpc('check_activation', { p_username: d.username, p_code: d.code }), 'Could not check');
    if (!r?.valid) return toast(r?.message || 'Could not check those details', true);
    $('#f1').querySelectorAll('input,button').forEach((x) => (x.disabled = true));
    $('#step2').innerHTML = `<div class="notice info">Welcome <b>${esc(r.full_name)}</b><br>${esc(r.organisation_name)} · ${r.module_count} module${r.module_count === 1 ? '' : 's'}</div>
      <form id="f2">
        <label for="pw">Choose a password (at least 8 characters)</label><input id="pw" name="password" type="password" minlength="8" autocomplete="new-password" required>
        <label for="pw2">Repeat password</label><input id="pw2" name="password2" type="password" minlength="8" autocomplete="new-password" required>
        <div class="small muted">Keep it somewhere safe. There is no email reset: your organisation or trainer can set a new one.</div>
        <button class="btn block">Activate and sign in</button>
      </form>`;
    $('#f2').onsubmit = async (ev) => {
      ev.preventDefault(); const p = formData(ev.target);
      if (p.password !== p.password2) return toast('Passwords do not match', true);
      const btn = ev.target.querySelector('button'); btn.disabled = true;
      const { data, error } = await sb.auth.signUp({
        email: learnerEmail(d.username), password: p.password,
        options: { data: { username: d.username.trim(), class_code: d.code.trim() } },
      });
      btn.disabled = false;
      if (error) return toast(error.message.includes('Database error') ? 'Those details could not be used. Please check with your trainer.' : error.message, true);
      if (!data.session) { const r2 = await sb.auth.signInWithPassword({ email: learnerEmail(d.username), password: p.password }); if (r2.error) return toast(r2.error.message, true); }
      await boot();
    };
  };
}

// Organisation contacts request access; the trainer links the account to the organisation
function orgSignupView() {
  view(`<div class="card narrow">
    <h1>Organisation account</h1>
    <p class="muted">Request an account to submit training requests and see your learners' progress. The trainer will confirm your account before it can be used.</p>
    <form id="f">
      <label for="on">Organisation name</label><input id="on" name="org_name" required>
      <label for="fn">Your name</label><input id="fn" name="full_name" autocomplete="name" required>
      <label for="ph">Phone (optional)</label><input id="ph" name="phone" type="tel" autocomplete="tel">
      <label for="em">Email</label><input id="em" name="email" type="email" autocomplete="email" required>
      <label for="pw">Password (at least 8 characters)</label><input id="pw" name="password" type="password" minlength="8" autocomplete="new-password" required>
      <button class="btn block">Request account</button>
    </form>
    <p class="center small"><a href="#/login">Back to sign in</a> &middot; <a href="#/">Home</a></p>
  </div>`);
  $('#f').onsubmit = async (e) => {
    e.preventDefault(); const d = formData(e.target);
    const btn = e.target.querySelector('button'); btn.disabled = true;
    const { data, error } = await sb.auth.signUp({ email: d.email.trim(), password: d.password,
      options: { emailRedirectTo: location.origin + location.pathname, data: { full_name: d.full_name.trim(), phone: d.phone.trim(), org_name: d.org_name.trim() } } });
    btn.disabled = false;
    if (error) return toast(error.message, true);
    if (!data.session) return view(`<div class="card narrow center"><h1>Check your email</h1><p>We've sent a confirmation link to <b>${esc(d.email)}</b>. Confirm it, then sign in.</p><a class="btn" href="#/login">Go to sign in</a></div>`);
    await boot();
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
    <p class="center small"><a href="#/login">Already have an account? Sign in</a> &middot; <a href="#/">Home</a></p>
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
let learner, admin, orgMod, docs;
export async function render() {
  const h = location.hash || '#/';
  $('#app').classList.remove('landing');
  if (h === '#/newpass') return newPasswordView();
  if (h === '#/try') return tryDemo();
  if (!state.user) {
    await renderTopbar();
    if (h === '#/' || h === '') { const m = await import('./landing.js'); return m.landingView(); }
    return h === '#/join' ? joinView() : h === '#/activate' ? activateView() : h === '#/org-signup' ? orgSignupView() : loginView();
  }
  await renderTopbar();
  const role = state.profile?.role;
  if (h.startsWith('#/doc/')) { docs ||= await import('./documents.js'); return docs.route(h); }
  if (role === 'admin') { admin ||= await import('./admin.js'); return admin.route(h); }
  if (role === 'organisation') { orgMod ||= await import('./org.js'); return orgMod.route(h); }
  if (role === 'learner') { learner ||= await import('./learner.js'); return learner.route(h); }
  view(`<div class="card narrow center"><h1>Account pending</h1><p>Your account has been created but hasn't been approved yet. The trainer will link it to your organisation shortly.</p></div>`);
}

// Guest demo for presentations: a private, temporary learner account with no sign-up
async function tryDemo() {
  if (!DEMO_INVITE_CODE) { view('<div class="card narrow center"><h1>Demo not available</h1></div>'); return; }
  const { data: { session } } = await sb.auth.getSession();
  if (session) { location.replace('#/'); return boot(); }
  view('<div class="card narrow center"><h1>Setting up your demo…</h1><p class="muted">One moment.</p></div>');
  const n = String(Math.floor(1000 + Math.random() * 9000));
  const { error } = await sb.auth.signInAnonymously({ options: { data: { invite_code: DEMO_INVITE_CODE, full_name: `Guest ${n}` } } });
  if (error) {
    console.error(error);
    view(`<div class="card narrow center"><h1>Demo unavailable</h1><p>The guest demo isn't switched on right now. Please ask the presenter.</p>
      <p class="small muted">${esc(error.message)}</p></div>`);
    return;
  }
  location.replace('#/');
  await boot();
}

async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  state.user = session?.user || null;
  state.profile = null;
  if (state.user) {
    const { data } = await sb.from('profiles').select('*').eq('id', state.user.id).maybeSingle();
    state.profile = data;
    try { state.org = localStorage.getItem('orgFilter') || ''; } catch {}
    if (['#/login', '#/join', '#/activate', '#/org-signup'].includes(location.hash)) location.hash = '#/';
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
