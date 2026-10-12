-- DEVELOPMENT ONLY. Requires Supabase auth.uid(), auth.users, and authenticated role.
-- No public RPC wrappers, deployment hook, or End Race/delete command is installed.
begin;
create schema race_private;
revoke all on schema race_private from public;
grant usage on schema race_private to authenticated;

create table race_private.races (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  name text not null check (length(trim(name)) between 1 and 200),
  timezone text not null default 'America/New_York',
  state text not null default 'active' check (state in ('active', 'closing', 'closed')),
  created_at timestamptz not null default clock_timestamp()
);
create table race_private.memberships (
  race_id uuid not null references race_private.races(id),
  user_id uuid not null references auth.users(id),
  role text not null check (role in ('editor', 'viewer')),
  primary key (race_id, user_id)
);
create function race_private.access_level(p_race uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case when r.owner_id = auth.uid() then 'owner' else m.role end
  from race_private.races r left join race_private.memberships m
    on m.race_id = r.id and m.user_id = auth.uid()
  where r.id = p_race
$$;

create table race_private.pods (
  id uuid primary key default gen_random_uuid(),
  race_id uuid not null references race_private.races(id),
  name text not null,
  kind text not null default 'regular' check (kind in ('regular', 'pool')),
  color text not null check (color ~ '^#[0-9a-fA-F]{6}$'),
  capabilities text[] not null default '{}',
  closed boolean not null default false,
  unique (race_id, id), unique (race_id, name)
);
create table race_private.beds (
  id uuid primary key default gen_random_uuid(),
  race_id uuid not null,
  pod_id uuid not null,
  label text not null,
  -- Occupied is derived from an open placement, never from triage.
  cleaning boolean not null default false,
  unique (race_id, id), unique (pod_id, label),
  foreign key (race_id, pod_id) references race_private.pods(race_id, id)
);
create table race_private.visits (
  id uuid primary key default gen_random_uuid(),
  race_id uuid not null references race_private.races(id),
  created_at timestamptz not null default clock_timestamp(),
  notified_at timestamptz,
  arrived_at timestamptz,
  medical_started_at timestamptz,
  dispositioned_at timestamptz,
  disposition text check (disposition in ('discharged', 'ems', 'other')),
  revision integer not null default 0 check (revision >= 0),
  unique (race_id, id),
  check (arrived_at is null or notified_at is null or arrived_at >= notified_at),
  check (medical_started_at is null or (arrived_at is not null and medical_started_at >= arrived_at)),
  check ((disposition is null) = (dispositioned_at is null)),
  check (dispositioned_at is null or medical_started_at is null or dispositioned_at >= medical_started_at),
  check (dispositioned_at is null or arrived_at is null or dispositioned_at >= arrived_at)
);
create table race_private.visit_details (
  visit_id uuid primary key,
  race_id uuid not null,
  bib text not null check (length(trim(bib)) between 1 and 100),
  triage text not null default 'untriaged' check (triage in ('untriaged','immediate','delayed','minor')),
  complaint text not null default '',
  notes text not null default '',
  source text not null default '',
  eta text not null default '',
  other_disposition text,
  foreign key (race_id, visit_id) references race_private.visits(race_id, id)
);
create table race_private.placements (
  id uuid primary key default gen_random_uuid(),
  race_id uuid not null,
  visit_id uuid not null,
  bed_id uuid not null,
  -- Snapshot kind: renaming a pod must not reinterpret pool history.
  kind text not null check (kind in ('regular', 'pool')),
  started_at timestamptz not null,
  ended_at timestamptz,
  check (ended_at is null or ended_at >= started_at),
  foreign key (race_id, visit_id) references race_private.visits(race_id, id),
  foreign key (race_id, bed_id) references race_private.beds(race_id, id)
);
create unique index one_patient_per_bed on race_private.placements(bed_id) where ended_at is null;
create unique index one_bed_per_patient on race_private.placements(visit_id) where ended_at is null;
create table race_private.turnovers (
  id uuid primary key default gen_random_uuid(),
  race_id uuid not null,
  bed_id uuid not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  check (ended_at is null or ended_at >= started_at),
  foreign key (race_id, bed_id) references race_private.beds(race_id, id)
);
create unique index one_turnover_per_bed on race_private.turnovers(bed_id) where ended_at is null;
create table race_private.events (
  id uuid primary key default gen_random_uuid(),
  race_id uuid not null references race_private.races(id),
  visit_id uuid,
  bed_id uuid,
  actor_id uuid not null references auth.users(id),
  action text not null check (action in ('arrived','assigned','dispositioned','ready')),
  occurred_at timestamptz not null,
  foreign key (race_id, visit_id) references race_private.visits(race_id, id),
  foreign key (race_id, bed_id) references race_private.beds(race_id, id)
);
-- Fixed aggregate columns; no JSON/free text that could accidentally retain patient detail.
create table race_private.reports (
  race_id uuid primary key references race_private.races(id),
  version integer not null default 1,
  generated_at timestamptz not null,
  total_visits integer not null,
  completed_visits integer not null,
  incomplete_visits integer not null,
  notification_samples integer not null,
  notification_mean_seconds double precision,
  notification_median_seconds double precision,
  medical_samples integer not null,
  medical_mean_seconds double precision,
  medical_median_seconds double precision,
  pool_samples integer not null,
  pool_mean_seconds double precision,
  pool_median_seconds double precision,
  transfers integer not null,
  discharged integer not null,
  ems integer not null,
  other integer not null
);

alter table race_private.races enable row level security;
alter table race_private.memberships enable row level security;
alter table race_private.pods enable row level security;
alter table race_private.beds enable row level security;
alter table race_private.visits enable row level security;
alter table race_private.visit_details enable row level security;
alter table race_private.placements enable row level security;
alter table race_private.turnovers enable row level security;
alter table race_private.events enable row level security;
alter table race_private.reports enable row level security;

create policy race_read on race_private.races for select to authenticated using (race_private.access_level(id) is not null);
create policy membership_read on race_private.memberships for select to authenticated using (race_private.access_level(race_id) = 'owner' or user_id = auth.uid());
create policy pod_read on race_private.pods for select to authenticated using (race_private.access_level(race_id) is not null);
create policy bed_read on race_private.beds for select to authenticated using (race_private.access_level(race_id) is not null);
create policy visit_read on race_private.visits for select to authenticated using (race_private.access_level(race_id) in ('owner','editor'));
create policy details_read on race_private.visit_details for select to authenticated using (race_private.access_level(race_id) in ('owner','editor'));
create policy placement_read on race_private.placements for select to authenticated using (race_private.access_level(race_id) in ('owner','editor'));
create policy turnover_read on race_private.turnovers for select to authenticated using (race_private.access_level(race_id) in ('owner','editor'));
create policy event_read on race_private.events for select to authenticated using (race_private.access_level(race_id) = 'owner');
create policy report_read on race_private.reports for select to authenticated using (race_private.access_level(race_id) = 'owner');
grant select on all tables in schema race_private to authenticated;
-- Mutations go through checked commands, never direct browser table writes.
revoke all on all functions in schema race_private from public;
grant execute on function race_private.access_level(uuid) to authenticated;
alter default privileges in schema race_private revoke execute on functions from public;
commit;
