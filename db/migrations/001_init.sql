create table if not exists deployments (
  id text primary key,
  repository text not null,
  branch text not null,
  commit_sha text not null,
  image_tag text not null,
  release_name text,
  namespace text,
  environment text not null check (environment in ('dev', 'staging', 'prod')),
  status text not null check (status in ('queued', 'running', 'deployed', 'failed', 'rolled_back')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deployed_at timestamptz
);

create table if not exists deployment_events (
  id bigserial primary key,
  deployment_id text not null references deployments(id) on delete cascade,
  stage text not null,
  status text not null check (status in ('running', 'succeeded', 'failed')),
  message text not null,
  logs text,
  created_at timestamptz not null default now()
);

alter table deployments
  drop constraint if exists deployments_status_check;

alter table deployments
  add constraint deployments_status_check
  check (status in ('queued', 'running', 'deployed', 'failed', 'rolled_back'));

alter table deployment_events
  add column if not exists logs text;

alter table deployments
  add column if not exists release_name text;

alter table deployments
  add column if not exists namespace text;

create index if not exists deployment_events_deployment_id_idx
  on deployment_events (deployment_id, created_at);
