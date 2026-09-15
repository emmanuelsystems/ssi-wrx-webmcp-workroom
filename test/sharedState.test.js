import test from "node:test";
import assert from "node:assert/strict";
import { classifySharedWriteError, legacyActor, nextSharedEpisode } from "../src/sharedState.js";

test("shared episode keeps a stable database id and server version", () => {
  const state = nextSharedEpisode({ id: "cf9b29fd-4ee5-4cab-9768-f4d53f7f7b07", version: 12 }, { id: "E0-020", title: "Shared work" });
  assert.equal(state.id, "E0-020");
  assert.equal(state.sharedId, "cf9b29fd-4ee5-4cab-9768-f4d53f7f7b07");
  assert.equal(state.sharedVersion, 12);
});

test("a stale server response is classified as a conflict, never a successful overwrite", () => {
  assert.equal(classifySharedWriteError({ code: "WRX_CONFLICT" }), "conflict");
  assert.equal(classifySharedWriteError({ status: 409 }), "conflict");
  assert.equal(classifySharedWriteError(new Error("network")), "error");
});

test("legacy imports retain explicit unknown attribution", () => {
  assert.deepEqual(legacyActor(), { kind: "UNKNOWN_LEGACY", label: "Unknown legacy actor" });
});
