-- Existing shared Workrooms: make the ordinary save RPC unable to change
-- human-controlled stage, disposition, or resolved state.
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
