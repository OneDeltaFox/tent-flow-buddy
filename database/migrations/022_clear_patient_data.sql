begin;
-- Distinguish retry receipts without storing patient information.
alter table race_private.race_resets add column action text not null default 'end' check(action in ('end','clear'));

create or replace function public.end_race(p_race uuid,p_token text,p_generation integer,p_confirm text,p_allow_active boolean default false) returns uuid
language plpgsql security definer set search_path='' as $$
declare preview jsonb; result uuid;
begin
  perform 1 from race_private.races where id=p_race for update;
  if coalesce(race_private.access_level(p_race),'') <> 'owner' then raise exception 'Access denied' using errcode='42501'; end if;
  if p_confirm is distinct from 'END RACE' then raise exception 'Confirmation required'; end if;
  select id into result from race_private.race_resets where race_id=p_race and generation=p_generation and action='end';
  if result is not null then return result; end if;
  preview := public.end_race_preview(p_race);
  if preview->>'state' <> 'active' then raise exception 'Race is not active'; end if;
  if p_generation is distinct from (preview->>'generation')::integer or p_token is distinct from preview->>'token' then
    raise exception 'Board changed. Review again.' using errcode='40001';
  end if;
  if (preview->>'active')::integer > 0 and p_allow_active is distinct from true then raise exception 'Active patients require confirmation'; end if;
  insert into race_private.race_resets(race_id,generation) values(p_race,p_generation) returning id into result;
  delete from race_private.bed_reservations where race_id=p_race;
  delete from race_private.events where race_id=p_race;
  delete from race_private.placements where race_id=p_race;
  delete from race_private.visit_details where race_id=p_race;
  delete from race_private.visits where race_id=p_race;
  delete from race_private.turnovers where race_id=p_race;
  update race_private.beds set cleaning=false where race_id=p_race;
  update race_private.pods set closed=false where race_id=p_race;
  update race_private.races set state='closed',reset_generation=reset_generation+1 where id=p_race;
  return result;
end $$;

create or replace function public.clear_race_patient_data(p_race uuid,p_token text,p_generation integer,p_confirm text,p_allow_active boolean default false) returns uuid
language plpgsql security definer set search_path='' as $$
declare preview jsonb; result uuid;
begin
  perform 1 from race_private.races where id=p_race for update;
  if coalesce(race_private.access_level(p_race),'') <> 'owner' then raise exception 'Access denied' using errcode='42501'; end if;
  if p_confirm is distinct from 'CLEAR DATA' then raise exception 'Confirmation required'; end if;
  select id into result from race_private.race_resets where race_id=p_race and generation=p_generation and action='clear';
  if result is not null then return result; end if;
  preview := public.end_race_preview(p_race);
  if preview->>'state' <> 'active' then raise exception 'Race is not active'; end if;
  if p_generation is distinct from (preview->>'generation')::integer or p_token is distinct from preview->>'token' then
    raise exception 'Board changed. Review again.' using errcode='40001';
  end if;
  if (preview->>'active')::integer > 0 and p_allow_active is distinct from true then raise exception 'Active patients require confirmation'; end if;
  insert into race_private.race_resets(race_id,generation,action) values(p_race,p_generation,'clear') returning id into result;
  delete from race_private.bed_reservations where race_id=p_race;
  delete from race_private.events where race_id=p_race;
  delete from race_private.placements where race_id=p_race;
  delete from race_private.visit_details where race_id=p_race;
  delete from race_private.visits where race_id=p_race;
  delete from race_private.turnovers where race_id=p_race;
  update race_private.beds set cleaning=false where race_id=p_race;
  update race_private.races set reset_generation=reset_generation+1 where id=p_race;
  return result;
end $$;

create or replace function public.start_next_race_day(p_race uuid,p_report uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform 1 from race_private.races where id=p_race for update;
  if coalesce(race_private.access_level(p_race),'') <> 'owner' then raise exception 'Access denied' using errcode='42501'; end if;
  if not exists(select 1 from race_private.race_resets d join race_private.races r on r.id=d.race_id
    where r.id=p_race and d.id=p_report and d.generation=r.reset_generation-1 and r.state='closed' and d.action='end') then raise exception 'Refresh race before starting'; end if;
  update race_private.races set state='active' where id=p_race;
end $$;


revoke all on function public.clear_race_patient_data(uuid,text,integer,text,boolean) from public,anon;
grant execute on function public.clear_race_patient_data(uuid,text,integer,text,boolean) to authenticated;
commit;

