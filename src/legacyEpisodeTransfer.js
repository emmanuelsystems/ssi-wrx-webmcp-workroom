import { getEpisodeSource, validateSourceManifest } from "./episodeSources";
import { legacyActor } from "./sharedState";

const STORAGE_KEY = "ssi-wrx-workroom-v4";

function bytesToBase64(bytes) {
  const view = new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function exportLocalEpisode(displayKey) {
  const episodes = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  const episode = episodes.find((item) => item.id === displayKey);
  if (!episode) throw new Error(`Local Episode ${displayKey} was not found.`);
  const validation = validateSourceManifest(episode.sources ?? []);
  if (!validation.valid) throw new Error(validation.error);
  const sources = [];
  for (const manifest of episode.sources ?? []) {
    const source = await getEpisodeSource(manifest.sourceId);
    if (!source?.original || !source.text) throw new Error(`Local source ${manifest.fileName} is missing.`);
    sources.push({
      manifest,
      text: source.text,
      originalBase64: bytesToBase64(source.original),
    });
  }
  return {
    format: "ssi-wrx-local-episode-v1",
    exportedAt: new Date().toISOString(),
    episode: {
      ...episode,
      activity: (episode.activity ?? []).map((event) => ({ ...event, actor: legacyActor() })),
    },
    sources,
  };
}

export function validateLegacyEpisodeBundle(bundle) {
  if (bundle?.format !== "ssi-wrx-local-episode-v1" || !bundle.episode?.id) throw new Error("Unsupported local Episode export.");
  const validation = validateSourceManifest(bundle.episode.sources ?? []);
  if (!validation.valid) throw new Error(validation.error);
  const expected = new Set((bundle.episode.sources ?? []).map((source) => source.sourceId));
  if (!Array.isArray(bundle.sources) || bundle.sources.length !== expected.size || bundle.sources.some((source) => !expected.has(source?.manifest?.sourceId) || typeof source.text !== "string" || typeof source.originalBase64 !== "string")) {
    throw new Error("Exported source records do not match the Episode manifest.");
  }
  return true;
}
