# End Race development implementation

Migration 014 is not automatically deployed. No hosted race has been reset by development tests.

Owner opens End Race / Reports, reviews record counts, types END RACE, and explicitly acknowledges unresolved patients if any. Server checks ownership, locks the race, and rejects a stale patient revision preview. It atomically saves fixed aggregate fields, deletes patient details/visits/placements/reservations/events/turnover histories, clears cleaning, opens pods and pools, and closes the race. Names, colors, capacities, capabilities, account memberships, invitations, and team audit records remain. Account/contact information is not patient data and is not purged by this command.

Unresolved visits remain incomplete in the report; the operation does not fabricate a discharge or duration. Timing means/medians with fewer than five samples are withheld. These safeguards reduce disclosure but are not certification of legal de-identification. Report recipients and metadata require organizational approval.

Reports are owner-only and persist across daily resets. Start Next Day explicitly reactivates the same layout. A retry of an old successful reset returns its original report without deleting a later day's records.

Email Report opens a mailto draft with selected recipients and aggregate fields only. The user sends through their own email application; this implementation does not send automatically through Resend. Email failure cannot roll back deletion. Automatic delivery requires a separate authenticated server function and delivery configuration.

Not implemented here: seven-day scheduled deletion, provider backup/log erasure, remote device secure erasure, or automated email delivery. Reset removes active database patient records, not every copy in provider backups or already exported files. Do not describe it as complete erasure of all PII everywhere.

Before hosted activation: install migration 014 with approval, deploy UI, and rehearse with fictional data on multiple devices. Existing clients with open patient dialogs must refresh after a reset; server-side commands reject writes while closed and edits of removed visits. No real patient use is authorized by these tests.
