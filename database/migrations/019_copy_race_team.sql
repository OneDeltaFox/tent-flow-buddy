begin;
create function public.create_race_with_team(p_id uuid,p_name text,p_timezone text,p_source uuid,p_expected_team jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare existing_owner uuid; result uuid;
begin
  if auth.uid() is null or p_id is null or p_source is null then raise exception 'Access denied' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_id::text,0));
  select owner_id into existing_owner from race_private.races where id=p_id;
  -- A retry must never re-grant access removed after the original creation.
  if found then
    if existing_owner is distinct from auth.uid() then raise exception 'Access denied' using errcode='42501'; end if;
    return p_id;
  end if;
  perform 1 from race_private.races where id=p_source and owner_id=auth.uid() for update;
  if not found then raise exception 'Access denied' using errcode='42501'; end if;
  if p_expected_team is distinct from public.race_team(p_source) then
    raise exception 'Team changed; review again' using errcode='40001';
  end if;
  result := public.create_race(p_id,p_name,p_timezone,p_source);
  insert into race_private.memberships(race_id,user_id,role)
    select result,user_id,role from race_private.memberships where race_id=p_source and user_id<>auth.uid();
  insert into race_private.team_events(race_id,actor_id,user_id,old_role,new_role)
    select result,auth.uid(),user_id,null,role from race_private.memberships where race_id=result;
  return result;
end $$;
revoke all on function public.create_race_with_team(uuid,text,text,uuid,jsonb) from public,anon;
grant execute on function public.create_race_with_team(uuid,text,text,uuid,jsonb) to authenticated;
commit;
