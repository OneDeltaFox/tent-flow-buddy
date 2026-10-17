begin;
create table race_private.team_events (
 id uuid primary key default gen_random_uuid(), race_id uuid not null references race_private.races(id),
 actor_id uuid not null references auth.users(id), user_id uuid not null references auth.users(id),
 old_role text, new_role text, occurred_at timestamptz not null default clock_timestamp()
);
alter table race_private.team_events enable row level security;
revoke all on race_private.team_events from public,anon,authenticated;
create function public.race_team(p_race uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if coalesce(race_private.access_level(p_race),'') <> 'owner' then raise exception 'Access denied' using errcode='42501'; end if;
 return (select jsonb_agg(jsonb_build_object('id',t.user_id,'email',u.email,'role',t.role) order by t.role,u.email)
 from (select r.owner_id user_id,'owner'::text role from race_private.races r where r.id=p_race
 union all select m.user_id,m.role from race_private.memberships m join race_private.races r on r.id=m.race_id where m.race_id=p_race and m.user_id<>r.owner_id) t
 join auth.users u on u.id=t.user_id);
end $$;
create function public.set_race_member(p_race uuid,p_email text,p_expected_role text,p_role text) returns void
language plpgsql security definer set search_path='' as $$
declare owner_id uuid; target_id uuid; old_role text;
begin
 if coalesce(race_private.access_level(p_race),'') <> 'owner' then raise exception 'Access denied' using errcode='42501'; end if;
 select r.owner_id into owner_id from race_private.races r where r.id=p_race for update;
 if owner_id is distinct from auth.uid() then raise exception 'Access denied' using errcode='42501'; end if;
 if p_role is not null and p_role not in ('editor','viewer') then raise exception 'Invalid role'; end if;
 if p_expected_role is not null and p_expected_role not in ('editor','viewer') then raise exception 'Invalid expected role'; end if;
 if p_email is null or length(trim(p_email)) not between 3 and 320 then raise exception 'Invalid email'; end if;
 select u.id into target_id from auth.users u where lower(u.email)=lower(trim(p_email));
 if target_id is null then raise exception 'Account not found' using errcode='P0002'; end if;
 if target_id=owner_id then raise exception 'Owner access cannot be changed'; end if;
 select m.role into old_role from race_private.memberships m where m.race_id=p_race and m.user_id=target_id;
 if old_role is distinct from p_expected_role then raise exception 'Membership changed. Refresh and review again.' using errcode='40001'; end if;
 if old_role is not distinct from p_role then return; end if;
 if p_role is null then delete from race_private.memberships where race_id=p_race and user_id=target_id;
 else insert into race_private.memberships(race_id,user_id,role) values(p_race,target_id,p_role)
 on conflict(race_id,user_id) do update set role=excluded.role; end if;
 insert into race_private.team_events(race_id,actor_id,user_id,old_role,new_role) values(p_race,auth.uid(),target_id,old_role,p_role);
end $$;
revoke all on function public.race_team(uuid) from public,anon;
revoke all on function public.set_race_member(uuid,text,text,text) from public,anon;
grant execute on function public.race_team(uuid) to authenticated;
grant execute on function public.set_race_member(uuid,text,text,text) to authenticated;
commit;
