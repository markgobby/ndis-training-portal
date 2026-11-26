// =====================================================================
// EDIT THESE VALUES (see README step 3)
// Supabase dashboard > Project Settings > API
// =====================================================================
export const SUPABASE_URL = 'https://ouwpzpmjfsycoqhctuor.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_eDpjACIwYb5eT2BZgaQbGQ_P5q8Eqrg';

// Shown on screens, the post-training report and the certificate
// Guest demo: anyone opening <site>/#/try gets their own temporary learner account on this invite code.
// Needs "Allow anonymous sign-ins" turned on in Supabase (Authentication > Sign In / Providers).
// Set to '' to switch the guest demo off.
export const DEMO_INVITE_CODE = 'DEMO01';

// Learners sign in with a username, not an email. Supabase Auth still needs an email, so each username maps to a private
// internal address on this domain. It is never shown and never emailed to.
export const LEARNER_EMAIL_DOMAIN = 'learner.local';

export const BRAND = {
  name: 'High Intensity Supports Training',
  tagline: 'NDIS High Intensity Daily Personal Activities',
  trainerName: 'Your Name',
  trainerTitle: 'Trainer & Assessor',
  contactEmail: 'you@example.com',
  abn: '',              // optional, e.g. '12 345 678 901'
  logoUrl: '',          // optional, e.g. 'logo.png' placed next to index.html
};

// Defaults for new quotes. The trainer can edit all of these on each quote.
export const QUOTE_DEFAULTS = {
  gst_percent: 10,
  valid_days: 14,
  payment_terms: 'Payment is due within 14 days of the invoice date.',
  terms: 'This quote covers the training listed above. Class codes are issued once the quote is accepted. Prices are in Australian dollars.',
};
