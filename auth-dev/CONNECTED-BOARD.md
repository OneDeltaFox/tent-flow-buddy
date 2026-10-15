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

## Verification

Run `npx tsc --project tsconfig.auth.json`, `npx vite build --config vite.auth.config.ts`, `npm run build:pages`, and `npx playwright test --config playwright.auth.config.ts`. Database tests run with `node --test tests/foundation.test.mjs` from `database/`. They use a disposable local database, not hosted patient data.

## Remaining boundaries

- Refresh is explicit, and automatic after successful commands. Realtime multi-device updates are not implemented yet.
- Pod renaming/deletion, event renaming, reset, and End Race remain unavailable in connected mode. Pod status/capability editing and section additions require migration 008 to be installed.
- Viewers do not yet have the patient status-board projection wired into this entry.
- No live patient data was imported. Hosted verification confirmed authenticated snapshot loading; mutation workflows were tested with mocks and the local SQL harness, not by inserting patients into the user's race.
- Known dependency advisories and bundle-size warnings still need release review. This is a development preview, not a production release.
