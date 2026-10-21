begin;
create function public.my_races()
returns table (id uuid, name text, timezone text, state text, role text)
language sql stable security definer set search_path = '' as $$
  select r.id, r.name, r.timezone, r.state,
    case when r.owner_id = auth.uid() then 'owner' else m.role end
  from race_private.races r
  left join race_private.memberships m
    on m.race_id = r.id and m.user_id = auth.uid()
  where auth.uid() is not null
    and (r.owner_id = auth.uid() or m.user_id = auth.uid())
  order by r.created_at, r.id
$$;
revoke all on function public.my_races() from public, anon;
grant execute on function public.my_races() to authenticated;
commit;
