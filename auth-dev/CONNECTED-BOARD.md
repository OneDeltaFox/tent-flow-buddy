# Connected patient board

The development entry now renders the original TentBoard for owners/editors using a database snapshot and explicit command callbacks. It never loads or writes the demo's local patient storage. The public Pages entry still uses the browser-local demo.

## Database contract

Apply migrations 001 through 008 in order to a new development database. Migrations 007 and 008 were installed manually in the existing development project on October 14, 2026; do not replay them there. Migration 008 initially rolled back because of overlapping regular-pod numbers. With explicit owner approval, orange pods 11-20 and their bed labels were shifted to 14-23, preserving IDs and all patient/timing records, before the successful installation. Yellow pods and pools were unchanged. CLI migration tracking has not been reconciled.

- `patient_board`: owner/editor-only snapshot of layout, visits, placements, and active turnovers. Viewers continue using layout-only access.
- `save_patient`: create or revision-checked edit, optionally with atomic bed assignment. Uses server time, preserves medical start on moves, and defaults triage to untriaged. Incoming creation records notification; direct bed entry does not invent a prior notification.
- `move_patient`: checked assignment/disposition command using the existing serialized transition function.
- `ready_patient_bed`: requires the current turnover ID, preventing stale ready requests.

Anonymous execution is revoked. Mutations require owner/editor access and an active race on the server. No direct table writes are granted. Errors block further writes until refresh. Creation retries retain a UUID within the mounted board to avoid duplicating an uncertain submission.

## Pod administration

Migration 008 adds owner-only `update_pod`, `preview_section_pods`, and `add_section_pods` commands. The pod pencil opens a popup for closed/open status and multiple capabilities, followed by confirmation. Closing a pod prevents new assignments without removing existing patients.

Add pods offers existing color sections. Preview lists new pods and all shifted pod/bed labels; confirmation applies the complete change atomically. Stable bed IDs preserve placements and timers. Regular pod numbers are unique race-wide, while pools keep separate numbering. Existing sections must be contiguous and regular pod names numbered. Stale previews fail closed and require a fresh preview.

## Pool reservations

Migration 009 was installed manually in development on October 14, 2026. It adds protected bed reservations for subsequent regular-bed-to-pool moves; it does not infer reservations for preexisting pool placements. The original bed remains occupied/unavailable and displays "In pool". Census excludes the reservation copy. Pool-to-pool moves retain it; return releases it without turnover, while a different regular-bed assignment or disposition sends it to turnover. Physical placements remain singular and preserve separate pool intervals and the original medical start time. Reservation details are owner/editor-only; viewers receive occupied layout status without patient details through `race_layout`.

The connected development board supports reservations. The browser-local public demo retains its existing movement behavior; no public deployment was made.

## Verification

Run `npx tsc --project tsconfig.auth.json`, `npx vite build --config vite.auth.config.ts`, `npm run build:pages`, and `npx playwright test --config playwright.auth.config.ts`. Database tests run with `node --test tests/foundation.test.mjs` from `database/`. They use a disposable local database, not hosted patient data.

## Viewer Display Update

Migration 010 was installed manually in development on October 16, 2026. It supersedes the layout-only Viewer behavior described above: Viewers now open the shared StatusBoard using only `public.viewer_status`. The endpoint explicitly projects assigned race numbers, complaints, triage, medical/pool start times and reservation flags, with aggregate census, incoming, seen and disposition counts. Notes, source, ETA and discharged-patient details are excluded. No write access is added. Pods and beds use numeric display sorting without renumbering records. Failed Viewer reads clear the display and retry automatically.

Validation: 18 browser tests passed; local database suite passed 18 tests with the real concurrent-client test skipped. TypeScript and auth build passed. Desktop and phone screenshots checked. The connected Viewer still needs a real-device acceptance check after reloading the browser.

## Remaining boundaries

### Manage Team (October 17, 2026)

Migration 011 is installed in development. Active-race owners can open Race Settings > Manage Team to list members, add existing accounts by email, change Editor/Viewer roles, and remove race access. All writes require confirmation, compare the expected prior role under a race lock, and append a protected audit event. Owner access cannot be changed. Unknown accounts must first be created/invited in Supabase; this panel does not send email or provision accounts. Installation changed no memberships. Affected users should reload to pick up their new view; backend authorization applies to subsequent requests. Already displayed information cannot be recalled.

Validation: 19 browser tests passed, TypeScript and development build passed, and 19 local database tests passed with one real-concurrency test skipped. Phone screenshot checked. Real-device owner acceptance is pending. Changes have not yet been committed or pushed.

- Visible boards automatically reload their authorized snapshot every five seconds and on focus/network return. This is polling, not Supabase Realtime push. Refresh remains available and successful commands reload immediately. Automatic reads pause during dialogs, form focus, and pointer gestures; responses arriving during interaction are discarded to preserve the displayed revision. Failed background reads mark the patient board stale and block patient writes until a successful retry. Uncertain writes still require explicit refresh. Layout-only viewers poll only `race_layout`, never patient records.
- Pod renaming/deletion, event renaming, reset, and End Race remain unavailable in connected mode. Pod status/capability editing and section additions require migration 008 to be installed.
- Viewers do not yet have the patient status-board projection wired into this entry.
- No live patient data was imported. Hosted verification confirmed authenticated snapshot loading; mutation workflows were tested with mocks and the local SQL harness, not by inserting patients into the user's race.
- Known dependency advisories and bundle-size warnings still need release review. This is a development preview, not a production release.
