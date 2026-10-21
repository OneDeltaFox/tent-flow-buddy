begin;

-- One snapshot per request; detailed operational records are never exposed to viewers.
create function public.patient_board(p_race uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(race_private.access_level(p_race),'') not in ('owner','editor') then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'pods', public.race_layout(p_race),
    'visits', (select coalesce(jsonb_agg(to_jsonb(v) || to_jsonb(d) || jsonb_build_object('id',v.id)), '[]'::jsonb)
      from race_private.visits v join race_private.visit_details d on d.visit_id=v.id where v.race_id=p_race),
    'placements', (select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) from race_private.placements p where p.race_id=p_race),
    'turnovers', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from race_private.turnovers t where t.race_id=p_race and t.ended_at is null)
  );
end $$;

create function public.save_patient(p_race uuid, p_visit uuid, p_revision integer, p_details jsonb, p_bed uuid default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare v race_private.visits; race_state text; next_revision integer;
begin
  if coalesce(race_private.access_level(p_race),'') not in ('owner','editor') then raise exception 'Access denied' using errcode='42501'; end if;
  select state into race_state from race_private.races where id=p_race for update;
  if coalesce(race_private.access_level(p_race),'') not in ('owner','editor') then raise exception 'Access denied' using errcode='42501'; end if;
  if race_state <> 'active' then raise exception 'Race is not active'; end if;
  if p_visit is null or p_details is null or jsonb_typeof(p_details) <> 'object'
    or coalesce(length(trim(p_details->>'bib')),0) not between 1 and 100
    or coalesce(p_details->>'triage','untriaged') not in ('untriaged','immediate','delayed','minor')
    or coalesce(length(p_details->>'complaint'),0)>1000
    or coalesce(length(p_details->>'notes'),0)>2000
    or coalesce(length(p_details->>'source'),0)>200
    or coalesce(length(p_details->>'eta'),0)>100 then raise exception 'Invalid patient details'; end if;
  select * into v from race_private.visits where id=p_visit;
  if found then
    if v.race_id <> p_race then raise exception 'Access denied' using errcode='42501'; end if;
    if p_revision is null or v.revision <> p_revision then raise exception 'Stale visit; refresh before retrying' using errcode='40001'; end if;
    if v.dispositioned_at is not null then raise exception 'Visit already dispositioned'; end if;
  else
    if p_revision is not null then raise exception 'Visit not found'; end if;
    insert into race_private.visits(id,race_id,notified_at) values(p_visit,p_race,case when p_bed is null then clock_timestamp() else null end);
    insert into race_private.visit_details(visit_id,race_id,bib) values(p_visit,p_race,trim(p_details->>'bib'));
  end if;
  update race_private.visit_details set bib=trim(p_details->>'bib'), triage=coalesce(p_details->>'triage','untriaged'),
    complaint=coalesce(p_details->>'complaint',''), notes=coalesce(p_details->>'notes',''),
    source=coalesce(p_details->>'source',source), eta=coalesce(p_details->>'eta',eta) where visit_id=p_visit;
  if p_bed is not null then
    return race_private.transition_visit(p_visit,coalesce(v.revision,0),'assigned',p_bed);
  end if;
  update race_private.visits set revision=revision+1 where id=p_visit returning revision into next_revision;
  return next_revision;
end $$;

create function public.move_patient(p_visit uuid,p_revision integer,p_action text,p_bed uuid default null,p_category text default null,p_other text default null)
returns integer language sql security invoker set search_path = '' as $$
  select race_private.transition_visit(p_visit,p_revision,p_action,p_bed,p_category,p_other)
$$;
create function public.ready_patient_bed(p_bed uuid,p_turnover uuid) returns void
language sql security invoker set search_path = '' as $$ select race_private.ready_bed(p_bed,p_turnover) $$;

revoke all on function public.patient_board(uuid) from public,anon;
revoke all on function public.save_patient(uuid,uuid,integer,jsonb,uuid) from public,anon;
revoke all on function public.move_patient(uuid,integer,text,uuid,text,text) from public,anon;
revoke all on function public.ready_patient_bed(uuid,uuid) from public,anon;
grant execute on function public.patient_board(uuid) to authenticated;
grant execute on function public.save_patient(uuid,uuid,integer,jsonb,uuid) to authenticated;
grant execute on function public.move_patient(uuid,integer,text,uuid,text,text) to authenticated;
grant execute on function public.ready_patient_bed(uuid,uuid) to authenticated;
commit;
