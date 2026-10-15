# Connected patient board

The development entry now renders the original TentBoard for owners/editors using a database snapshot and explicit command callbacks. It never loads or writes the demo's local patient storage. The public Pages entry still uses the browser-local demo.

## Database contract

Apply migrations 001 through 007 in order to a new development database. Migration 007 was installed manually in the existing development project on October 14, 2026; do not replay it there. CLI migration tracking has not been reconciled.

- `patient_board`: owner/editor-only snapshot of layout, visits, placements, and active turnovers. Viewers continue using layout-only access.
- `save_patient`: create or revision-checked edit, optionally with atomic bed assignment. Uses server time, preserves medical start on moves, and defaults triage to untriaged. Incoming creation records notification; direct bed entry does not invent a prior notification.
- `move_patient`: checked assignment/disposition command using the existing serialized transition function.
- `ready_patient_bed`: requires the current turnover ID, preventing stale ready requests.

Anonymous execution is revoked. Mutations require owner/editor access and an active race on the server. No direct table writes are granted. Errors block further writes until refresh. Creation retries retain a UUID within the mounted board to avoid duplicating an uncertain submission.

## Verification

Run `npx tsc --project tsconfig.auth.json`, `npx vite build --config vite.auth.config.ts`, `npm run build:pages`, and `npx playwright test --config playwright.auth.config.ts`. Database tests run with `node --test tests/foundation.test.mjs` from `database/`. They use a disposable local database, not hosted patient data.

## Remaining boundaries

- Refresh is explicit, and automatic after successful commands. Realtime multi-device updates are not implemented yet.
- Existing pod editing/closing/deletion, event renaming, reset, and End Race are intentionally unavailable in connected mode until server commands exist.
- Viewers do not yet have the patient status-board projection wired into this entry.
- No live patient data was imported. Hosted verification confirmed authenticated snapshot loading; mutation workflows were tested with mocks and the local SQL harness, not by inserting patients into the user's race.
- Known dependency advisories and bundle-size warnings still need release review. This is a development preview, not a production release.
