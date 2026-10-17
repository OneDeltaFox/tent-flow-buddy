# Database foundation (development only)

This is an isolated prototype, not a hosted backend or a production-ready migration.
It does not change the app, expose RPCs, connect auth, deploy SQL, or enable End Race.
No real patient data belongs in this test environment.

## Agreed rules

- The initial owner is the user; ownership is per race, not hard-coded to one email.
- Start with one editor, design for roughly 5-10. Invite-only race memberships.
- Owner controls setup/access/close; editors manage visits; viewers only see a restricted board.
- Notification-to-arrival: Incoming notification to arrival. Entering Incoming does not start medical time.
- Time in Medical: first bed assignment through disposition, unchanged by transfers.
- Assignment implies arrival if it has not been marked. Direct entry has no invented notification time.
- Pool Time: each pool placement until exit/disposition, concurrent with Time in Medical.
- Repeated pool intervals accumulate for the visit. Direct-to-pool assignment starts both clocks.
- No waiting-for-a-bed metric. Triage defaults to Untriaged, never inferred from complaint or bed.
- Open/occupied/cleaning is independent of triage. Pools have an explicit kind, not a name heuristic.
- End Race stays disabled. Reporting retains aggregate performance, not individual rows/timelines.

## What is implemented

1. `001_foundation.sql`: race ownership/memberships, pods, beds, visits, private details,
   placement intervals, turnover intervals, minimal activity events, fixed aggregate report columns.
2. `002_commands.sql`: arrival, assignment/transfer, disposition, ready-bed, and restricted
   status-board query. Commands use server time, a race-level transaction lock, and visit revisions.
3. `003_report_preview.sql`: owner-only, read-only combined totals and mean/median timings.
   It does not save a report or delete anything.

All tables have RLS. Authenticated clients have SELECT only; mutations are checked functions.
Viewer queries do not expose raw visit/detail/history tables. The status-board function exposes
only beds, bib, triage, complaint, and display clock timestamps. It excludes notes/source/ETA.
The schema is private and must NOT be added to an API exposed-schema list. Future public wrappers
will be narrowly scoped and tested. Never put a service-role key in the frontend.

Functions pin their search_path and explicitly check membership, including after acquiring locks.
The function owner is privileged: trusted migration administrators must own these functions.
All future setup/membership/close commands must acquire the same race lock. Direct administrative
SQL is trusted, not an application API, and can bypass command invariants/RLS.

One partial unique index prevents two active placements per bed; another prevents two beds per
visit. Compound foreign keys prevent cross-race links. A stale revision fails with SQLSTATE 40001;
the client must refetch and ask the user to retry, NOT automatically replay a stale move. A retried
successful request also fails as stale, avoiding duplicate moves/events. Ready requires the current
turnover ID so a delayed click cannot clear a later turnover cycle.

The prototype conservatively marks the vacated bed cleaning on transfers as well as disposition.
Confirm that operational choice during integration; the current demo is unchanged.

## Run locally

```sh
cd database
npm ci
npm test
```

The default uses an ephemeral PGlite PostgreSQL engine. It tests actual SQL, not a JS model of SQL.
The real simultaneous-client test is skipped locally because PGlite is single-connection.
The separate GitHub Actions workflow runs the same suite against PostgreSQL 17 with two clients.
It never connects to a hosted project or deploys the app.

For a disposable PostgreSQL instance, set DATABASE_TEST_URL to a database named `tent_flow_test`.
The harness refuses any other database name and refuses pre-existing auth/race_private schemas.
It creates a test-only auth shim; this validates database authorization, NOT JWT verification,
Supabase Auth itself, invitation delivery, or the browser/API integration.

## Future development project setup

After choosing a provider and creating a dedicated fictional-data project:

1. Review SQL in order and apply with a trusted migration account to a fresh development database.
   These files assume Supabase auth.users/auth.uid and authenticated role already exist.
   Do not install the test auth shim in Supabase or a real system.
2. Bootstrap the first owner through a trusted administrative process after verifying their auth ID.
   No self-service owner escalation or public race creation is provided here.
3. Implement owner-only race/pod/membership commands and editor visit-creation/detail-edit commands.
4. Add narrow API wrappers, sign-in, invitation handling, and a revocation-aware realtime feed.
5. Adapt the app, run permission and concurrent-device rehearsals, then review production readiness.

The SQL is deliberately not installed by the Pages workflow. Never point this test suite at production.

## Report semantics

- Total visits counts encounters, not unique people or unique bibs. Repeat visits are separate.
- Completed means dispositioned; incomplete remains explicit and is not assigned a zero duration.
- Notification samples require both notification and arrival, even if the visit is still active.
- Medical samples require a first bed assignment and disposition.
- Pool samples count completed visits with pool use, summing their pool intervals before averaging.
  Non-pool visits are excluded, not recorded as zero pool time.
- Transfers count placements after the first. Disposition totals count categories only.
- Means/medians are in seconds. No samples returns NULL, not zero.
- The preview does not join complaint/bib/notes and returns no visit IDs or individual timestamps.
- Report race ID and generated-at are administrative metadata, not patient timeline timestamps.

## End Race design (not implemented)

Use a two-stage owner-only workflow. Present counts of active/unresolved visits and the exact
retention consequences. Require explicit confirmation tied to the current race and revision;
cancel/backdrop dismissal must do nothing. Do not silently disposition unresolved patients.
Acquire the race lock and revalidate access/state before finalization.

Calculate the fixed-schema report, validate totals/sample counts, insert the snapshot, and remove
patient-level details, placements, visits, patient-linked events, and turnover timing histories in
one database transaction. A failure must roll everything back. Mark the race closed and retain
the reusable layout. No deletion endpoint should exist before this full workflow is tested.

Storage backups, logs, cached browser data, exports, and realtime payloads are outside that SQL
transaction: their retention/invalidation needs a separate documented policy before activation.
Do not claim that deleting current rows erases backups. Do not store patient payloads in logs.

## Remaining decisions and work

- Hosted account/provider, region, production privacy requirements, backup retention and recovery.
- Unresolved/no-show arrivals at End Race: block closing by default until explicitly resolved.
- Exact pod occupancy curves, hourly arrival bins, peak incoming/census, turnover aggregates:
  specified next reporting pass, not yet included in report_preview or retained snapshots.
- Small hourly/pod groups may need suppression/coarser buckets before sharing reports.
- Setup and patient creation/edit APIs, safe pod closure/removal, display of notes, invitations,
  owner transfer, corrections/audit rules, export, report save/close, reconnect/conflict UX.
- Pod kind should not be changeable while occupied; completed placement kinds remain immutable.
- Local demo arrivedAt currently represents first bed placement, not reliably physical arrival.
  Do not fabricate missing notification/arrival history when importing old records.
- Decide whether restricted displays should omit complaint even though current design shows it.

## Reference documentation

- https://www.postgresql.org/docs/17/sql-createfunction.html (security-definer search_path)
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/database/functions
- https://pglite.dev/docs/api
