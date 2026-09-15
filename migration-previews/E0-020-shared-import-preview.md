# E0-020 shared import preview

Status: prepared only. No Supabase import, source upload, or local Episode mutation has occurred.

## Validated local export

| Field | Value |
| --- | --- |
| Local display key | `E0-020` |
| Title | Evaluate GPT-6 Astra for a bounded… |
| Local project linkage | `project-a8b72570-6207-4bee-ba61-6b086c07be0a` |
| Sources | 1, including extracted text and original bytes |
| Conversation messages | 0 |
| Workflow nodes | 6 |
| Work subthreads | 1 |
| Evidence/output additions | 14 |
| Activity events | 50 |
| Review state | pending |
| Final disposition | none |

The bundle passed the legacy bundle validator. Nested IDs are unique, source references resolve against the retained manifest, and all historical activity actors are explicitly `UNKNOWN_LEGACY`.

## Proposed import mapping

| Local item | Shared import result |
| --- | --- |
| `E0-020` | New Supabase `episodes.id` UUID, with `display_key = E0-020` retained |
| Local project linkage | Map to an existing shared project only after an explicit project-mapping decision; otherwise import with a null project ID |
| Episode JSON | Store the validated local Episode as `state_json`, preserving valid nested IDs |
| Each retained source manifest ID | Preserve as the `sources.id` value |
| Original source bytes | Upload privately to `wrx-sources/<shared_episode_uuid>/<preserved_source_id>/original` |
| Extracted source text | Upload privately to `wrx-sources/<shared_episode_uuid>/<preserved_source_id>/extracted.txt` |
| Source metadata | Create one `sources` row per uploaded source, pointing to those private object keys |
| Historical activity | Insert as local-import history with `actor_kind = UNKNOWN_LEGACY`; do not infer Emmanuel or David |
| Import action | Add one new, server-attributed `episode.imported` activity event for the authenticated importer |

## Version and collision plan

- The shared Episode UUID is intentionally unknown until the authorized import transaction creates it.
- Initial shared version will be `1`.
- A display-key collision must stop the import for human review; it must not overwrite an existing shared Episode.
- Source object paths are collision-safe because they are namespaced by the newly created shared UUID and preserved source ID.
- Unsupported or unknown local fields remain inside inspectable `state_json`; this preview does not normalize them away.

## Preconditions before import

1. Emmanuel explicitly authorizes importing this exact exported bundle.
2. A human chooses whether to map the local project linkage to a shared project or leave it unassigned.
3. The original local E0-020 remains unchanged as the rollback source of truth.
