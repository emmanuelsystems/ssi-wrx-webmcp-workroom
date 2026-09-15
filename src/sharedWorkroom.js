import { nextSharedEpisode } from "./sharedState";

const env = import.meta.env ?? {};
const SUPABASE_URL = env.VITE_SUPABASE_URL?.replace(/\/$/, "");
const SUPABASE_ANON_KEY = env.VITE_SUPABASE_ANON_KEY;

export const sharedWorkroomConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

function assertConfigured() {
  if (!sharedWorkroomConfigured) throw new Error("Shared Workroom is not configured.");
}

async function request(path, { method = "GET", token, body, headers = {} } = {}) {
  assertConfigured();
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(payload?.message || payload?.error_description || payload?.msg || "Shared Workroom request failed.");
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

export async function signInWithPassword(email, password) {
  return request("/auth/v1/token?grant_type=password", {
    method: "POST",
    body: { email, password },
  });
}

export async function signOut(accessToken) {
  return request("/auth/v1/logout", { method: "POST", token: accessToken });
}

export async function getUser(accessToken) {
  return request("/auth/v1/user", { token: accessToken });
}

export function sessionFromAuth(auth) {
  if (!auth?.access_token || !auth?.user?.id) return null;
  return {
    accessToken: auth.access_token,
    refreshToken: auth.refresh_token ?? null,
    user: auth.user,
  };
}

export function storedSharedSession() {
  try {
    return sessionFromAuth(JSON.parse(sessionStorage.getItem("ssi-wrx-shared-session") || "null"));
  } catch {
    return null;
  }
}

export function saveSharedSession(session) {
  if (session) sessionStorage.setItem("ssi-wrx-shared-session", JSON.stringify({ access_token: session.accessToken, refresh_token: session.refreshToken, user: session.user }));
  else sessionStorage.removeItem("ssi-wrx-shared-session");
}

export async function loadSharedWorkroom(accessToken) {
  const [projects, episodes, profiles] = await Promise.all([
    request("/rest/v1/projects?select=*&order=created_at.asc", { token: accessToken }),
    request("/rest/v1/episodes?select=*&order=created_at.asc", { token: accessToken }),
    request("/rest/v1/profiles?select=id,display_name,email", { token: accessToken }),
  ]);
  const actors = Object.fromEntries((profiles ?? []).map((profile) => [profile.id, profile]));
  return {
    projects: (projects ?? []).map((project) => ({ ...project, createdAt: project.created_at, projectId: project.id })),
    episodes: (episodes ?? []).map((record) => ({ ...nextSharedEpisode(record, record.state_json), id: record.display_key, projectId: record.project_id ?? record.state_json?.projectId ?? null })),
    actors,
  };
}

export async function loadSharedEpisodeAudit(accessToken, episodeId) {
  const encodedEpisodeId = encodeURIComponent(episodeId);
  const [episodes, activityEvents, authorityActions] = await Promise.all([
    request(`/rest/v1/episodes?id=eq.${encodedEpisodeId}&select=id,display_key,version,current_stage,status,updated_at`, { token: accessToken }),
    request(`/rest/v1/activity_events?episode_id=eq.${encodedEpisodeId}&order=occurred_at.desc&select=id,episode_id,actor_id,actor_kind,type,authority_impact,title,summary,payload,occurred_at`, { token: accessToken }),
    request(`/rest/v1/authority_actions?episode_id=eq.${encodedEpisodeId}&order=occurred_at.desc&select=id,episode_id,actor_id,action_type,prior_version,resulting_version,approved_scope,provenance,occurred_at`, { token: accessToken }),
  ]);
  return {
    episode: episodes?.[0] ?? null,
    activityEvents: activityEvents ?? [],
    authorityActions: authorityActions ?? [],
  };
}

export async function createSharedEpisode(accessToken, episode, actorId) {
  const payload = await request("/rest/v1/rpc/wrx_create_episode", {
    method: "POST",
    token: accessToken,
    body: {
      p_display_key: episode.id,
      p_project_id: episode.projectId || null,
      p_state_json: episode,
      p_actor_id: actorId,
    },
  });
  return Array.isArray(payload) ? payload[0] : payload;
}

export async function createSharedProject(accessToken, project, actorId) {
  const payload = await request("/rest/v1/rpc/wrx_create_project", {
    method: "POST",
    token: accessToken,
    body: { p_name: project.name, p_description: project.description, p_actor_id: actorId },
  });
  return Array.isArray(payload) ? payload[0] : payload;
}

export async function updateSharedEpisode(accessToken, episode, expectedVersion, actorId) {
  try {
    const payload = await request("/rest/v1/rpc/wrx_update_episode", {
      method: "POST",
      token: accessToken,
      body: { p_episode_id: episode.sharedId, p_expected_version: expectedVersion, p_state_json: episode, p_actor_id: actorId },
    });
    return Array.isArray(payload) ? payload[0] : payload;
  } catch (error) {
    if (error.status === 409 || error.payload?.code === "WRX_CONFLICT" || error.payload?.message === "WRX_CONFLICT") error.code = "WRX_CONFLICT";
    throw error;
  }
}

export async function applyAuthorityAction(accessToken, { episode, expectedVersion, actorId, actionType, payload = {} }) {
  try {
    const result = await request("/rest/v1/rpc/wrx_apply_authority_action", {
      method: "POST",
      token: accessToken,
      body: {
        p_episode_id: episode.sharedId,
        p_expected_version: expectedVersion,
        p_action_type: actionType,
        p_state_json: episode,
        p_actor_id: actorId,
        p_payload: payload,
      },
    });
    return Array.isArray(result) ? result[0] : result;
  } catch (error) {
    if (error.status === 409 || error.payload?.code === "WRX_CONFLICT" || error.payload?.message === "WRX_CONFLICT") error.code = "WRX_CONFLICT";
    throw error;
  }
}

export async function uploadSharedSource(accessToken, source, episodeId) {
  const base = `${episodeId}/${source.sourceId}`;
  const originalKey = `${base}/original`;
  const extractedTextKey = `${base}/extracted.txt`;
  const upload = async (key, value, contentType) => {
    const response = await fetch(`${SUPABASE_URL}/storage/v1/object/wrx-sources/${key}`, {
      method: "POST",
      headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${accessToken}`, "content-type": contentType, "x-upsert": "false" },
      body: value,
    });
    if (!response.ok) throw new Error("Private source upload failed.");
  };
  await upload(originalKey, source.original, source.fileType || "application/octet-stream");
  await upload(extractedTextKey, source.text, "text/plain; charset=utf-8");
  return { originalKey, extractedTextKey };
}

export async function createSharedSource(accessToken, source, episodeId, actorId, objectKeys) {
  return request("/rest/v1/rpc/wrx_create_source", {
    method: "POST",
    token: accessToken,
    body: {
      p_source_id: source.sourceId,
      p_episode_id: episodeId,
      p_file_name: source.fileName,
      p_mime_type: source.fileType || "application/octet-stream",
      p_size_bytes: source.size,
      p_original_object_key: objectKeys.originalKey,
      p_extracted_text_object_key: objectKeys.extractedTextKey,
      p_extraction_status: source.extractionStatus,
      p_actor_id: actorId,
    },
  });
}

export async function importSharedEpisode(accessToken, bundle, actorId) {
  return request("/rest/v1/rpc/wrx_import_legacy_episode", {
    method: "POST",
    token: accessToken,
    body: { p_bundle: bundle, p_actor_id: actorId },
  });
}
