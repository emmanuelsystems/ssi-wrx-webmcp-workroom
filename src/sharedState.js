export function nextSharedEpisode(record, stateJson) {
  if (!record?.id || !Number.isInteger(record.version) || record.version < 1) throw new Error("Shared Episode record is invalid.");
  return {
    ...stateJson,
    sharedId: record.id,
    sharedVersion: record.version,
  };
}

export function classifySharedWriteError(error) {
  return error?.code === "WRX_CONFLICT" || error?.status === 409 ? "conflict" : "error";
}

export function legacyActor() {
  return { kind: "UNKNOWN_LEGACY", label: "Unknown legacy actor" };
}
