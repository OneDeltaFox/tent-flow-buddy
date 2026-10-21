begin;
alter table race_private.races add column reset_generation integer not null default 0;
create table race_private.daily_reports (
  id uuid primary key default gen_random_uuid(),
  race_id uuid not null references race_private.races(id),
  generation integer not null,
  generated_at timestamptz not null default clock_timestamp(),
  totals jsonb not null,
  unique(race_id,generation)
);
alter table race_private.daily_reports enable row level security;
revoke all on race_private.daily_reports from public,anon,authenticated;

create function public.end_race_preview(p_race uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare token text; generation integer; report jsonb;
begin
  perform 1 from race_private.races where id=p_race for update;
  if coalesce(race_private.access_level(p_race),'') <> 'owner' then raise exception 'Access denied' using errcode='42501'; end if;
  select reset_generation into generation from race_private.races where id=p_race;
  select md5(generation::text || coalesce(string_agg(id::text || ':' || revision::text,',' order by id),'')) into token from race_private.visits where race_id=p_race;
  select to_jsonb(r) - 'race_id' - 'generated_at' - 'version' into report from race_private.report_preview(p_race) r;
  return jsonb_build_object('token',token,'generation',generation,'total',report->'total_visits','active',report->'incomplete_visits','state',(select state from race_private.races where id=p_race));
end $$;

create function public.end_race(p_race uuid,p_token text,p_generation integer,p_confirm text,p_allow_active boolean default false) returns uuid
language plpgsql security definer set search_path='' as $$
declare preview jsonb; report jsonb; result uuid;
begin
  perform 1 from race_private.races where id=p_race for update;
  if coalesce(race_private.access_level(p_race),'') <> 'owner' then raise exception 'Access denied' using errcode='42501'; end if;
  if p_confirm is distinct from 'END RACE' then raise exception 'Confirmation required'; end if;
  -- A retried request returns its original report, never purges the next day.
  select id into result from race_private.daily_reports where race_id=p_race and generation=p_generation;
  if result is not null then return result; end if;
  preview := public.end_race_preview(p_race);
  if preview->>'state' <> 'active' then raise exception 'Race is not active'; end if;
  if p_generation is distinct from (preview->>'generation')::integer or p_token is distinct from preview->>'token' then
    raise exception 'Board changed. Review again.' using errcode='40001';
  end if;
  if (preview->>'active')::integer > 0 and p_allow_active is distinct from true then raise exception 'Active patients require confirmation'; end if;
  select to_jsonb(r) - 'race_id' - 'generated_at' - 'version' into report from race_private.report_preview(p_race) r;
  -- Small timing samples could reveal an individual's duration. Suppress below five.
  if (report->>'notification_samples')::integer < 5 then report := report || '{"notification_mean_seconds":null,"notification_median_seconds":null}'; end if;
  if (report->>'medical_samples')::integer < 5 then report := report || '{"medical_mean_seconds":null,"medical_median_seconds":null}'; end if;
  if (report->>'pool_samples')::integer < 5 then report := report || '{"pool_mean_seconds":null,"pool_median_seconds":null}'; end if;
  insert into race_private.daily_reports(race_id,generation,totals) values(p_race,p_generation,report) returning id into result;
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

create function public.race_daily_reports(p_race uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if coalesce(race_private.access_level(p_race),'') <> 'owner' then raise exception 'Access denied' using errcode='42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',id,'generated_at',generated_at,'totals',totals) order by generated_at desc) from race_private.daily_reports where race_id=p_race),'[]'::jsonb);
end $$;

create function public.start_next_race_day(p_race uuid,p_report uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform 1 from race_private.races where id=p_race for update;
  if coalesce(race_private.access_level(p_race),'') <> 'owner' then raise exception 'Access denied' using errcode='42501'; end if;
  if not exists(select 1 from race_private.daily_reports d join race_private.races r on r.id=d.race_id where r.id=p_race and d.id=p_report and d.generation=r.reset_generation-1 and r.state='closed') then raise exception 'Refresh race before starting'; end if;
  update race_private.races set state='active' where id=p_race;
end $$;
revoke all on function public.end_race_preview(uuid),public.end_race(uuid,text,integer,text,boolean),public.race_daily_reports(uuid),public.start_next_race_day(uuid,uuid) from public,anon;
grant execute on function public.end_race_preview(uuid),public.end_race(uuid,text,integer,text,boolean),public.race_daily_reports(uuid),public.start_next_race_day(uuid,uuid) to authenticated;
commit;
