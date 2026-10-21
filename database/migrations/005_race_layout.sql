begin;
create function public.race_layout(p_race uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if race_private.access_level(p_race) is null then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', p.id, 'name', p.name, 'color', p.color, 'kind', p.kind,
    'closed', p.closed, 'capabilities', p.capabilities,
    'beds', coalesce((select jsonb_agg(jsonb_build_object(
      'id', b.id, 'label', b.label, 'status', case
        when exists(select 1 from race_private.placements v where v.bed_id=b.id and v.ended_at is null) then 'occupied'
        when b.cleaning then 'cleaning' else 'open' end
    ) order by b.label, b.id) from race_private.beds b
      where b.pod_id=p.id and b.race_id=p_race), '[]'::jsonb)
  ) order by p.name, p.id) from race_private.pods p where p.race_id=p_race), '[]'::jsonb);
end
$$;
revoke all on function public.race_layout(uuid) from public, anon;
grant execute on function public.race_layout(uuid) to authenticated;
commit;
