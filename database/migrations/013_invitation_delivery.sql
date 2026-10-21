begin;
alter table race_private.invitations add column email_attempted_at timestamptz;
alter table race_private.invitations add column email_attempted_by uuid references auth.users(id);

create function public.claim_invitation_email(p_race uuid, p_invitation uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_owner uuid; v_inv race_private.invitations;
begin
 -- Serialize sends by owner across all races before checking the hourly budget.
 perform 1 from auth.users where id=auth.uid() for update;
 select owner_id into v_owner from race_private.races where id=p_race for update;
 if auth.uid() is null or v_owner is distinct from auth.uid() then raise exception 'Access denied' using errcode='42501'; end if;
 select * into v_inv from race_private.invitations where id=p_invitation and race_id=p_race for update;
 if not found or v_inv.closed_at is not null or v_inv.expires_at<=clock_timestamp() then raise exception 'Invitation unavailable'; end if;
 if v_inv.email_attempted_at is not null then raise exception 'Email already attempted. Check delivery before creating another invitation.'; end if;
 if exists(select 1 from auth.users u where lower(u.email)=v_inv.email and
   (u.id=v_owner or exists(select 1 from race_private.memberships m where m.race_id=p_race and m.user_id=u.id))) then
   raise exception 'Account already has access';
 end if;
 if (select count(*) from race_private.invitations where email_attempted_by=auth.uid() and email_attempted_at>clock_timestamp()-interval '1 hour') >= 10 then
   raise exception 'Invitation email limit reached. Try again later.';
 end if;
 update race_private.invitations set email_attempted_at=clock_timestamp(),email_attempted_by=auth.uid() where id=p_invitation;
 return jsonb_build_object('email',v_inv.email);
end $$;
revoke all on function public.claim_invitation_email(uuid,uuid) from public,anon;
grant execute on function public.claim_invitation_email(uuid,uuid) to authenticated;

create or replace function public.race_invitations(p_race uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if coalesce(race_private.access_level(p_race),'') <> 'owner' then raise exception 'Access denied' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'email',i.email,'role',i.role,'expires_at',i.expires_at,'email_attempted_at',i.email_attempted_at) order by i.created_at)
 from race_private.invitations i where i.race_id=p_race and i.closed_at is null),'[]'::jsonb);
end $$;
commit;
