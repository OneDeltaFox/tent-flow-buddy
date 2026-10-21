begin;
create table race_private.report_email_attempts (
  id uuid primary key,
  owner_id uuid not null references auth.users(id),
  report_id uuid not null references race_private.daily_reports(id),
  attempted_at timestamptz not null default clock_timestamp()
);
alter table race_private.report_email_attempts enable row level security;
revoke all on race_private.report_email_attempts from public,anon,authenticated;

create function public.claim_report_email(p_race uuid,p_report uuid,p_attempt uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare report race_private.daily_reports;
begin
  perform 1 from auth.users where id=auth.uid() for update;
  perform 1 from race_private.races where id=p_race for update;
  if coalesce(race_private.access_level(p_race),'') <> 'owner' then raise exception 'Access denied' using errcode='42501'; end if;
  select * into report from race_private.daily_reports where id=p_report and race_id=p_race and deleted_at is null;
  if not found then raise exception 'Report unavailable'; end if;
  if exists(select 1 from race_private.report_email_attempts where id=p_attempt) then raise exception 'Email already attempted'; end if;
  if (select count(*) from race_private.report_email_attempts where owner_id=auth.uid() and attempted_at>clock_timestamp()-interval '1 hour') >= 10 then raise exception 'Hourly email limit reached'; end if;
  insert into race_private.report_email_attempts(id,owner_id,report_id) values(p_attempt,auth.uid(),p_report);
  return jsonb_build_object('generated_at',report.generated_at,'totals',report.totals);
end $$;
revoke all on function public.claim_report_email(uuid,uuid,uuid) from public,anon;
grant execute on function public.claim_report_email(uuid,uuid,uuid) to authenticated;
commit;
