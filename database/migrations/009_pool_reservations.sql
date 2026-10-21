begin;

create table race_private.bed_reservations (
  race_id uuid not null,
  visit_id uuid primary key,
  bed_id uuid not null unique,
  started_at timestamptz not null default clock_timestamp(),
  foreign key (race_id,visit_id) references race_private.visits(race_id,id),
  foreign key (race_id,bed_id) references race_private.beds(race_id,id)
);
alter table race_private.bed_reservations enable row level security;
revoke all on race_private.bed_reservations from public,anon,authenticated;

-- Retain the checked placement/timing command behind a reservation-aware wrapper.
alter function race_private.transition_visit(uuid,integer,text,uuid,text,text) rename to transition_visit_without_reservation;
revoke all on function race_private.transition_visit_without_reservation(uuid,integer,text,uuid,text,text) from public,anon,authenticated;
create function race_private.transition_visit(p_visit uuid,p_revision integer,p_action text,p_bed uuid default null,p_category text default null,p_other text default null)
returns integer language plpgsql security definer set search_path='' as $$
declare v race_private.visits; previous race_private.placements; held race_private.bed_reservations;
  destination_kind text; race uuid; race_state text; result integer; stamp timestamptz;
begin
  select race_id into race from race_private.visits where id=p_visit;
  if race is null or coalesce(race_private.access_level(race),'') not in ('owner','editor') then raise exception 'Access denied' using errcode='42501'; end if;
  select state into race_state from race_private.races where id=race for update;
  if coalesce(race_private.access_level(race),'') not in ('owner','editor') then raise exception 'Access denied' using errcode='42501'; end if;
  if race_state <> 'active' then raise exception 'Race is not active'; end if;
  select * into v from race_private.visits where id=p_visit for update;
  if p_revision is null or v.revision <> p_revision then raise exception 'Stale visit; refresh before retrying' using errcode='40001'; end if;
  if v.dispositioned_at is not null then raise exception 'Visit already dispositioned'; end if;
  select * into held from race_private.bed_reservations where visit_id=p_visit;
  if p_action='assigned' then
    if exists(select 1 from race_private.bed_reservations where bed_id=p_bed and visit_id<>p_visit) then raise exception 'Bed reserved for another patient'; end if;
    select p.kind into destination_kind from race_private.beds b join race_private.pods p on p.id=b.pod_id where b.id=p_bed and b.race_id=race;
    select * into previous from race_private.placements where visit_id=p_visit and ended_at is null;
    if previous.kind='regular' and destination_kind='pool' then
      stamp := clock_timestamp();
      insert into race_private.bed_reservations(race_id,visit_id,bed_id,started_at) values(race,p_visit,previous.bed_id,stamp);
      -- End physical occupancy, but skip turnover while the bed is held.
      update race_private.placements set ended_at=stamp where id=previous.id;
    end if;
  end if;
  result := race_private.transition_visit_without_reservation(p_visit,p_revision,p_action,p_bed,p_category,p_other);
  if held.visit_id is not null and (p_action='dispositioned' or (p_action='assigned' and destination_kind='regular')) then
    delete from race_private.bed_reservations where visit_id=p_visit;
    if p_action='dispositioned' or held.bed_id<>p_bed then
      stamp := clock_timestamp();
      update race_private.beds set cleaning=true where id=held.bed_id;
      insert into race_private.turnovers(race_id,bed_id,started_at) values(race,held.bed_id,stamp);
    end if;
  end if;
  return result;
end $$;
revoke all on function race_private.transition_visit(uuid,integer,text,uuid,text,text) from public,anon;
grant execute on function race_private.transition_visit(uuid,integer,text,uuid,text,text) to authenticated;

alter function public.race_layout(uuid) rename to race_layout_without_reservations;
revoke all on function public.race_layout_without_reservations(uuid) from public,anon,authenticated;
create function public.race_layout(p_race uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare layout jsonb;
begin
  layout := public.race_layout_without_reservations(p_race);
  return coalesce((select jsonb_agg(pod || jsonb_build_object('beds',
    (select jsonb_agg(bed || case when exists(select 1 from race_private.bed_reservations r where r.bed_id=(bed->>'id')::uuid) then '{"status":"occupied"}'::jsonb else '{}'::jsonb end)
      from jsonb_array_elements(pod->'beds') bed))) from jsonb_array_elements(layout) pod),'[]'::jsonb);
end $$;
revoke all on function public.race_layout(uuid) from public,anon;
grant execute on function public.race_layout(uuid) to authenticated;

alter function public.patient_board(uuid) rename to patient_board_without_reservations;
revoke all on function public.patient_board_without_reservations(uuid) from public,anon,authenticated;
create function public.patient_board(p_race uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare snapshot jsonb;
begin
  snapshot := public.patient_board_without_reservations(p_race);
  return snapshot || jsonb_build_object('pods',public.race_layout(p_race),'reservations',
    (select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from race_private.bed_reservations r where r.race_id=p_race));
end $$;
revoke all on function public.patient_board(uuid) from public,anon;
grant execute on function public.patient_board(uuid) to authenticated;

create or replace function race_private.status_board(p_race uuid)
returns table (bed_id uuid,pod_id uuid,label text,status text,bib text,triage text,complaint text,medical_started_at timestamptz,pool_started_at timestamptz)
language sql stable security definer set search_path='' as $$
  select b.id,b.pod_id,b.label,
    case when pl.id is not null or r.visit_id is not null then 'occupied' when b.cleaning then 'cleaning' else 'open' end,
    d.bib,d.triage,d.complaint,v.medical_started_at,case when pl.kind='pool' then pl.started_at else null end
  from race_private.beds b
  left join race_private.placements pl on pl.bed_id=b.id and pl.ended_at is null
  left join race_private.bed_reservations r on r.bed_id=b.id
  left join race_private.visits v on v.id=coalesce(pl.visit_id,r.visit_id)
  left join race_private.visit_details d on d.visit_id=v.id
  where b.race_id=p_race and race_private.access_level(p_race) is not null
$$;
commit;
