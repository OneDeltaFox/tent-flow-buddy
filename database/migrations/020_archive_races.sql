begin;
alter table race_private.races add column archived boolean not null default false;
alter table race_private.races add constraint archived_race_closed check (not archived or state='closed');

drop function public.my_races();
create function public.my_races()
returns table (id uuid, name text, timezone text, state text, role text, archived boolean)
language sql stable security definer set search_path='' as $$
  select r.id,r.name,r.timezone,r.state,
    case when r.owner_id=auth.uid() then 'owner' else m.role end,r.archived
  from race_private.races r left join race_private.memberships m
    on m.race_id=r.id and m.user_id=auth.uid()
  where auth.uid() is not null and (r.owner_id=auth.uid() or m.user_id=auth.uid())
  order by r.created_at,r.id
$$;

create function public.set_race_archived(p_race uuid,p_archived boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform 1 from race_private.races where id=p_race and owner_id=auth.uid() for update;
  if not found then raise exception 'Access denied' using errcode='42501'; end if;
  if p_archived is null then raise exception 'Archive choice required'; end if;
  if not exists(select 1 from race_private.races where id=p_race and state='closed') then
    raise exception 'Only closed races can be archived or restored';
  end if;
  update race_private.races set archived=p_archived where id=p_race;
end $$;
revoke all on function public.my_races(),public.set_race_archived(uuid,boolean) from public,anon;
grant execute on function public.my_races(),public.set_race_archived(uuid,boolean) to authenticated;
commit;
