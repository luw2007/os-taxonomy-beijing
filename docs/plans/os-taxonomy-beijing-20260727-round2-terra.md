# Round 2 — Terra 裁决方案

## Inputs and execution limits

- Luna (`scout`) completed read-only evidence retrieval.
- Sol planning request failed with `503 No available accounts`; GLM-5.2 has no route. Neither is represented as completed work.
- 1EdTech CASE v1.1 implementation guide and JSON Schemas were read directly. The package needs `CFDocument`; item fields include `identifier`, `fullStatement`, `uri`, `lastChangeDateTime`; association fields include `identifier`, `associationType`, `uri`, `originNodeURI`, `destinationNodeURI`, `lastChangeDateTime`. `precedes` is an allowed association type.

## Decisions

1. **Bind locally by default.** `--host` defaults to `127.0.0.1`; explicit `--host 0.0.0.0` is required for LAN exposure.
2. **Restore provenance through the path payload.** Every published edge gets compact `p`; `path.js` replaces dead `e.m` with accurate upstream/rule/AI-consensus/human badges.
3. **Extract `mergeTopics`.** It moves to `review-policy.mjs`; it owns collision detection and merged core fields. `serve.mjs` decorates viewer-only fields, JSONL and CASE consume core topics.
4. **CASE is export-only, not a hosted CASE service.** `export-case.mjs` requires `--base-url`, produces one CFPackage. Stable UUIDv5-style SHA-1 identifiers are namespaced by the base URL. `generatedAt` is manifest-derived rather than wall clock, preserving identical reruns. Topic edges become `precedes` from prerequisite to dependent. No hierarchy associations are invented.
5. **Clusters become full upstream-aligned translation data.** The existing orphan `(Science, Animals of the World, 6)` cannot safely be re-keyed, so it is removed rather than silently dropped. Existing matching translations remain. Newly generated summaries are marked `machine`; no existing translation is overwritten without `--force`.
6. **The alignedMath 2-node deficit is reported, not classified.** A deterministic audit report lists 446 candidate IDs, 335 math-key aligned IDs and 109 excluded-count assertion; it emits the 2 undisposed IDs when local alignment evidence permits. It never changes high/medium/low counters.

## Tests before implementation

- `serve-config` host parsing/defaults/rejections.
- `mergeTopics` text overlay, collision rejection, cn-origin status.
- `export-case` required CASE-shaped rows, stable UUIDs, direction, no internal fields, missing base-url failure.

## Safety

- `viewer/app.js` remains untouched.
- Translation writes only `clusters.zh.json`; first run is dry-run then real run; `checksum` and `validate --publish` follow.
- CASE export is gitignored output and CI validates it only when a real publication base URL exists.
