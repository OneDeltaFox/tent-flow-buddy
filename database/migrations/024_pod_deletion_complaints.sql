begin;
-- Historical placement rows survive layout removal, with their display labels retained.
alter table race_private.placements alter column bed_id drop not null;
alter table race_private.turnovers alter column bed_id drop not null;
alter table race_private.placements add column removed_bed_label text, add column removed_pod_name text;
alter table race_private.turnovers add column removed_bed_label text, add column removed_pod_name text;
alter table race_private.events add column removed_bed_label text, add column removed_pod_name text;

create function public.delete_pod(p_pod uuid,p_expected jsonb,p_confirm text) returns void
language plpgsql security definer set search_path='' as $$
declare race uuid; current_pod race_private.pods; bed_ids uuid[];
begin
  select race_id into race from race_private.pods where id=p_pod;
  if coalesce(race_private.access_level(race),'') <> 'owner' then raise exception 'Access denied' using errcode='42501'; end if;
  perform 1 from race_private.races where id=race for update;
  if coalesce(race_private.access_level(race),'') <> 'owner' then raise exception 'Access denied' using errcode='42501'; end if;
  if not exists(select 1 from race_private.races where id=race and state='active') then raise exception 'Race is not active'; end if;
  select * into current_pod from race_private.pods where id=p_pod;
  if not found then raise exception 'Pod changed; refresh before retrying'; end if;
  if p_confirm is distinct from current_pod.name then raise exception 'Type the pod name to confirm'; end if;
  if p_expected is distinct from jsonb_build_object('name',current_pod.name,'color',current_pod.color,'kind',current_pod.kind,'closed',current_pod.closed,'capabilities',current_pod.capabilities,'beds',(select count(*) from race_private.beds where pod_id=p_pod)) then
    raise exception 'Pod changed; refresh before retrying' using errcode='40001';
  end if;
  select array_agg(id) into bed_ids from race_private.beds where pod_id=p_pod;
  if exists(select 1 from race_private.placements where bed_id=any(bed_ids) and ended_at is null)
    or exists(select 1 from race_private.bed_reservations where bed_id=any(bed_ids)) then
    raise exception 'Move or disposition assigned patients and release reserved beds before deleting this pod';
  end if;
  update race_private.placements x set removed_bed_label=b.label,removed_pod_name=current_pod.name,bed_id=null from race_private.beds b where x.bed_id=b.id and b.pod_id=p_pod;
  update race_private.turnovers x set removed_bed_label=b.label,removed_pod_name=current_pod.name,bed_id=null,ended_at=coalesce(x.ended_at,clock_timestamp()) from race_private.beds b where x.bed_id=b.id and b.pod_id=p_pod;
  update race_private.events x set removed_bed_label=b.label,removed_pod_name=current_pod.name,bed_id=null from race_private.beds b where x.bed_id=b.id and b.pod_id=p_pod;
  delete from race_private.beds where pod_id=p_pod;
  delete from race_private.pods where id=p_pod;
end $$;

create table race_private.complaint_lists (
  race_id uuid primary key references race_private.races(id) on delete cascade,
  options jsonb not null check(jsonb_typeof(options)='array')
);
alter table race_private.complaint_lists enable row level security;
revoke all on race_private.complaint_lists from public,anon,authenticated;

create function public.race_complaints(p_race uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if coalesce(race_private.access_level(p_race),'') not in ('owner','editor') then raise exception 'Access denied' using errcode='42501'; end if;
  return coalesce((select options from race_private.complaint_lists where race_id=p_race),
    (select jsonb_agg(jsonb_build_object('label',label,'enabled',true) order by label) from unnest(array['Abd Pain','Abrasions','Arm Pain/Inj','Back Pain','Bleeding','Chest Pain','Dif. Breathing','Dizziness','Foot Pain/Inj','Gen. Weakness','Hand Pain/Inj','Head Pain','Heat Exhaustion','Inj/Fall','Knee Pain/Inj','Laceration','Leg Pain/Inj','Nausea/Vomiting','Near Syncope','Syncope','Unconscious']) label));
end $$;

create function public.save_race_complaints(p_race uuid,p_expected jsonb,p_options jsonb) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform 1 from race_private.races where id=p_race and owner_id=auth.uid() and state='active' for update;
  if not found then raise exception 'Access denied or race closed' using errcode='42501'; end if;
  if p_expected is distinct from public.race_complaints(p_race) then raise exception 'Complaint list changed; reopen and review' using errcode='40001'; end if;
  if jsonb_typeof(p_options) is distinct from 'array' then raise exception 'Invalid complaint list'; end if;
  if jsonb_array_length(p_options)>100 then raise exception 'Maximum 100 complaints'; end if;
  if exists(select 1 from jsonb_array_elements(p_options) x where jsonb_typeof(x) is distinct from 'object'
    or jsonb_typeof(x->'label') is distinct from 'string' or length(trim(x->>'label')) not between 1 and 80
    or lower(trim(x->>'label'))='other' or jsonb_typeof(x->'enabled') is distinct from 'boolean'
    or (x - 'label' - 'enabled') <> '{}'::jsonb) then raise exception 'Invalid complaint list'; end if;
  if (select count(*) from jsonb_array_elements(p_options)) <> (select count(distinct lower(trim(x->>'label'))) from jsonb_array_elements(p_options) x) then raise exception 'Duplicate complaint'; end if;
  insert into race_private.complaint_lists values(p_race,p_options) on conflict(race_id) do update set options=excluded.options;
end $$;

-- Layout copying carries its complaint configuration, without altering patient records.
alter function public.create_race(uuid,text,text,uuid) rename to create_race_base;
alter function public.create_race_base(uuid,text,text,uuid) set schema race_private;
revoke all on function race_private.create_race_base(uuid,text,text,uuid) from public,anon,authenticated;
create function public.create_race(p_id uuid,p_name text,p_timezone text,p_source uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare existed boolean; result uuid;
begin
  if p_id is null then raise exception 'Invalid race ID'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_id::text,0));
  select exists(select 1 from race_private.races where id=p_id) into existed;
  result := race_private.create_race_base(p_id,p_name,p_timezone,p_source);
  if not existed and p_source is not null then
    insert into race_private.complaint_lists(race_id,options) values(result,public.race_complaints(p_source));
  end if;
  return result;
end $$;
revoke all on function public.delete_pod(uuid,jsonb,text),public.race_complaints(uuid),public.save_race_complaints(uuid,jsonb,jsonb),public.create_race(uuid,text,text,uuid) from public,anon;
grant execute on function public.delete_pod(uuid,jsonb,text),public.race_complaints(uuid),public.save_race_complaints(uuid,jsonb,jsonb),public.create_race(uuid,text,text,uuid) to authenticated;
commit;
