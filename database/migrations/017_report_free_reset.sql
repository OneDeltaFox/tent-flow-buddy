begin;
-- Operational receipts contain no patient data, counts, or durations.
create table race_private.race_resets (
  id uuid primary key default gen_random_uuid(),
  race_id uuid not null references race_private.races(id),
  generation integer not null,
  unique(race_id,generation)
);
alter table race_private.race_resets enable row level security;
revoke all on race_private.race_resets from public,anon,authenticated;
-- Preserve retry/startup compatibility for days ended before this migration.
insert into race_private.race_resets(id,race_id,generation)
  select id,race_id,generation from race_private.daily_reports;

create or replace function public.end_race_preview(p_race uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare token text; current_generation integer; total integer; active integer;
begin
  perform 1 from race_private.races where id=p_race for update;
  if coalesce(race_private.access_level(p_race),'') <> 'owner' then raise exception 'Access denied' using errcode='42501'; end if;
  select reset_generation into current_generation from race_private.races where id=p_race;
  select md5(current_generation::text || coalesce(string_agg(id::text || ':' || revision::text,',' order by id),'')),
    count(*)::integer,count(*) filter(where dispositioned_at is null)::integer
    into token,total,active from race_private.visits where race_id=p_race;
  return jsonb_build_object('token',token,'generation',current_generation,'total',total,'active',active,
    'report_free',true,'state',(select state from race_private.races where id=p_race),
    'last_reset_id',(select id from race_private.race_resets where race_id=p_race and generation=current_generation-1));
end $$;

create or replace function public.end_race(p_race uuid,p_token text,p_generation integer,p_confirm text,p_allow_active boolean default false) returns uuid
language plpgsql security definer set search_path='' as $$
declare preview jsonb; result uuid;
begin
  perform 1 from race_private.races where id=p_race for update;
  if coalesce(race_private.access_level(p_race),'') <> 'owner' then raise exception 'Access denied' using errcode='42501'; end if;
  if p_confirm is distinct from 'END RACE' then raise exception 'Confirmation required'; end if;
  select id into result from race_private.race_resets where race_id=p_race and generation=p_generation;
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

-- Keep the existing RPC argument name for compatibility with older clients.
create or replace function public.start_next_race_day(p_race uuid,p_report uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform 1 from race_private.races where id=p_race for update;
  if coalesce(race_private.access_level(p_race),'') <> 'owner' then raise exception 'Access denied' using errcode='42501'; end if;
  if not exists(select 1 from race_private.race_resets d join race_private.races r on r.id=d.race_id
    where r.id=p_race and d.id=p_report and d.generation=r.reset_generation-1 and r.state='closed') then raise exception 'Refresh race before starting'; end if;
  update race_private.races set state='active' where id=p_race;
end $$;

-- Disable reporting even for stale clients and the previously deployed email function.
revoke execute on function public.race_daily_reports(uuid),public.claim_report_email(uuid,uuid,uuid),
  public.delete_race_report(uuid,uuid,text),race_private.report_preview(uuid) from public,anon,authenticated;
commit;
