-- SSI-WRX Shared Workroom Phase 1. Run with the Supabase SQL editor or CLI.
-- This prototype intentionally allows only authenticated members of this Supabase
-- project. Do not add an anon/public policy.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  archived boolean not null default false,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.episodes (
  id uuid primary key default gen_random_uuid(),
  display_key text not null unique,
  project_id uuid references public.projects(id) on delete set null,
  state_json jsonb not null,
  version integer not null default 1 check (version > 0),
  current_stage integer not null default 0 check (current_stage between 0 and 2),
  status text not null default 'active',
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sources (
  id text primary key,
  episode_id uuid not null references public.episodes(id) on delete cascade,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  sha256 text,
  original_object_key text not null,
  extracted_text_object_key text not null,
  extraction_status text not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.activity_events (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null references public.episodes(id) on delete cascade,
  actor_id uuid references public.profiles(id),
  actor_kind text not null check (actor_kind in ('human', 'codex', 'system', 'UNKNOWN_LEGACY')),
  type text not null,
  authority_impact text,
  title text not null,
  summary text not null default '',
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create table if not exists public.authority_actions (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null references public.episodes(id) on delete cascade,
  actor_id uuid not null references public.profiles(id),
  action_type text not null check (action_type in (
    'structure_accepted', 'follow_up_authorized', 'follow_up_continued',
    'package_promoted', 'package_paused', 'package_rejected',
    'stage_advanced', 'final_disposition_recorded'
  )),
  prior_version integer not null,
  resulting_version integer not null,
  approved_scope jsonb not null default '{}'::jsonb,
  provenance jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.episodes enable row level security;
alter table public.sources enable row level security;
alter table public.activity_events enable row level security;
alter table public.authority_actions enable row level security;

create policy "authenticated read profiles" on public.profiles for select to authenticated using (true);
create policy "authenticated read projects" on public.projects for select to authenticated using (true);
create policy "authenticated read episodes" on public.episodes for select to authenticated using (true);
create policy "authenticated read sources" on public.sources for select to authenticated using (true);
create policy "authenticated read activity" on public.activity_events for select to authenticated using (true);
create policy "authenticated read authority" on public.authority_actions for select to authenticated using (true);

-- Browser clients have no direct INSERT/UPDATE/DELETE policies for canonical state.
-- SECURITY DEFINER functions below require auth.uid() and derive the human actor
-- from it, so callers cannot attribute an authority action to someone else.
create or replace function public.wrx_assert_actor(p_actor_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or auth.uid() <> p_actor_id then
    raise exception using errcode = '42501', message = 'Authenticated actor is required.';
  end if;
end;
$$;

create or replace function public.wrx_create_episode(p_display_key text, p_project_id uuid, p_state_json jsonb, p_actor_id uuid)
returns public.episodes language plpgsql security definer set search_path = public as $$
declare created public.episodes;
begin
  perform public.wrx_assert_actor(p_actor_id);
  insert into public.episodes (display_key, project_id, state_json, current_stage, status, created_by)
  values (p_display_key, p_project_id, p_state_json, coalesce((p_state_json->>'currentStage')::integer, 0), coalesce(p_state_json->>'status', 'active'), p_actor_id)
  returning * into created;
  insert into public.activity_events (episode_id, actor_id, actor_kind, type, title, summary, payload)
  values (created.id, p_actor_id, 'human', 'episode.created', 'Episode created', coalesce(p_state_json->>'name', p_display_key), jsonb_build_object('shared', true));
  return created;
end;
$$;

create or replace function public.wrx_create_project(p_name text, p_description text, p_actor_id uuid)
returns public.projects language plpgsql security definer set search_path = public as $$
declare created public.projects;
begin
  perform public.wrx_assert_actor(p_actor_id);
  insert into public.projects (name, description, created_by)
  values (p_name, coalesce(p_description, ''), p_actor_id)
  returning * into created;
  return created;
end;
$$;

create or replace function public.wrx_update_episode(p_episode_id uuid, p_expected_version integer, p_state_json jsonb, p_actor_id uuid)
returns public.episodes language plpgsql security definer set search_path = public as $$
declare updated public.episodes;
declare current public.episodes;
begin
  perform public.wrx_assert_actor(p_actor_id);
  select * into current from public.episodes where id = p_episode_id;
  if not found then
    raise exception using errcode = '23503', message = 'Episode not found.';
  end if;
  if coalesce(p_state_json->'currentStage', 'null'::jsonb) is distinct from coalesce(current.state_json->'currentStage', 'null'::jsonb)
     or coalesce(p_state_json->'disposition', 'null'::jsonb) is distinct from coalesce(current.state_json->'disposition', 'null'::jsonb)
     or (coalesce(p_state_json->>'status', current.status) <> current.status
       and ('resolved' in (coalesce(p_state_json->>'status', current.status), current.status))) then
    raise exception using errcode = '42501', message = 'Controlled Episode fields require an authority action.';
  end if;
  update public.episodes
     set state_json = p_state_json,
         current_stage = current.current_stage,
         status = coalesce(p_state_json->>'status', status),
         version = version + 1,
         updated_at = now()
   where id = p_episode_id and version = p_expected_version
  returning * into updated;
  if not found then raise exception using errcode = 'WRX01', message = 'WRX_CONFLICT'; end if;
  return updated;
end;
$$;

create or replace function public.wrx_create_source(p_source_id text, p_episode_id uuid, p_file_name text, p_mime_type text, p_size_bytes bigint, p_original_object_key text, p_extracted_text_object_key text, p_extraction_status text, p_actor_id uuid)
returns public.sources language plpgsql security definer set search_path = public as $$
declare created public.sources;
begin
  perform public.wrx_assert_actor(p_actor_id);
  if not exists (select 1 from public.episodes where id = p_episode_id) then
    raise exception using errcode = '23503', message = 'Episode not found.';
  end if;
  insert into public.sources (id, episode_id, file_name, mime_type, size_bytes, original_object_key, extracted_text_object_key, extraction_status, created_by)
  values (p_source_id, p_episode_id, p_file_name, p_mime_type, p_size_bytes, p_original_object_key, p_extracted_text_object_key, p_extraction_status, p_actor_id)
  returning * into created;
  return created;
end;
$$;

create or replace function public.wrx_import_legacy_episode(p_bundle jsonb, p_actor_id uuid)
returns public.episodes language plpgsql security definer set search_path = public as $$
declare created public.episodes;
declare legacy_event jsonb;
begin
  perform public.wrx_assert_actor(p_actor_id);
  if p_bundle->>'format' <> 'ssi-wrx-local-episode-v1' or coalesce(p_bundle->'episode'->>'id', '') = '' then
    raise exception using errcode = '22023', message = 'Invalid local Episode export.';
  end if;
  insert into public.episodes (display_key, project_id, state_json, current_stage, status, created_by)
  values (
    p_bundle->'episode'->>'id', null, p_bundle->'episode',
    coalesce((p_bundle->'episode'->>'currentStage')::integer, 0),
    coalesce(p_bundle->'episode'->>'status', 'active'), p_actor_id
  ) returning * into created;
  for legacy_event in select value from jsonb_array_elements(coalesce(p_bundle->'episode'->'activity', '[]'::jsonb)) loop
    insert into public.activity_events (episode_id, actor_id, actor_kind, type, authority_impact, title, summary, payload)
    values (created.id, null, 'UNKNOWN_LEGACY', coalesce(legacy_event->>'type', 'legacy.activity'), legacy_event->>'authorityImpact', coalesce(legacy_event->>'title', 'Imported legacy activity'), coalesce(legacy_event->>'summary', ''), legacy_event);
  end loop;
  insert into public.activity_events (episode_id, actor_id, actor_kind, type, title, summary, payload)
  values (created.id, p_actor_id, 'human', 'episode.imported', 'Legacy Episode imported', 'Imported from a local browser export; historical human attribution remains unknown.', jsonb_build_object('format', p_bundle->>'format'));
  return created;
end;
$$;

create or replace function public.wrx_apply_authority_action(p_episode_id uuid, p_expected_version integer, p_action_type text, p_state_json jsonb, p_actor_id uuid, p_payload jsonb default '{}'::jsonb)
returns public.episodes language plpgsql security definer set search_path = public as $$
declare updated public.episodes;
begin
  perform public.wrx_assert_actor(p_actor_id);
  if p_action_type not in ('structure_accepted', 'follow_up_authorized', 'follow_up_continued', 'package_promoted', 'package_paused', 'package_rejected', 'stage_advanced', 'final_disposition_recorded') then
    raise exception using errcode = '42501', message = 'Authority action is not allowed.';
  end if;
  update public.episodes set state_json = p_state_json, current_stage = coalesce((p_state_json->>'currentStage')::integer, current_stage), status = coalesce(p_state_json->>'status', status), version = version + 1, updated_at = now()
   where id = p_episode_id and version = p_expected_version returning * into updated;
  if not found then raise exception using errcode = 'WRX01', message = 'WRX_CONFLICT'; end if;
  insert into public.authority_actions (episode_id, actor_id, action_type, prior_version, resulting_version, approved_scope, provenance)
  values (updated.id, p_actor_id, p_action_type, p_expected_version, updated.version, coalesce(p_payload->'approvedScope', '{}'::jsonb), p_payload);
  insert into public.activity_events (episode_id, actor_id, actor_kind, type, authority_impact, title, summary, payload)
  values (updated.id, p_actor_id, 'human', p_action_type, 'accepted', coalesce(p_payload->>'title', p_action_type), coalesce(p_payload->>'summary', ''), p_payload);
  return updated;
end;
$$;

-- Create a PRIVATE storage bucket called wrx-sources in the Supabase dashboard,
-- then apply these policies. Object keys are episode UUID/source ID paths.
insert into storage.buckets (id, name, public) values ('wrx-sources', 'wrx-sources', false) on conflict (id) do update set public = false;
create policy "authenticated read private WRX sources" on storage.objects for select to authenticated using (bucket_id = 'wrx-sources');
create policy "authenticated insert private WRX sources" on storage.objects for insert to authenticated with check (bucket_id = 'wrx-sources');
