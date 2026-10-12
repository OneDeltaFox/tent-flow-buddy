begin;
-- Read-only preview. No snapshot is saved, no race closed, no data deleted.
create function race_private.report_preview(p_race uuid) returns setof race_private.reports
language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(race_private.access_level(p_race),'') <> 'owner' then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  return query
  with per_visit as (
    select v.*,
      case when v.notified_at is not null and v.arrived_at is not null
        then extract(epoch from v.arrived_at-v.notified_at)::double precision end as notification_seconds,
      case when v.medical_started_at is not null and v.dispositioned_at is not null
        then extract(epoch from v.dispositioned_at-v.medical_started_at)::double precision end as medical_seconds,
      -- One pool sample per completed visit, summing all pool intervals; exclude non-pool visits.
      (select sum(extract(epoch from pl.ended_at-pl.started_at))::double precision
        from race_private.placements pl where pl.visit_id=v.id and pl.kind='pool'
          and v.dispositioned_at is not null
          and not exists (select 1 from race_private.placements pending where pending.visit_id=v.id and pending.ended_at is null)
      ) as pool_seconds,
      greatest((select count(*) from race_private.placements pl where pl.visit_id=v.id)-1,0) as transfers
    from race_private.visits v where v.race_id=p_race
  )
  select p_race,1,statement_timestamp(),count(*)::integer,
    count(dispositioned_at)::integer,count(*) filter(where dispositioned_at is null)::integer,
    count(notification_seconds)::integer,avg(notification_seconds),percentile_cont(0.5) within group(order by notification_seconds),
    count(medical_seconds)::integer,avg(medical_seconds),percentile_cont(0.5) within group(order by medical_seconds),
    count(pool_seconds)::integer,avg(pool_seconds),percentile_cont(0.5) within group(order by pool_seconds),
    coalesce(sum(transfers),0)::integer,
    count(*) filter(where disposition='discharged')::integer,
    count(*) filter(where disposition='ems')::integer,
    count(*) filter(where disposition='other')::integer
  from per_visit;
end
$$;
revoke all on function race_private.report_preview(uuid) from public;
grant execute on function race_private.report_preview(uuid) to authenticated;
commit;
