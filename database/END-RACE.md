# End Race development implementation

## Current workflow: report-free reset (migration 017)

Supersedes the report workflows documented below. During the race, all patient tracking, live medical/pool timers, and disposition behavior remain unchanged. Owner-confirmed End Race deletes patient details, visits, movements, reservations, events, and turnover histories from active storage. It creates no report, counts snapshot, or timing summary. Beds and pools become ready, with layouts, capabilities, accounts, and team permissions preserved.

Only an operational receipt (random ID, race ID, reset generation) remains for idempotent retries and Start Next Day. Existing report IDs/generations are copied into this receipt table for compatibility with already-closed races. Old saved reports are not erased by installation; separate deletion approval would be needed. Report retrieval, preview, deletion, and report-email claim RPC permissions are revoked from application roles. The historical email function cannot claim a report and therefore cannot send one. Invitation emails are unaffected.

The UI refuses End Race unless the backend advertises report_free=true. Migration 017 was installed with owner approval in qcsmtulmugznciipxrfv (main PRODUCTION) on 2026-10-19. Verification confirmed reset receipt storage exists and report retrieval/email permissions are disabled. Installation did not end a race or clear patient data. This is an explicit end-of-day operation, not automatic deletion on browser close or a scheduled retention job. Provider backups/logs and previously exported or emailed copies are not erased.

## Historical implementation (superseded by 017)

## Report deletion (migration 015)

Owners can delete report totals after a dated confirmation. The server independently checks ownership and race/report association. It clears totals from active storage and hides the report from retrieval. A minimal receipt (report ID, race ID, generation, creation/deletion timestamps) remains to prevent repeated End Race calls from erasing another day and to allow Start Next Day after all reports have been deleted. Patient records, layout, and memberships are not modified. Emailed/exported copies and provider backups are unaffected. Unconfirmed failures require refreshing before retrying. Migration 015 was installed with approval in development on 2026-10-18; verification showed one report receipt and zero deleted reports. The UI ships with this change.

Migration 014 is not automatically deployed. No hosted race has been reset by development tests.

Owner opens End Race / Reports, reviews record counts, types END RACE, and explicitly acknowledges unresolved patients if any. Server checks ownership, locks the race, and rejects a stale patient revision preview. It atomically saves fixed aggregate fields, deletes patient details/visits/placements/reservations/events/turnover histories, clears cleaning, opens pods and pools, and closes the race. Names, colors, capacities, capabilities, account memberships, invitations, and team audit records remain. Account/contact information is not patient data and is not purged by this command.

Unresolved visits remain incomplete in the report; the operation does not fabricate a discharge or duration. Timing means/medians with fewer than five samples are withheld. These safeguards reduce disclosure but are not certification of legal de-identification. Report recipients and metadata require organizational approval.

Reports are owner-only and persist across daily resets. Start Next Day explicitly reactivates the same layout. A retry of an old successful reset returns its original report without deleting a later day's records.

Direct report email implementation: migration 016 and send-race-report replace the mailto handoff. Owners review recipients and confirm before the function claims a single-use attempt, reads the saved report server-side, and submits fixed aggregate fields to Resend. Maximum ten recipients and ten attempts per owner per hour. Unknown delivery outcomes are not automatically retried; check Resend logs before sending again. A provider acceptance is not proof of inbox delivery. No patient fields or arbitrary client-supplied report contents are accepted. Email failure cannot roll back End Race or alter the saved report.

Deployment: migration 016 and send-race-report are installed in qcsmtulmugznciipxrfv (main PRODUCTION), explicitly approved by the owner on 2026-10-18. RESEND_API_KEY was entered privately by the owner; INVITATION_APP_URL supplies the allowed app origin. Legacy gateway JWT validation is disabled; the handler validates Auth and the database enforces ownership. A live unsigned request returned 401 from the handler, confirming startup and configured secret presence. Installation sent no emails. Actual inbox delivery still requires an owner-confirmed test from the app. Never put the Resend key in VITE variables, Git, or chat.

Not implemented here: seven-day scheduled deletion, provider backup/log erasure, remote device secure erasure, or automatic scheduled reports. Reset removes active database patient records, not every copy in provider backups or already exported files. Do not describe it as complete erasure of all PII everywhere.

Before hosted activation: install migration 014 with approval, deploy UI, and rehearse with fictional data on multiple devices. Existing clients with open patient dialogs must refresh after a reset; server-side commands reject writes while closed and edits of removed visits. No real patient use is authorized by these tests.
