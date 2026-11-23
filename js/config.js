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

export const BRAND = {
  name: 'High Intensity Supports Training',
  tagline: 'NDIS High Intensity Daily Personal Activities',
  trainerName: 'Your Name',
  trainerTitle: 'Trainer & Assessor',
  contactEmail: 'you@example.com',
  abn: '',              // optional, e.g. '12 345 678 901'
  logoUrl: '',          // optional, e.g. 'logo.png' placed next to index.html
};
