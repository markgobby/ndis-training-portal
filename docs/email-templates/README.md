# Auth email templates

Paste into Supabase: Authentication > Emails (Email Templates). Subjects:

- Reset password: `Reset your High Intensity Supports Training password` -> `reset-password.html`
- Confirm signup: `Confirm your High Intensity Supports Training account` -> `confirm-signup.html`

Set Site URL (Authentication > URL Configuration) to the live site so `{{ .SiteURL }}` is correct.
The sender name/address ("Supabase Auth") only changes with a custom SMTP provider (open item).
