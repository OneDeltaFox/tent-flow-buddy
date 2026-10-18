# Invitation email deployment

This is development functionality. Install migration 013 before enabling the UI.

1. Apply `013_invitation_delivery.sql` to the development project.
2. Deploy `supabase/functions/send-race-invitation` with both index.ts and handler.mjs.
3. Set server secret `INVITATION_APP_URL=https://triagedesk-test.pages.dev/`.
4. The function uses Supabase's injected URL, anon key and service-role key. Never
   put the service-role key in Vite variables, Cloudflare frontend settings or git.
5. Disable the gateway legacy-JWT check for this function as configured in
   supabase/config.toml. Every POST is independently authenticated by Auth.getUser
   and then authorized by the owner-only database claim. Anonymous requests fail.
6. Build/deploy the authenticated frontend only after the function is ready.

SMTP stays in Supabase Auth; no second Resend key is needed. New accounts use
inviteUserByEmail; an explicit existing-account Auth error falls back to an email
OTP link with account creation disabled. No error details, keys or links are logged.
No patient information or race name is included in outbound messages.

The server owns the redirect destination; request bodies accept only raceId and
invitationId. Allowlist the exact destination in Supabase Auth URL configuration.
Use the testing hostname until the custom hostname works. Changing the app origin
requires updating this secret and Auth redirects together.

One email attempt per invitation, at most 10 per owner/hour across races. Claims
are committed before email I/O. A crash or uncertain result is never automatically
retried. The owner refreshes and checks Auth/Resend delivery logs before canceling
and recreating an invitation. Canceling removes race access eligibility, not an
already sent authentication link or the recipient's account.

Provider acceptance is not inbox delivery. Test brand-new and existing verified
accounts in a separate browser, confirm matching-email acceptance and Viewer-only
access, and test canceled/expired invitations. Email links may expire sooner than
the seven-day race invitation; existing users can request a fresh sign-in link.

Tests: node --test tests/invitation-handler.test.mjs database/tests/foundation.test.mjs
Frontend: npx tsc --project tsconfig.auth.json; npx vite build --config vite.auth.config.ts
Browser: npx playwright test --config playwright.auth.config.ts auth-dev/tests/invitations.spec.ts
