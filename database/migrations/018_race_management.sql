begin;

create function public.create_race(p_id uuid, p_name text, p_timezone text, p_source uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare existing_owner uuid; pod race_private.pods; new_pod uuid;
begin
  if auth.uid() is null or not exists(select 1 from race_private.races where owner_id=auth.uid()) then
    raise exception 'Access denied' using errcode='42501';
  end if;
  if p_id is null or p_name is null or length(trim(p_name)) not between 1 and 200
    or p_timezone is null or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_timezone) then
    raise exception 'Invalid race name or timezone';
  end if;
  -- Serialize retries for this client-generated ID without locking unrelated races.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_id::text,0));
  select owner_id into existing_owner from race_private.races where id=p_id;
  if found then
    if existing_owner is distinct from auth.uid() then raise exception 'Access denied' using errcode='42501'; end if;
    return p_id;
  end if;
  if p_source is not null then
    perform 1 from race_private.races where id=p_source and owner_id=auth.uid() for update;
    if not found then raise exception 'Access denied' using errcode='42501'; end if;
  end if;
  insert into race_private.races(id,owner_id,name,timezone) values(p_id,auth.uid(),trim(p_name),p_timezone);
  if p_source is not null then
    for pod in select * from race_private.pods where race_id=p_source loop
      insert into race_private.pods(race_id,name,kind,color,capabilities,closed)
        values(p_id,pod.name,pod.kind,pod.color,pod.capabilities,false) returning id into new_pod;
      insert into race_private.beds(race_id,pod_id,label,cleaning)
        select p_id,new_pod,label,false from race_private.beds where pod_id=pod.id;
    end loop;
  end if;
  return p_id;
end $$;

create function public.rename_race(p_race uuid,p_expected_name text,p_name text)
returns void language plpgsql security definer set search_path='' as $$
declare current_name text;
begin
  select name into current_name from race_private.races where id=p_race and owner_id=auth.uid() for update;
  if not found then raise exception 'Access denied' using errcode='42501'; end if;
  if p_name is null or length(trim(p_name)) not between 1 and 200 then raise exception 'Invalid race name'; end if;
  if current_name=trim(p_name) then return; end if;
  if current_name is distinct from p_expected_name then raise exception 'Race changed; refresh before retrying' using errcode='40001'; end if;
  update race_private.races set name=trim(p_name) where id=p_race;
end $$;
revoke all on function public.create_race(uuid,text,text,uuid),public.rename_race(uuid,text,text) from public,anon;
grant execute on function public.create_race(uuid,text,text,uuid),public.rename_race(uuid,text,text) to authenticated;
commit;
