begin;
-- Keep only the reset receipt after deletion, so retries and next-day startup remain safe.
alter table race_private.daily_reports alter column totals drop not null;
alter table race_private.daily_reports add column deleted_at timestamptz;
alter table race_private.daily_reports add constraint report_deletion_consistent
  check ((totals is null) = (deleted_at is not null));

create function public.delete_race_report(p_race uuid,p_report uuid,p_confirm text) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform 1 from race_private.races where id=p_race for update;
  if coalesce(race_private.access_level(p_race),'') <> 'owner' then raise exception 'Access denied' using errcode='42501'; end if;
  if p_confirm is distinct from 'DELETE REPORT' then raise exception 'Confirmation required'; end if;
  if not exists(select 1 from race_private.daily_reports where race_id=p_race and id=p_report) then raise exception 'Report unavailable'; end if;
  update race_private.daily_reports set totals=null,deleted_at=clock_timestamp()
    where race_id=p_race and id=p_report and deleted_at is null;
end $$;
revoke all on function public.delete_race_report(uuid,uuid,text) from public,anon;
grant execute on function public.delete_race_report(uuid,uuid,text) to authenticated;

create or replace function public.race_daily_reports(p_race uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if coalesce(race_private.access_level(p_race),'') <> 'owner' then raise exception 'Access denied' using errcode='42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',id,'generated_at',generated_at,'totals',totals) order by generated_at desc)
    from race_private.daily_reports where race_id=p_race and deleted_at is null),'[]'::jsonb);
end $$;

create or replace function public.end_race_preview(p_race uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare token text; current_generation integer; report jsonb;
begin
  perform 1 from race_private.races where id=p_race for update;
  if coalesce(race_private.access_level(p_race),'') <> 'owner' then raise exception 'Access denied' using errcode='42501'; end if;
  select reset_generation into current_generation from race_private.races where id=p_race;
  select md5(current_generation::text || coalesce(string_agg(id::text || ':' || revision::text,',' order by id),'')) into token from race_private.visits where race_id=p_race;
  select to_jsonb(r) - 'race_id' - 'generated_at' - 'version' into report from race_private.report_preview(p_race) r;
  return jsonb_build_object('token',token,'generation',current_generation,'total',report->'total_visits','active',report->'incomplete_visits',
    'state',(select state from race_private.races where id=p_race),
    'last_report_id',(select id from race_private.daily_reports where race_id=p_race and generation=current_generation-1));
end $$;
commit;
