import { BRAND, $, esc, view } from './app.js';

const ICON = {
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5v-16Z"/><path d="M4 21.5A2.5 2.5 0 0 1 6.5 19H20"/>',
  check: '<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h9"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  award: '<circle cx="12" cy="9" r="6"/><path d="M8.5 14.5 7 22l5-3 5 3-1.5-7.5"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m10.8 12.2 9.2-9.2M16 7l3 3"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.4 8.4 8 9 4.6-.6 8-4 8-9V6Z"/><path d="m9 12 2 2 4-4"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
};
const ic = (n) => `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n]}</svg>`;

const STEPS = [
  ['book', 'Workbook', 'Structured reading with practice questions, at the learner’s own pace.'],
  ['check', 'Knowledge assessment', 'Assessed questions, reviewed and marked by the trainer.'],
  ['eye', 'Practical assessment', 'Skills observed and recorded item by item by an assessor.'],
  ['award', 'Certificate', 'Issued once every stage is marked competent.'],
];
const BENEFITS = [
  ['chart', 'Clear progress tracking', 'See where every learner is up to, from first workbook to certificate.'],
  ['file', 'Complete training records', 'Printable report and certificate for each learner, ready for provider files.'],
  ['key', 'Simple access', 'Learners sign in with a username and class code. No email address needed.'],
  ['users', 'Packs for your team', 'Request training for several staff at once and choose the modules each person needs.'],
];

export function landingView() {
  const email = BRAND.contactEmail;
  $('#app').classList.add('landing');
  view(`
  <section class="hero">
    <div class="wrap hero-grid">
      <div>
        <p class="eyebrow">${esc(BRAND.tagline)}</p>
        <h1>Competency-based training for high intensity support workers</h1>
        <p class="lead">Workbooks, knowledge assessment, observed practical assessment and certification, in one place for your organisation.</p>
        <div class="cta-row">
          <a class="btn lg light" href="#/activate">Begin learning</a>
          <a class="btn lg ghost" href="#/login">Sign in</a>
        </div>
        <p class="hero-note">First time? Use the username and class code given at your training session.</p>
      </div>
      <div class="hero-panel" aria-label="Choose how to sign in">
        <h2>Where would you like to go?</h2>
        <a class="portal" href="#/activate"><span>${ic('book')}</span><b>Learner<small>Activate with a class code, or sign in</small></b></a>
        <a class="portal" href="#/login"><span>${ic('users')}</span><b>Organisation<small>Request training and view progress</small></b></a>
        <a class="portal" href="#/login"><span>${ic('shield')}</span><b>Trainer / assessor<small>Review, assess and certify</small></b></a>
      </div>
    </div>
  </section>

  <section class="band" id="how">
    <div class="wrap">
      <h2 class="sec">How it works</h2>
      <p class="sec-sub">Each stage opens only when the one before it is marked competent.</p>
      <ol class="steps4">
        ${STEPS.map(([i, t, d], n) => `<li>${ic(i)}<span class="num">Step ${n + 1}</span><h3>${t}</h3><p>${d}</p></li>`).join('')}
      </ol>
    </div>
  </section>

  <section class="band alt" id="providers">
    <div class="wrap">
      <h2 class="sec">For providers and organisations</h2>
      <p class="sec-sub">Everything you need to train, track and evidence your team’s competency.</p>
      <div class="feat">
        ${BENEFITS.map(([i, t, d]) => `<div class="feat-item">${ic(i)}<h3>${t}</h3><p>${d}</p></div>`).join('')}
      </div>
      <p class="center" style="margin-top:1.5rem"><a class="btn lg" href="#/org-signup">Request an organisation account</a></p>
    </div>
  </section>

  <section class="band" id="trust">
    <div class="wrap trust">
      <div>${ic('shield')}<h3>Assessor-verified competency</h3><p>Knowledge and practical results are marked and recorded by a qualified trainer and assessor.</p></div>
      <div>${ic('lock')}<h3>Privacy by design</h3><p>Learners use a username rather than a personal email. Records are held in an Australian (Sydney) database with access limited by role.</p></div>
      <div>${ic('file')}<h3>Built for NDIS high intensity supports</h3><p>Training content is written and approved by the trainer for the supports your team delivers.</p></div>
    </div>
  </section>

  <section class="cta-band">
    <div class="wrap center">
      <h2>Questions or want to see it in action?</h2>
      <p>Get in touch and we’ll walk you through the training pathway.</p>
      <a class="btn lg light" href="mailto:${esc(email)}?subject=${encodeURIComponent('Training enquiry')}">Contact us</a>
    </div>
  </section>

  <footer class="foot"><div class="wrap">
    <span>${esc(BRAND.name)}${BRAND.abn ? ` · ABN ${esc(BRAND.abn)}` : ''}</span>
    <span><a href="#/login">Sign in</a> · <a href="#/activate">Activate</a> · <a href="#/org-signup">Organisations</a></span>
  </div></footer>`);
}
