# Development authentication checkpoint

This separate entry point is not included in the Pages demo or its deployment.
It implements email-link sign-in, SDK-managed callback/session refresh, local
sign-out, and a deliberately restricted account screen. It does not load patient
data, grant ownership, or provide race access.

## Local configuration

Create an ignored `.env.local` at the repository root containing:

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_PUBLIC_KEY
```

Only use the publishable key. Vite variables are public browser bundle contents.
Never use a service-role/secret key. No user email belongs in committed config.

Run `npx vite --config vite.auth.config.ts --host 127.0.0.1 --port 8083 --strictPort`.
Development URL: http://127.0.0.1:8083/
Build: `npx vite build --config vite.auth.config.ts` (output `dist-auth`).
Tests: `npx playwright test --config playwright.auth.config.ts` (mock Auth only).

## Remaining hosted setup

1. Configure exact development callback URL in Supabase before sending invitations.
   Do not redirect invitations to the public demo; it has no auth callback handler.
2. Disable public signups in Supabase as well as `shouldCreateUser: false` in the
   client. Client options alone do not enforce an invitation-only system.
3. Invite the owner, then verify a real email link and session in the same browser.
   PKCE sign-in links require the browser where the request originated.
4. Bootstrap race ownership separately with approval. Authentication is not a
   race permission; never infer owner access from an email in frontend code.
5. Implement restricted API integration and test owner/editor/viewer isolation.

No invitations or hosted settings were changed by this implementation. End Race
stays disabled. Real email delivery, invite callbacks, token refresh/revocation,
and hosted role isolation still need integration testing. Do not use for real
patient data yet. Existing database migrations were installed manually; reconcile
the migration baseline before adopting the Supabase CLI.

Dependency audit (2026-10-13): npm reports three affected dependencies outside
Supabase: brace-expansion (high), shell-quote (critical), source-map-js (high).
Review and update these before production deployment. No automatic broad dependency
upgrade was applied as part of the authentication work.
