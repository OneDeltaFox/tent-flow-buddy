begin;
create table race_private.invitations (
 id uuid primary key default gen_random_uuid(),
 race_id uuid not null references race_private.races(id),
 email text not null check(email=lower(trim(email)) and length(email) between 3 and 320),
 role text not null check(role in ('editor','viewer')),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null default (clock_timestamp()+interval '7 days'),
 closed_at timestamptz,
 accepted_by uuid references auth.users(id)
);
create unique index invitation_pending_email on race_private.invitations(race_id,email) where closed_at is null;
alter table race_private.invitations enable row level security;
revoke all on race_private.invitations from public,anon,authenticated;

create function public.race_invitations(p_race uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if coalesce(race_private.access_level(p_race),'') <> 'owner' then raise exception 'Access denied' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'email',i.email,'role',i.role,'expires_at',i.expires_at) order by i.created_at)
 from race_private.invitations i where i.race_id=p_race and i.closed_at is null),'[]'::jsonb);
end $$;

create function public.create_race_invitation(p_race uuid,p_email text,p_role text) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_owner uuid; v_id uuid; v_email text:=lower(trim(p_email));
begin
 select owner_id into v_owner from race_private.races where id=p_race for update;
 if auth.uid() is null or v_owner is distinct from auth.uid() then raise exception 'Access denied' using errcode='42501'; end if;
 if p_role is null or p_role not in ('editor','viewer') then raise exception 'Invalid role'; end if;
 if v_email is null or length(v_email) not between 3 and 320 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Invalid email'; end if;
 if exists(select 1 from auth.users u where lower(u.email)=v_email and (u.id=v_owner or exists(select 1 from race_private.memberships m where m.race_id=p_race and m.user_id=u.id))) then raise exception 'Account already has access'; end if;
 update race_private.invitations set closed_at=clock_timestamp() where race_id=p_race and email=v_email and closed_at is null and expires_at<=clock_timestamp();
 insert into race_private.invitations(race_id,email,role,created_by) values(p_race,v_email,p_role,auth.uid()) returning id into v_id;
 return v_id;
end $$;

create function public.cancel_race_invitation(p_race uuid,p_invitation uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v_owner uuid;
begin
 select owner_id into v_owner from race_private.races where id=p_race for update;
 if auth.uid() is null or v_owner is distinct from auth.uid() then raise exception 'Access denied' using errcode='42501'; end if;
 update race_private.invitations set closed_at=clock_timestamp() where id=p_invitation and race_id=p_race and closed_at is null;
 if not found then raise exception 'Invitation changed. Refresh.' using errcode='40001'; end if;
end $$;

create function public.my_race_invitations() returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'name',r.name,'role',i.role,'expires_at',i.expires_at) order by i.created_at),'[]'::jsonb)
 from race_private.invitations i join race_private.races r on r.id=i.race_id
 join auth.users u on u.id=auth.uid() and lower(u.email)=i.email and u.email_confirmed_at is not null
 where i.closed_at is null and i.expires_at>now();
$$;

create function public.accept_race_invitation(p_invitation uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v_inv race_private.invitations; v_owner uuid; v_email text;
begin
 select lower(email) into v_email from auth.users where id=auth.uid() and email_confirmed_at is not null;
 if v_email is null then raise exception 'Verified email required' using errcode='42501'; end if;
 select * into v_inv from race_private.invitations where id=p_invitation and email=v_email;
 if not found then raise exception 'Invitation unavailable' using errcode='42501'; end if;
 -- Use the same race-first lock order as membership changes and cancellation.
 select owner_id into v_owner from race_private.races where id=v_inv.race_id for update;
 select * into v_inv from race_private.invitations where id=p_invitation for update;
 if v_inv.closed_at is not null or v_inv.expires_at<=clock_timestamp() then raise exception 'Invitation unavailable'; end if;
 if v_owner=auth.uid() or exists(select 1 from race_private.memberships where race_id=v_inv.race_id and user_id=auth.uid()) then raise exception 'Account already has access'; end if;
 insert into race_private.memberships(race_id,user_id,role) values(v_inv.race_id,auth.uid(),v_inv.role);
 insert into race_private.team_events(race_id,actor_id,user_id,old_role,new_role) values(v_inv.race_id,auth.uid(),auth.uid(),null,v_inv.role);
 update race_private.invitations set closed_at=clock_timestamp(),accepted_by=auth.uid() where id=p_invitation;
end $$;
revoke all on function public.race_invitations(uuid),public.create_race_invitation(uuid,text,text),public.cancel_race_invitation(uuid,uuid),public.my_race_invitations(),public.accept_race_invitation(uuid) from public,anon;
grant execute on function public.race_invitations(uuid),public.create_race_invitation(uuid,text,text),public.cancel_race_invitation(uuid,uuid),public.my_race_invitations(),public.accept_race_invitation(uuid) to authenticated;
commit;
