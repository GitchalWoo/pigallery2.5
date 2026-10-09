# Derivative Cache Freshness and Regeneration Plan

Date: 2026-10-09  
Status: Proposed; implementation and validation are not complete.

## Objective

Address both same-path source replacement ([upstream issue #1178](https://github.com/bpatrik/pigallery2/issues/1178)) and regeneration after rendering fixes, including the RAW extraction/orientation changes in this fork. Deliver supported administration and automatic freshness checks without shell access, manual cache deletion, or gallery database resets.

This implements the cache-correctness work identified in [Backend Audit, B2](Backend-Audit.md#b2--p1-completion-and-cache-identity-are-too-weak). The renderer changes described in [RAW Preview Safety and Orientation](RAW-Preview-Safety-and-Orientation-Plan.md) do not by themselves invalidate existing outputs.

**Scope includes thumbnails, icons, converted viewer/lightbox pictures, and face crops. In particular, CR2 and other RAW files supply embedded pictures used to render browser-viewable images; these larger pictures are affected just as thumbnails are. A thumbnail-only rebuild is insufficient.**

## Current behavior and evidence

| Area | Current behavior | Consequence |
| --- | --- | --- |
| Photo cache identity | `PhotoProcessing.generateConvertedPath` includes source path, size, quality, animation and subsampling | Same-path edits and renderer fixes reuse old outputs; other pixel-affecting settings are omitted |
| Face identity | Includes source path, person name, crop left/top, size and margin | Source changes, crop width/height and several rendering changes do not invalidate crops |
| Completion checks | Existing readable files are accepted | Incomplete or corrupt derivatives can become persistent cache hits |
| Publication | `PhotoWorker` writes to the final output path | Readers can encounter an incomplete output; failures can leave residue |
| Indexing | Incremental indexing can skip directories based on directory timestamps | In-place file edits can escape detection; full indexing still does not invalidate derivative files |
| Cleanup | `TempFolderCleaningJob` traverses transcoded files but preserves/skips the faces directory | Versioning face filenames alone leaves old crops behind |
| Browser cache | `RenderingMWs.renderFile` sets a one-year private freshness lifetime; frontend media URLs have no revision | Changing backend filenames alone cannot refresh already-cached browser images |
| Scheduling | Default cleanup follows the indexing/conversion job chain; indexing defaults to a never trigger | Existing job definitions do not guarantee cleanup will run after deployment |

Relevant implementation: `PhotoProcessing.ts`, `PhotoWorker.ts`, `ThumbnailGeneratorMWs.ts`, `PhotoConvertingJob.ts`, `IndexingJob.ts`, `TempFolderCleaningJob.ts`, `RenderingMWs.ts`, frontend `MediaIcon.ts`, `Media.ts`, `Person.ts`, and the lightbox media component.

The existing source review and B2 probes establish cache defects. They do not establish that every incorrect production RAW picture is a stale derivative. Fresh output from representative failing camera files must be checked before mass regeneration.

## RAW extraction and converted pictures

The current RAW path extracts an embedded JPEG into a buffer (`getRawPreview`), applies orientation and geometry, and writes the requested derivative, normally WebP. The inspected extraction path does not maintain a separate persistent extracted-JPEG cache.

Treat the pipeline as:

```text
RAW source (for example CR2)
  -> embedded picture selection/extraction, or original-file fallback
  -> effective orientation and displayed-image geometry
  -> thumbnail / icon / viewer picture / face crop
  -> published cached derivative
```

- A RAW extraction, candidate-selection, orientation or scaling revision invalidates every dependent output, including large viewer pictures.
- Regenerating an affected output reruns extraction and rendering from the original RAW; do not resize an old cached picture to produce its replacement.
- A scheduled rebuild must allow all configured viewer sizes, rather than only the small default conversion-job size. Sizes not precomputed regenerate on demand.
- If persistent extracted pictures are introduced later, give them their own source/extractor identity, ownership and cleanup rules. Their revision must propagate to downstream outputs.
- Do not claim that an embedded preview has the full sensor resolution or that regeneration repairs a renderer error. Verify camera-specific output separately.

## Requirements and boundaries

1. Detect ordinary same-path source changes across supported photo formats, and apply the shared image-derivative rules to video thumbnails/icons where they use `PhotoProcessing`.
2. Scope the initial renderer-fix invalidation to RAW. Do not mass-regenerate unaffected JPEG, PNG, GIF, WebP or video outputs merely because the application was upgraded.
3. Provide explicit, scoped regeneration independent of metadata indexing and gallery reset.
4. Preserve original media, user metadata, authentication and sharing behavior.
5. Retain public route paths. Allow additive revision fields/query parameters and frontend changes necessary for browser-cache correctness.
6. Publish complete outputs atomically, bound background resource use, and make superseded files collectable.
7. Preserve fork changes and existing user configuration. Do not silently enable an expensive whole-library rebuild.
8. Full video transcoding, GPX compression and unrelated job-concurrency redesign are separate work. Protect their files when modifying shared cleanup.

## Cache identity

Create one shared derivative identity/resolution service used by request generation, missing-thumbnail decoration, jobs and cleanup:

```text
derivative key = hash(canonical encoding of:
  cache schema version,
  source identity,
  source revision,
  scoped renderer revision,
  derivative kind and effective output recipe,
  explicit regeneration revision)
```

- Source identity: configured media-root identity plus normalized relative source path; do not tie identity to the gallery database row ID.
- Source revision: a recorded filesystem signature, optionally backed by a content digest.
- Renderer revision: explicit semantic revisions for affected pipelines, including RAW extraction/orientation. Do not use the application release number or Git commit.
- Recipe: all pixel-affecting inputs, including size, square/non-square mode, encoding quality, animation, subsampling, kernel, relevant Sharp options, full crop geometry, crop coordinate-space dimensions and margin. Define revision hooks for extensions that change rendering.
- Regeneration revision: persistent state advanced by an administrator's scoped rebuild, even when source and renderer are unchanged.

Use canonical structured serialization rather than ambiguous concatenation. Keep names bounded and use a collision-resistant digest. Hashing this identity is inexpensive and is distinct from reading and hashing the original file.

Prefer source-associated, sharded cache directories with a manifest recording source ownership, revisions and completed outputs. Finalize the exact layout/schema before coding. Include faces in this ownership model so cleanup does not need to reverse an opaque filename hash.

Define crash-safe manifest publication and reconciliation: a crash between output rename and manifest update must leave a recoverable orphan, not a falsely completed entry. Persistent regeneration/job state must survive process restarts and gallery database resets; document its storage and backup behavior.

## Detecting source changes and refreshing metadata

- Default signature: file size plus high-resolution modification time. Evaluate change time as an additional signal against the deployed filesystems; document precision and portability.
- Check source freshness on derivative requests and in a bounded file-level reconciliation job. Do not depend solely on parent-directory timestamps.
- Persist a source revision for listings/URLs. Reconciliation must refresh affected media metadata, face geometry and relevant listing/cover/person caches when a source changes.
- Batch asynchronous filesystem work; avoid adding synchronous per-size source checks to gallery responses.
- Request-time source changes must not combine new pixels with stale face coordinates. Refresh dependent metadata or defer affected crop generation until it is current.
- Define the freshness contract: request-time server checks plus configurable scheduled reconciliation; an already-open browser view receives revised URLs when its media data is refreshed. Immediate push updates are not required.

Provide optional **Verify source contents** maintenance: stream a content hash with bounded I/O, compare with the previously recorded digest, and refresh affected entries. Size/timestamps are change indicators, not proof of identical bytes. A first-ever digest cannot prove a legacy derivative came from the current bytes; apply the legacy policy below.

Include rendering-relevant sidecars/metadata in dependency tracking where applicable. Establish supported dependencies while tracing metadata loading; do not assume only the image file can change crop/render inputs.

## Administrator operations and indexing semantics

| Operation | Behavior |
| --- | --- |
| Index / refresh changed media | Refresh metadata and source signatures; invalidate derivatives of changed inputs |
| Verify source contents | Compare content digests, including changes concealed by preserved size/timestamps |
| Regenerate derivatives | Advance the selected regeneration revision regardless of source changes |
| Clean obsolete derivatives | Collect superseded outputs, eligible legacy files and abandoned temporaries |

Regeneration controls must support a single media item, folder/subtree, RAW formats, or the library; derivative categories must explicitly include **viewer/converted pictures**, thumbnails/icons and faces. Offer selected sizes or all configured sizes, and lazy regeneration or scheduled pre-generation.

Ordinary re-indexing of unchanged files must not automatically re-extract/re-encode everything. An explicit combined operation may refresh metadata and regenerate all selected outputs. It must preserve selection and progress across restart without advancing revisions repeatedly on resume.

Jobs need bounded concurrency and queue growth, cancellation/resume, useful per-file failures and counters for current, stale, generated, failed and reclaimed outputs. Keep interactive work responsive. Define a cleanup schedule independent of whether the indexing chain happens to run, and expose that policy in administration.

## Safe generation and repair

1. Resolve and validate source containment; capture the source and dependency revision.
2. Enter single-flight processing for the complete derivative identity and recheck whether a valid completed output exists.
3. Render to a unique temporary file on the destination filesystem.
4. Check successful encoder completion and output validity; reject empty/truncated output. Define validation depth without decoding every warmed-cache hit.
5. Recheck source/dependency revision before publication. Discard changed-input results and retry only within a bounded policy.
6. Atomically rename the completed file, then commit/reconcile the completion record according to the chosen manifest protocol.
7. Remove owned temporary files on errors/cancellation; recover abandoned files after restart.

Pre/post stat checks reduce races but cannot guarantee a consistent read under arbitrary undetectable concurrent rewrites. Document the supported source-update contract and use an immutable snapshot or equivalent stronger mechanism if that guarantee is required.

Retain a supported repair path for corrupt current-revision derivatives. Track bounded retries/backoff so a permanently failing source does not cause an endless render loop. Do not silently mark old, known-incorrect RAW pictures as current after a new render fails.

Determine whether multiple backend processes may share a cache. If supported, add cross-process coordination and test it; the existing in-process task queue is insufficient. Otherwise document and enforce the deployment limitation.

## Browser and API behavior

- Add a server-derived revision to generated media URLs, for example `/pgapi/gallery/content/IMG_3495.CR2/540?v=<revision>`.
- Cover viewer images and preloads, thumbnails, replacement thumbnails, icons, directory/album covers and person crops. Audit original-media URLs for the same source-change caching problem.
- Keep existing routes usable. Unversioned URLs should revalidate rather than receive the current long freshness lifetime.
- The backend determines identity; arbitrary query values must not generate arbitrary new cache entries or bypass authorization.
- Serve a long-lived versioned response only when the requested revision matches the representation. Define stale-token behavior explicitly; never cache new bytes for a year under an old identity.
- Refresh revision-bearing listing data and relevant frontend caches. RAW renderer revision changes must reach URLs without requiring a database reset or source modification.
- Previously cached unversioned responses cannot be recalled through new server headers. Updated frontend URLs provide the deployment transition.

## Cleanup, migration and rollback

Cleanup must understand ownership and current identity, rather than equating an unrecognized suffix with permission to delete. Parse legacy and new layouts explicitly; appending `_r1` would break the current last-underscore parser without corresponding changes.

- Retain superseded revisions for a configurable grace period; protect active generation/publication and serving from cleanup races.
- Remove obsolete revisions in bounded batches and report counts, bytes and failures. Support dry-run inspection before migration deletion.
- Reclaim eligible obsolete generations under storage pressure without requiring every replacement to be pre-generated. Pause generation cleanly if space is insufficient.
- Distinguish confirmed removal from inaccessible storage, permission errors and an unavailable media mount. A failed source check must not trigger a cache-wide purge.
- Keep manifests, maintenance state and temporary files within explicitly recognized paths. The current root cleaner deletes unrecognized entries, so update it before introducing a new cache directory.
- Define rollback behavior. Older binaries may not recognize new cache layouts and must not run their old cleaner against them. Retention is only useful when the rollback procedure protects it.

### Legacy policy

| Legacy output | Initial treatment |
| --- | --- |
| RAW thumbnails/icons/converted viewer pictures | Treat as stale for the corrected RAW renderer; regenerate lazily or through a scoped job |
| Known RAW face crops | Reconstruct legacy keys from known source/face metadata where possible; retire those keys through migration |
| Unaffected standard-image/video derivatives | Preserve during RAW rollout; migrate/adopt only under an explicit policy, without eager mass rendering |
| Unclassified historical face crops | Retain and report until an explicit legacy-retirement policy permits deletion |

Legacy outputs lack their original source fingerprint. Do not claim their historical freshness can be proven by recording today's source stat/hash. Offer either conservative regeneration on adoption or explicitly documented reuse until the next detected change/forced rebuild. Strict freshness requires the former; it can be rate-limited and lazy.

Existing opaque face hashes cannot reliably identify all historical RAW crops. It is not possible to promise both complete RAW-orphan removal and zero non-RAW deletion from those hashes alone. Do not clear the entire faces directory as an implicit RAW migration step. Establish a finite retention/retirement policy for unknown legacy files and make the broader scope explicit to administrators.

## Implementation stages

### 1. Confirm behavior and freeze contracts

- [ ] Reproduce same-path replacement and stale RAW thumbnail **and viewer picture** in isolated fixtures.
- [ ] Compare fresh output from failing production-camera samples; separate renderer defects from stale-cache defects.
- [ ] Inventory all derivative consumers, recipes, metadata dependencies and cache headers.
- [ ] Decide manifest schema/layout, legacy-adoption policy, storage placement, freshness interval and multi-process support.

### 2. Shared identity and safe publication

- [ ] Implement identity/resolution and ownership/completion records.
- [ ] Add atomic publication, source-change checks, repair behavior and single-flight coordination.
- [ ] Switch generation, cache checks and decoration to the shared rules, including faces and large viewer pictures.
- [ ] Introduce cleanup support for the layout before enabling migration.

### 3. Source freshness and browser revisions

- [ ] Implement file-level reconciliation and dependent metadata/listing invalidation.
- [ ] Add revision-bearing URLs and compatible revalidation behavior across all consumers.
- [ ] Add optional content verification and regression coverage for preserved timestamps.

### 4. Scoped regeneration and RAW deployment

- [ ] Add administrator controls, durable scope/revision state and resumable generation.
- [ ] Activate a RAW renderer revision covering extraction and all derived pictures.
- [ ] Provide lazy default regeneration and optional bounded pre-generation of every requested size/category.
- [ ] Implement legacy migration, grace periods, cleanup scheduling, storage limits and rollback instructions.

### 5. Validate and document completion

- [ ] Complete the matrix below; record commands, outcomes and environmental limitations.
- [ ] Measure cache-hit overhead, rebuild resource usage and cleanup cost on representative storage.
- [ ] Update B2, fork inclusion notes and the RAW rollout documentation only for verified behavior.

## Acceptance matrix

| Case | Required result |
| --- | --- |
| JPEG/RAW replaced at identical path | New source revision; current metadata, thumbnails and viewer pictures |
| In-place edit with unchanged parent directory timestamp | File reconciliation detects it |
| Same size and restored timestamps | Content-verification mode detects changed bytes against a prior digest |
| RAW extraction/orientation revision only | RAW thumbnails, icons, large viewer pictures and face crops regenerate; unrelated formats remain reusable |
| Small thumbnail rebuilt, large CR2 picture previously cached | Lightbox receives the new large picture, including preload and browser-cache paths |
| Force rebuild with unchanged source/configuration | Selected scope gets one durable new revision; restart/resume does not repeat invalidation |
| Crop width/height, kernel, quality, Sharp options or square mode changes | Distinct correct identity; no icon/thumbnail collision |
| Source changes while generating | Old work is not published as current; bounded retry |
| Slow writer, duplicate requests, termination, disk-full | No partial final output or false completion; owned temporaries recovered |
| Corrupt current derivative | Repair is possible without a global reset; retries remain bounded |
| Cleanup overlaps generation/read | Active work and responses remain safe; obsolete files eventually collected |
| Missing or inaccessible media mount | Cleanup preserves cache and reports unavailable source storage |
| Legacy names, uppercase RAW extensions, underscores in source names | Correct classification; unrelated files preserved |
| Legacy hashed face orphan | Reported/retained or explicitly retired according to policy; no implied RAW-only classification |
| Browser retains old unversioned image | Updated frontend requests revised URL; stale tokens cannot mislabel new bytes |
| Gallery reset, process restart, rollback | Regeneration state and cache lifecycle follow documented persistence/compatibility rules |

Run focused backend tests on Node 24, frontend URL/cache tests and browser checks with an already-warmed cache. Use `npm run build-en` for template/build coverage and follow repository test setup guidance. Tests must use isolated sources/cache/configuration; do not delete production caches. This document records planned validation, not tests already passed.
