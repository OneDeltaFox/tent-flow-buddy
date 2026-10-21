begin;
create function race_private.transition_visit(
  p_visit uuid, p_revision integer, p_action text,
  p_bed uuid default null, p_category text default null, p_other text default null
) returns integer language plpgsql security definer set search_path = '' as $$
declare
  v race_private.visits;
  destination record;
  previous race_private.placements;
  race uuid;
  race_state text;
  stamp timestamptz;
begin
  select race_id into race from race_private.visits where id = p_visit;
  if race is null or coalesce(race_private.access_level(race), '') not in ('owner','editor') then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  -- Serialize commands within this small race; all future setup/close commands must use this same lock.
  select state into race_state from race_private.races where id = race for update;
  if coalesce(race_private.access_level(race),'') not in ('owner','editor') then raise exception 'Access denied' using errcode = '42501'; end if;
  if race_state <> 'active' then raise exception 'Race is not active'; end if;
  select * into v from race_private.visits where id = p_visit for update;
  if p_revision is null or v.revision <> p_revision then raise exception 'Stale visit; refresh before retrying' using errcode = '40001'; end if;
  if v.dispositioned_at is not null then raise exception 'Visit already dispositioned'; end if;
  stamp := clock_timestamp();
  if p_action = 'arrived' then
    if v.arrived_at is not null then raise exception 'Arrival already recorded'; end if;
    update race_private.visits set arrived_at = stamp where id = p_visit;
  elsif p_action = 'assigned' then
    select b.id, b.cleaning, p.closed, p.kind into destination
      from race_private.beds b join race_private.pods p on p.id = b.pod_id
      where b.id = p_bed and b.race_id = race;
    if not found then raise exception 'Bed unavailable'; end if;
    if destination.closed or destination.cleaning or exists (
      select 1 from race_private.placements where bed_id = p_bed and ended_at is null
    ) then raise exception 'Bed unavailable'; end if;
    select * into previous from race_private.placements where visit_id = p_visit and ended_at is null;
    if found then
      update race_private.placements set ended_at = stamp where id = previous.id;
      update race_private.beds set cleaning = true where id = previous.bed_id;
      insert into race_private.turnovers(race_id,bed_id,started_at) values (race,previous.bed_id,stamp);
    end if;
    insert into race_private.placements(race_id,visit_id,bed_id,kind,started_at)
      values (race,p_visit,p_bed,destination.kind,stamp);
    update race_private.visits set arrived_at = coalesce(arrived_at,stamp),
      medical_started_at = coalesce(medical_started_at,stamp) where id = p_visit;
  elsif p_action = 'dispositioned' then
    if p_category is null or p_category not in ('discharged','ems','other') then raise exception 'Invalid disposition'; end if;
    if p_category = 'other' and coalesce(length(trim(p_other)),0) = 0 then raise exception 'Other description required'; end if;
    select * into previous from race_private.placements where visit_id = p_visit and ended_at is null;
    if found then
      update race_private.placements set ended_at = stamp where id = previous.id;
      update race_private.beds set cleaning = true where id = previous.bed_id;
      insert into race_private.turnovers(race_id,bed_id,started_at) values (race,previous.bed_id,stamp);
    end if;
    update race_private.visits set disposition = p_category, dispositioned_at = stamp where id = p_visit;
    update race_private.visit_details set other_disposition = case when p_category = 'other' then trim(p_other) else null end where visit_id = p_visit;
  else
    raise exception 'Invalid action';
  end if;
  update race_private.visits set revision = revision + 1 where id = p_visit;
  insert into race_private.events(race_id,visit_id,bed_id,actor_id,action,occurred_at)
    values (race,p_visit,case when p_action = 'assigned' then p_bed else null end,auth.uid(),p_action,stamp);
  return v.revision + 1;
end
$$;

create function race_private.ready_bed(p_bed uuid, p_turnover uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare race uuid; race_state text; stamp timestamptz;
begin
  select race_id into race from race_private.beds where id = p_bed;
  if race is null or coalesce(race_private.access_level(race),'') not in ('owner','editor') then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  select state into race_state from race_private.races where id = race for update;
  if coalesce(race_private.access_level(race),'') not in ('owner','editor') then raise exception 'Access denied' using errcode = '42501'; end if;
  if race_state <> 'active' then raise exception 'Race is not active'; end if;
  if not exists (select 1 from race_private.turnovers where id = p_turnover and bed_id = p_bed and ended_at is null) then
    raise exception 'Stale turnover; refresh before retrying' using errcode = '40001';
  end if;
  stamp := clock_timestamp();
  update race_private.turnovers set ended_at = stamp where id = p_turnover;
  update race_private.beds set cleaning = false where id = p_bed;
  insert into race_private.events(race_id,bed_id,actor_id,action,occurred_at) values (race,p_bed,auth.uid(),'ready',stamp);
end
$$;

-- Restricted status display contract: no notes, source, ETA, or activity history.
create function race_private.status_board(p_race uuid)
returns table (bed_id uuid,pod_id uuid,label text,status text,bib text,triage text,complaint text,medical_started_at timestamptz,pool_started_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select b.id,b.pod_id,b.label,
    case when pl.id is not null then 'occupied' when b.cleaning then 'cleaning' else 'open' end,
    d.bib,d.triage,d.complaint,v.medical_started_at,
    case when pl.kind = 'pool' then pl.started_at else null end
  from race_private.beds b
  left join race_private.placements pl on pl.bed_id = b.id and pl.ended_at is null
  left join race_private.visits v on v.id = pl.visit_id
  left join race_private.visit_details d on d.visit_id = v.id
  where b.race_id = p_race and race_private.access_level(p_race) is not null
$$;
revoke all on all functions in schema race_private from public;
grant execute on function race_private.transition_visit(uuid,integer,text,uuid,text,text) to authenticated;
grant execute on function race_private.ready_bed(uuid,uuid) to authenticated;
grant execute on function race_private.status_board(uuid) to authenticated;
commit;
