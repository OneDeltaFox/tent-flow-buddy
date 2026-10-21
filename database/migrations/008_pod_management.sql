begin;

-- Names such as 'Pod 1' and '1' represent the same regular-pod number.
create unique index unique_regular_pod_number on race_private.pods
  (race_id, ((substring(name from '([0-9]+)$'))::numeric))
  where kind='regular' and name ~* '^(pod[[:space:]]+)?[0-9]+$';

create function public.update_pod(p_pod uuid, p_expected jsonb, p_closed boolean, p_capabilities jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare race uuid; race_state text; current_pod race_private.pods; caps text[];
begin
  select race_id into race from race_private.pods where id=p_pod;
  if race is null or coalesce(race_private.access_level(race),'') <> 'owner' then raise exception 'Access denied' using errcode='42501'; end if;
  select state into race_state from race_private.races where id=race for update;
  if coalesce(race_private.access_level(race),'') <> 'owner' then raise exception 'Access denied' using errcode='42501'; end if;
  if race_state <> 'active' then raise exception 'Race is not active'; end if;
  select * into current_pod from race_private.pods where id=p_pod;
  if p_expected is distinct from jsonb_build_object('name',current_pod.name,'closed',current_pod.closed,'capabilities',current_pod.capabilities) then
    raise exception 'Pod changed; refresh before retrying' using errcode='40001';
  end if;
  if p_closed is null or jsonb_typeof(p_capabilities) is distinct from 'array' then raise exception 'Invalid pod settings'; end if;
  if jsonb_array_length(p_capabilities)>20 or exists(select 1 from jsonb_array_elements(p_capabilities) c where jsonb_typeof(c)<>'string') then raise exception 'Invalid capabilities'; end if;
  if exists(select 1 from jsonb_array_elements_text(p_capabilities) c where length(trim(c)) not between 1 and 80) then raise exception 'Invalid capabilities'; end if;
  select coalesce(array_agg(distinct trim(c)),array[]::text[]) into caps from jsonb_array_elements_text(p_capabilities) c;
  update race_private.pods set closed=p_closed,capabilities=caps where id=p_pod;
end $$;

create function race_private.section_plan(p_race uuid,p_color text,p_count integer,p_beds integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare boundary integer; first_number integer; prefix text; shifts jsonb; names jsonb;
begin
  if coalesce(race_private.access_level(p_race),'') <> 'owner' then raise exception 'Access denied' using errcode='42501'; end if;
  if not exists(select 1 from race_private.races where id=p_race and state='active') then raise exception 'Race is not active'; end if;
  if p_color is null or p_color !~ '^#[0-9a-fA-F]{6}$' or p_count is null or p_count not between 1 and 50 or p_beds is null or p_beds not between 1 and 20 then raise exception 'Invalid section batch'; end if;
  if exists(select 1 from race_private.pods where race_id=p_race and kind='regular' and name !~* '^(pod[[:space:]]+)?[1-9][0-9]{0,5}$') then
    raise exception 'Section insertion requires numbered regular pods (1 or Pod 1)';
  end if;
  select max(substring(name from '([0-9]+)$')::integer),min(substring(name from '([0-9]+)$')::integer)
    into boundary,first_number from race_private.pods where race_id=p_race and kind='regular' and lower(color)=lower(p_color);
  if boundary is null then raise exception 'Color section not found'; end if;
  if exists(select 1 from race_private.pods where race_id=p_race and kind='regular' and lower(color)<>lower(p_color)
    and substring(name from '([0-9]+)$')::integer between first_number and boundary) then raise exception 'Color section is not contiguous'; end if;
  if exists(select 1 from race_private.pods where race_id=p_race and kind='regular' and substring(name from '([0-9]+)$')::integer+p_count>999999) then raise exception 'Pod number limit exceeded'; end if;
  select regexp_replace(name,'[0-9]+$','') into prefix from race_private.pods where race_id=p_race and kind='regular' and substring(name from '([0-9]+)$')::integer=boundary;
  if exists(select 1 from race_private.beds b join race_private.pods p on p.id=b.pod_id
    where p.race_id=p_race and p.kind='regular' and substring(p.name from '([0-9]+)$')::integer>boundary and b.label !~ '-[1-9][0-9]?$') then
    raise exception 'Cannot renumber custom bed labels';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'from',p.name,
    'to',regexp_replace(p.name,'[0-9]+$','')||(substring(p.name from '([0-9]+)$')::integer+p_count),
    'beds',(select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'from',b.label,
      'to',(substring(p.name from '([0-9]+)$')::integer+p_count)||'-'||substring(b.label from '([0-9]+)$')) order by b.label),'[]'::jsonb) from race_private.beds b where b.pod_id=p.id))
    order by substring(p.name from '([0-9]+)$')::integer desc),'[]'::jsonb)
    into shifts from race_private.pods p where p.race_id=p_race and p.kind='regular' and substring(p.name from '([0-9]+)$')::integer>boundary;
  select jsonb_agg(prefix||n order by n) into names from generate_series(boundary+1,boundary+p_count) n;
  return jsonb_build_object('token',md5(public.race_layout(p_race)::text),'new_names',names,'changes',shifts,'color',lower(p_color),'beds_per_pod',p_beds);
end $$;

create function public.preview_section_pods(p_race uuid,p_color text,p_count integer,p_beds integer)
returns jsonb language sql security invoker set search_path='' as $$ select race_private.section_plan(p_race,p_color,p_count,p_beds) $$;

create function public.add_section_pods(p_race uuid,p_color text,p_count integer,p_beds integer,p_capabilities jsonb,p_expected_token text)
returns integer language plpgsql security definer set search_path='' as $$
declare plan jsonb; change jsonb; bed_change jsonb; batch jsonb;
begin
  if coalesce(race_private.access_level(p_race),'') <> 'owner' then raise exception 'Access denied' using errcode='42501'; end if;
  perform 1 from race_private.races where id=p_race for update;
  plan := race_private.section_plan(p_race,p_color,p_count,p_beds);
  if p_expected_token is distinct from plan->>'token' then raise exception 'Layout changed; preview again' using errcode='40001'; end if;
  -- Highest numbers first avoid transient uniqueness conflicts. IDs and placements never change.
  for change in select value from jsonb_array_elements(plan->'changes') loop
    update race_private.pods set name=change->>'to' where id=(change->>'id')::uuid;
    for bed_change in select value from jsonb_array_elements(change->'beds') loop
      update race_private.beds set label=bed_change->>'to' where id=(bed_change->>'id')::uuid;
    end loop;
  end loop;
  select jsonb_agg(jsonb_build_object('name',n,'kind','regular','color',lower(p_color),'beds',p_beds,'capabilities',p_capabilities))
    into batch from jsonb_array_elements_text(plan->'new_names') n;
  return public.create_pods(p_race,batch);
end $$;

revoke all on function public.update_pod(uuid,jsonb,boolean,jsonb) from public,anon;
revoke all on function race_private.section_plan(uuid,text,integer,integer) from public,anon;
revoke all on function public.preview_section_pods(uuid,text,integer,integer) from public,anon;
revoke all on function public.add_section_pods(uuid,text,integer,integer,jsonb,text) from public,anon;
grant execute on function public.update_pod(uuid,jsonb,boolean,jsonb) to authenticated;
grant execute on function race_private.section_plan(uuid,text,integer,integer) to authenticated;
grant execute on function public.preview_section_pods(uuid,text,integer,integer) to authenticated;
grant execute on function public.add_section_pods(uuid,text,integer,integer,jsonb,text) to authenticated;
commit;
