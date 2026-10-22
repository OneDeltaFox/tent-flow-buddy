begin;

-- Race ownership deliberately remains restrictive: transfer ownership before deletion.
alter table race_private.memberships drop constraint memberships_user_id_fkey;
alter table race_private.memberships add constraint memberships_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

alter table race_private.events alter column actor_id drop not null;
alter table race_private.events drop constraint events_actor_id_fkey;
alter table race_private.events add constraint events_actor_id_fkey
  foreign key (actor_id) references auth.users(id) on delete set null;

alter table race_private.team_events alter column actor_id drop not null;
alter table race_private.team_events drop constraint team_events_actor_id_fkey;
alter table race_private.team_events add constraint team_events_actor_id_fkey
  foreign key (actor_id) references auth.users(id) on delete set null;

alter table race_private.team_events alter column user_id drop not null;
alter table race_private.team_events drop constraint team_events_user_id_fkey;
alter table race_private.team_events add constraint team_events_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete set null;

alter table race_private.invitations alter column created_by drop not null;
alter table race_private.invitations drop constraint invitations_created_by_fkey;
alter table race_private.invitations add constraint invitations_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;

alter table race_private.invitations alter column accepted_by drop not null;
alter table race_private.invitations drop constraint invitations_accepted_by_fkey;
alter table race_private.invitations add constraint invitations_accepted_by_fkey
  foreign key (accepted_by) references auth.users(id) on delete set null;

alter table race_private.invitations alter column email_attempted_by drop not null;
alter table race_private.invitations drop constraint invitations_email_attempted_by_fkey;
alter table race_private.invitations add constraint invitations_email_attempted_by_fkey
  foreign key (email_attempted_by) references auth.users(id) on delete set null;

alter table race_private.report_email_attempts alter column owner_id drop not null;
alter table race_private.report_email_attempts drop constraint report_email_attempts_owner_id_fkey;
alter table race_private.report_email_attempts add constraint report_email_attempts_owner_id_fkey
  foreign key (owner_id) references auth.users(id) on delete set null;

-- Email-based invitations must not survive account deletion and enable re-entry.
create function race_private.remove_deleted_account_invitations() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  delete from race_private.invitations
  where email=lower(trim(old.email)) or accepted_by=old.id or created_by=old.id;
  return old;
end $$;
revoke all on function race_private.remove_deleted_account_invitations() from public,anon,authenticated;
create trigger triagedesk_account_deletion
before delete on auth.users for each row
execute function race_private.remove_deleted_account_invitations();

commit;

