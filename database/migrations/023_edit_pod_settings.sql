begin;
create function public.edit_pod_settings(p_pod uuid,p_expected jsonb,p_name text,p_color text,p_kind text,p_beds integer,p_closed boolean,p_capabilities jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare race uuid; current_pod race_private.pods; old_count integer; removed uuid[]; ordered uuid[]; prefix text;
begin
  select race_id into race from race_private.pods where id=p_pod;
  if coalesce(race_private.access_level(race),'') <> 'owner' then raise exception 'Access denied' using errcode='42501'; end if;
  perform 1 from race_private.races where id=race for update;
  if coalesce(race_private.access_level(race),'') <> 'owner' then raise exception 'Access denied' using errcode='42501'; end if;
  if not exists(select 1 from race_private.races where id=race and state='active') then raise exception 'Race is not active'; end if;
  select * into current_pod from race_private.pods where id=p_pod;
  select count(*) into old_count from race_private.beds where pod_id=p_pod;
  if p_expected is distinct from jsonb_build_object('name',current_pod.name,'color',current_pod.color,'kind',current_pod.kind,'beds',old_count,'closed',current_pod.closed,'capabilities',current_pod.capabilities) then
    raise exception 'Pod changed; refresh before retrying' using errcode='40001';
  end if;
  p_name := trim(p_name);
  if p_name is null or length(p_name) not between 1 and 80 or coalesce(p_color,'') !~ '^#[0-9a-fA-F]{6}$'
    or coalesce(p_kind,'') not in ('regular','pool') or p_beds is null or p_beds not between 1 and 20 then raise exception 'Invalid pod settings'; end if;
  if p_kind <> current_pod.kind and (exists(select 1 from race_private.placements x join race_private.beds b on b.id=x.bed_id where b.pod_id=p_pod and x.ended_at is null)
    or exists(select 1 from race_private.bed_reservations x join race_private.beds b on b.id=x.bed_id where b.pod_id=p_pod)) then
    raise exception 'Cannot change type while occupied or reserved';
  end if;
  -- Reuse existing validation and owner/state protections for capabilities and closure.
  perform public.update_pod(p_pod,jsonb_build_object('name',current_pod.name,'closed',current_pod.closed,'capabilities',current_pod.capabilities),p_closed,p_capabilities);
  if p_beds < old_count then
    select array_agg(id) into removed from (select id from race_private.beds where pod_id=p_pod
      order by substring(label from '([0-9]+)$')::numeric nulls last,label,id offset p_beds) x;
    if exists(select 1 from race_private.placements where bed_id=any(removed))
      or exists(select 1 from race_private.events where bed_id=any(removed))
      or exists(select 1 from race_private.turnovers where bed_id=any(removed))
      or exists(select 1 from race_private.bed_reservations where bed_id=any(removed))
      or exists(select 1 from race_private.beds where id=any(removed) and cleaning) then
      raise exception 'Cannot remove used or reserved beds';
    end if;
    delete from race_private.beds where id=any(removed);
  end if;
  update race_private.pods set name=p_name,color=lower(p_color),kind=p_kind where id=p_pod;
  -- Keep bed IDs and all placements; only display labels change when renamed.
  prefix := case when p_kind='regular' and p_name ~* '^(pod[[:space:]]+)?[0-9]+$' then substring(p_name from '([0-9]+)$') else p_name end;
  if p_name <> current_pod.name then
    select array_agg(id order by substring(label from '([0-9]+)$')::numeric nulls last,label,id) into ordered from race_private.beds where pod_id=p_pod;
    update race_private.beds set label=id::text where pod_id=p_pod;
    update race_private.beds b set label=prefix||'-'||n.n from unnest(ordered) with ordinality n(id,n) where b.id=n.id;
  end if;
  if p_beds > old_count then
    insert into race_private.beds(race_id,pod_id,label) select race,p_pod,prefix||'-'||n from generate_series(old_count+1,p_beds) n;
  end if;
exception when unique_violation then raise exception 'Pod name or number already exists';
end $$;
revoke all on function public.edit_pod_settings(uuid,jsonb,text,text,text,integer,boolean,jsonb) from public,anon;
grant execute on function public.edit_pod_settings(uuid,jsonb,text,text,text,integer,boolean,jsonb) to authenticated;
commit;
