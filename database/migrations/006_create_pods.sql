begin;
create function public.create_pods(p_race uuid, p_pods jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  race_state text;
  item jsonb;
  pod_id uuid;
  pod_name text;
  bed_count integer;
  caps text[];
begin
  if coalesce(race_private.access_level(p_race),'') <> 'owner' then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  select state into race_state from race_private.races where id=p_race for update;
  if coalesce(race_private.access_level(p_race),'') <> 'owner' then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if race_state <> 'active' then raise exception 'Race is not active'; end if;
  if p_pods is null or jsonb_typeof(p_pods) <> 'array' then raise exception 'Invalid pod batch'; end if;
  if jsonb_array_length(p_pods) not between 1 and 50 then raise exception 'Use 1 to 50 pods per batch'; end if;
  for item in select value from jsonb_array_elements(p_pods) loop
    pod_name := trim(item->>'name');
    if jsonb_typeof(item) <> 'object' or pod_name is null or length(pod_name) not between 1 and 80
      or coalesce(item->>'color','') !~ '^#[0-9a-fA-F]{6}$'
      or coalesce(item->>'kind','') not in ('regular','pool')
      or coalesce(item->>'beds','') !~ '^[0-9]{1,2}$' then raise exception 'Invalid pod settings'; end if;
    bed_count := (item->>'beds')::integer;
    if bed_count not between 1 and 20 then raise exception 'Use 1 to 20 beds per pod'; end if;
    if jsonb_typeof(item->'capabilities') is distinct from 'array' then raise exception 'Invalid capabilities'; end if;
    if jsonb_array_length(item->'capabilities') > 20 or exists (
      select 1 from jsonb_array_elements(item->'capabilities') c where jsonb_typeof(c) <> 'string'
    ) then raise exception 'Invalid capabilities'; end if;
    if exists(select 1 from jsonb_array_elements_text(item->'capabilities') c where length(trim(c)) not between 1 and 80)
      then raise exception 'Invalid capabilities'; end if;
    select coalesce(array_agg(distinct trim(c)),array[]::text[]) into caps
      from jsonb_array_elements_text(item->'capabilities') c;
    insert into race_private.pods(race_id,name,kind,color,capabilities)
      values(p_race,pod_name,item->>'kind',item->>'color',caps) returning id into pod_id;
    insert into race_private.beds(race_id,pod_id,label)
      select p_race,pod_id,pod_name || '-' || n from generate_series(1,bed_count) n;
  end loop;
  return jsonb_array_length(p_pods);
end
$$;
revoke all on function public.create_pods(uuid,jsonb) from public,anon;
grant execute on function public.create_pods(uuid,jsonb) to authenticated;
commit;
