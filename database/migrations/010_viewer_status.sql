begin;
-- Explicit display-only projection: never return notes, source, ETA or history.
create function public.viewer_status(p_race uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if race_private.access_level(p_race) is null then
    raise exception 'Access denied' using errcode='42501';
  end if;
  return jsonb_build_object(
    'pods', public.race_layout(p_race),
    'beds', (select coalesce(jsonb_agg(to_jsonb(s) || jsonb_build_object('reserved',
      exists(select 1 from race_private.bed_reservations r where r.bed_id=s.bed_id))), '[]'::jsonb)
      from race_private.status_board(p_race) s),
    'metrics', (select jsonb_build_object(
      'census', count(*) filter(where v.medical_started_at is not null and v.dispositioned_at is null),
      'incoming', count(*) filter(where v.medical_started_at is null and v.dispositioned_at is null),
      'seen', count(*) filter(where v.medical_started_at is not null or v.dispositioned_at is not null),
      'discharged', count(*) filter(where v.disposition='discharged'),
      'ems', count(*) filter(where v.disposition='ems'),
      'other', count(*) filter(where v.disposition='other'))
      from race_private.visits v where v.race_id=p_race)
  );
end $$;
revoke all on function public.viewer_status(uuid) from public,anon;
grant execute on function public.viewer_status(uuid) to authenticated;
commit;
