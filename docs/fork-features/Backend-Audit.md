# Backend performance and resource-lifecycle audit

Date: 2026-10-09. Reviewed revision: `524432a399b69377d9ee6bc58aff7a6cb6163122`.
Audit only: no application, dependency or persistent configuration changes.

## Highest-impact findings

The best HEIC runtime experiment is **bounded parallel processing of independent
files**, followed by **source reuse across sizes if decoding dominates**. Today a
Photo Converting job awaits every size of every file sequentially, despite the
shared renderer having multiple slots. Neither opportunity is a measured HEIC
speedup: the host-side npm Sharp installation tested during this audit can read
HEIC headers but lacks HEVC decoding. **The container build separately adds
HEIC codec support and rebuilds Sharp against custom libvips.** The host failure
is a limitation of this audit environment, not evidence of missing container
codecs; conversion performance inside the container remains unmeasured.

Fix completion and lifecycle defects before increasing load. Readable partial
thumbnails are accepted as completed work, RAW extraction can leak a descriptor
on failure, and the job overlap guard reverses the meaning of its parallel flag.

| ID | Priority | Finding | Evidence |
| --- | --- | --- | --- |
| B1 | P1 | One active render per conversion job; fresh source pipeline for each size | Verified execution path; runtime benefit unmeasured |
| B2 | P1 | Partial/stale derivatives pass completion checks | Source review + isolated zero-byte/source-change probes |
| B3 | P1 | RAW preview handle not closed on read/allocation failure | Source review + injected read failure |
| B4 | P1 | Inverted parallel-job guard; cancellation/shutdown do not drain work | Guard reproduced; lifecycle paths statically verified |
| B5 | P2 | Disk-mode jobs enumerate the whole library; unwanted child metadata reads | Source review + child metadata call-count probe |
| B6 | P2 | Synchronous per-thumbnail filesystem checks block response decoration | Verified call counts from loops; latency unmeasured |
| B7 | P2 | File jobs use unordered OFFSET pagination | Generated SQL + isolated SQLite EXPLAIN |
| B8 | P2 | Index save queue has ineffective deduplication and no backpressure | Verified source; large-library impact needs measurement |
| B9 | P2 | Person/index maintenance repeats lookups and queries | Verified loops + SQLite sample-selection plan |
| B10 | P2 | Job progress persistence is not a durable completion/resume protocol | Verified source; crash scenarios not injected |
| B11 | P2 | Video thumbnails repeat probes; subprocess cancellation is incomplete | Verified source; subprocess timing unmeasured |
| B12 | P2 | Upload buffering has a large bounded memory ceiling; GPX work blocks JS | Verified allocation/algorithm paths; peak memory unmeasured |

P1 means address early because of direct job runtime opportunity or lifecycle
correctness. P2 means a concrete follow-up whose practical priority depends on
library size and workload. “Verified” does not mean production latency was
measured. No general HEIC bottleneck or speedup is claimed here.

## Findings and focused validation

### B1 — P1: serial job producer and repeated source pipelines

Sources: `src/backend/model/jobs/jobs/FileJob.ts:74` (`step`),
`src/backend/model/jobs/jobs/PhotoConvertingJob.ts:83` (`processFile`),
`src/backend/model/fileaccess/fileprocessing/PhotoProcessing.ts:20` (`init`,
`generateThumbnail`), `src/backend/model/fileaccess/PhotoWorker.ts:171`
(`ImageRendererFactory.render`), and `src/backend/model/fileaccess/TaskExecuter.ts`
(`execute`, `run`). Resources: CPU, disk reads, worker capacity, memory.

A job step shifts one path, awaits `shouldProcess`, then awaits `processFile`.
That method awaits `generateThumbnail` inside its size loop. Each missing size
constructs a new Sharp instance from the original filename, reads metadata,
auto-orients, resizes, encodes WebP at effort 6 and writes it. HEIC takes this
ordinary filename path; there is no dedicated HEIC embedded-preview extraction
job. RAW alone calls `getRawPreviewBuffer` before Sharp. Multiple RAW sizes also
repeat exifr parsing, preview allocation and preview reads.

The shared executor deduplicates equal queued/in-flight inputs and limits active
calls, but a lone conversion job feeds it only one call at a time. Raising
`concurrentThumbnailGenerationsLimit` alone cannot parallelize that producer.
The default job requests only the first configured size; multi-size repetition
applies when more sizes are selected or later requested by the UI. Successful
existing outputs are skipped independently.

`metadata()` reads headers, not a second full pixel decode. The separate
`toFile()` pipelines do perform source processing independently; there is no
application-level shared decoded image, and `sharp.cache(false)` disables the
libvips operation cache. OS page-cache hits may avoid physical reads, but not
all parsing/decoding/encoding. This distinction is supported by installed Sharp
0.35.5 `dist/input.cjs:578` and its [metadata documentation](https://sharp.pixelplumbing.com/api-input/).

**Improvement:** first measure a small bounded producer across files (1, then 2
in-flight), reserving capacity for interactive requests. Keep sizes sequential
initially to bound each file's live memory. If decode is dominant for multi-size
HEIC, prototype one oriented/color-normalized decoded source shared by the
requested resizes, with explicit byte-based admission and prompt release. If
WebP encoding dominates, test effort separately against output size and visual
quality; do not silently lower quality.

`Sharp.clone()` copies options/input; it is not proof of one shared decode
(installed `dist/constructor.cjs:486`). Reading the compressed file once into a
Buffer avoids repeated file reads but does not inherently avoid per-pipeline
decoding. Reusing a lossy WebP derivative introduces another encoding generation
and may lack enough pixels for face crops or larger output. Preserve orientation,
ICC/color conversion, alpha, animation/page selection and source-specific options.
Do not substitute RAW preview extraction for HEIC decoding without proving that
the HEIC contains a suitable preview.

**Validation/measurement:** instrument queue wait, metadata, rendering and write
completion; compare one-file latency and fixed-batch files/minute, CPU seconds,
peak RSS, event-loop delay and interactive thumbnail p95. Test cancellation,
errors, duplicate requests and all sizes. See the profiling protocol below.

### B2 — P1: completion and cache identity are too weak

Implementation plan: [Derivative Cache Freshness and Regeneration](Derivative-Cache-Freshness-and-Regeneration-Plan.md), covering upstream #1178 and scoped regeneration of thumbnails, RAW-derived viewer pictures and face crops. Status: planned, not resolved.

Sources: `PhotoProcessing.ts` (`generateConvertedPath:120`,
`generatePersonThumbnailPath:134`, `isValidConvertedPath:164`,
`convertedPhotoExist`, `generateThumbnail:269`), `PhotoWorker.ts`
(`ImageRendererFactory.render` → `toFile`), and
`src/backend/model/jobs/jobs/TempFolderCleaningJob.ts` (cleanup caller).
Resources: wasted CPU/I/O after invalidation, incorrect cached results, overlapping writers.

Photo rendering writes straight to the final cache path. Both `shouldProcess`
and request-time generation accept a contained, readable path without checking
that it is a complete image. Another caller can observe a file during writing,
or an interrupted/failed output can survive and become a permanent cache hit.
An isolated probe using the actual `convertedPhotoExist` method accepted a
zero-byte file. Changing the source content did not invalidate that path.

The ordinary key includes relative source filename, size, quality, animation
flag and smart subsampling, but no source fingerprint, resize kernel, Sharp
options or square/non-square mode. A configured icon size equal to a thumbnail
size therefore addresses the same output for different geometry. Person keys
omit source freshness, box width/height, quality and kernel. Cleanup validates
configuration/path existence, not source freshness or image completeness.

**Improvement:** use unique same-directory temporary files, validate successful
output, then atomically rename; always remove failed owned temporaries. Recheck
completion inside an output-key single-flight operation, not only before queue
admission. Version derivative keys/manifests with the effective transform and
source identity (at least stat size/mtime, with a documented policy for restored
timestamps). Do not hash every original on every request. Define migration and
cleanup for old keys, and account for immutable media HTTP caching.

**Validation/measurement:** injected write error/termination, slow writer plus
second requester, zero-byte output, in-place replacement, equal icon/thumbnail
sizes, changed crop dimensions and changed settings. Count renderer executions
and invalid cache hits; compare warmed-cache throughput and stat overhead.
Video conversion's `.part` then rename is a useful existing pattern, though its
fixed temporary name and input mutation should not be copied blindly.

### B3 — P1: RAW preview descriptor ownership is not exception-safe

Source: `src/backend/model/fileaccess/PhotoWorker.ts:139`
(`ImageRendererFactory.getRawPreviewBuffer`). Resources: descriptors and memory.

After `fsp.open`, allocation and `handle.read` precede `handle.close` without a
`finally`. Either failure jumps to the catch/fallback and leaves the handle
unclosed. The isolated injected-read-error probe observed **zero close calls**.
The function also trusts numeric EXIF length/offset, ignores `bytesRead`, and
returns the entire allocated buffer after a short read. Malformed lengths can
cause large allocations; a short read can return zero-filled trailing bytes.
A preview that fails only during deferred Sharp decoding does not trigger the
original-file fallback around extraction.

**Improvement:** close in `finally`, validate finite integer offsets/lengths
against file size and a justified allocation limit, and read the requested range
fully or reject it. Validate preview dimensions/format before treating it as
usable. Preserve fallback and error context. This is a RAW-specific defect, not
evidence of a HEIC descriptor leak.

**Status:** Resolved in `src/backend/model/fileaccess/PhotoWorker.ts` and `src/backend/model/fileaccess/fileprocessing/PhotoProcessing.ts` (tested in `test/backend/unit/model/fileaccess/PhotoWorkerRawPreview.spec.ts`):
- Exception-safe descriptor lifecycle: `readByteRange` wraps all operations following `fsp.open` in `try/finally`, guaranteeing `handle.close` execution on success, stat failure, bounds error, allocation failure, or read error, preserving primary errors if cleanup encounters issues.
- Bounded allocations & bounds validation: `MAX_COMPRESSED_PREVIEW_BYTES` (32 MiB) is validated before handle opening or allocation; `parseSafeRange` ensures safe integer offsets and lengths; range bounds are verified against file size via subtraction (`offset <= fileSize && length <= fileSize - offset`).
- Exact read loop: advances position and offset by `bytesRead`, rejects premature 0-byte reads, preventing incomplete/zero-padded buffer return.
- Candidate validation & fallback: `validatePreviewCandidate` verifies JPEG headers and exercises actual pixel decoding via `sharp.resize(1,1).raw().toBuffer()` (~5ms) to catch truncated/corrupt streams before selection. Fallback bounded sequence evaluates strip -> thumbnail offset -> `exifr.thumbnail` -> original file Sharp decode.
- Orientation & geometry: parses numeric orientation with `translateValues: false`, implements full 1–8 EXIF orientation transforms with precedence (preview JPEG > container > 1), corrects non-square short-side resizing in oriented coordinates, and scales face crops (`cutOriginalSize`) when preview dimensions differ from RAW metadata.

**Validation/measurement:** truncated/malformed RAW, injected allocation/read
failure, short reads, absent preview and normal CR2/ARW. Compare `/proc/<pid>/fd`
counts over repeated failures, bytes allocated and extraction time. Preserve
commit `541a59eb`'s embedded-JPEG path, which avoids problematic TIFF decoding
and sensor demosaicing; do not undo that stability fix to simplify the pipeline.

### B4 — P1: overlap policy is inverted; cancellation is only between steps

Sources: `src/backend/model/jobs/JobManager.ts:29` (`JobNoParallelRunning`,
`run`, `cleanUp`), `src/backend/model/jobs/jobs/Job.ts:48` (`start`, `cancel`,
`run`, `onFinish`), `FileJob.step`, `PhotoConvertingJob.processFile`,
`src/backend/server.ts:144` (`SIGTERM`), `src/backend/model/ObjectManagers.ts:59`
(`reset`). Resources: worker/subprocess capacity, buffers, incomplete outputs.

`JobNoParallelRunning` looks for a running job with `allowParallelRun === true`,
rather than a job disallowing parallelism. A source-backed mock probe produced:

| Existing job permits parallel | Incoming job permits parallel | Observed start allowed |
| --- | --- | --- |
| false | false | no |
| false | true | **yes** |
| true | false | no |
| true | true | **no** |

This can unexpectedly overlap an exclusive job while rejecting permitted
parallel jobs. Overlap with TempFolderCleaningJob is particularly risky: its
`isValidFile` rejects active video `.part` files, so it can remove an output still
being written. This interleaving is source-derived, not reproduced here. Fix the predicate with this truth-table regression test before
using scheduler flags to seek throughput.

`cancel()` only marks state. The current file, including its remaining sizes,
continues; Sharp work/queued tasks and FFmpeg commands receive no abort signal.
`JobManager.cleanUp()` only removes schedule timers. SIGTERM closes the HTTP
server then exits, without awaiting these jobs or progress writes. With no
active HTTP request, a background conversion can be interrupted immediately.
`ObjectManagers.reset` waits for indexing saves but does not drain conversion
work. The generic `Job.start` launches async `init` without awaiting it; today's
FileJob/IndexingJob initializers do their state changes synchronously, but future
async/extension initializers can race the first step. A thrown `step` sets failed
state without settling the instant-job promise or invoking finish cleanup.
Per-file conversion errors are caught earlier in `FileJob` and continue instead.

**Improvement:** explicit job initialization/completion promises; stop admission,
remove canceled pending tasks, drain active tasks with a bounded shutdown policy,
flush progress, then close managers/DB. For native work that cannot be safely
interrupted, report “cancelling” until it settles. Connect subprocess termination
to job ownership. Shared requests must not cancel work still owned by others.

**Validation/measurement:** cancel during size 1 of several; saturated queue;
active video child; init/step errors; SIGTERM with no HTTP clients. Record time to
quiescence, remaining tasks/children/handles, and cache integrity after restart.

### B5 — P2: enumeration precedes processing and metadata-free scans are not free

Sources: `FileJob.ts` (`step:74`, `loadADirectoryFromDisk:131`),
`src/backend/model/fileaccess/DiskManager.ts` (`scanDirectoryNoMetadata`,
`scanDirectory:141`, child cover recursion around line 215),
`src/backend/model/fileaccess/MetadataLoader.ts:179` (`loadPhotoMetadata`).
Resources: memory, network/disk I/O, startup latency.

With `indexedOnly=false`, `step` keeps scanning while `directoryQueue` is
nonempty, even when `fileQueue` contains work. The full tree's file paths are
retained before conversion begins. Repeated `Array.shift` adds queue maintenance
cost. Each directory is also read into a whole Dirent array.

FileJob sets `noChildDirPhotos=true`, but DiskManager never consumes it. The
child recursion passes only `{coverOnly:true}`, losing `noMetadata` and other
parent scan filters. A temporary directory with one child JPEG and a stubbed
metadata loader produced **one metadata call** during
`scanDirectoryNoMetadata('/', {noChildDirPhotos:true})`. The child cover is read
before the later full child scan. This is independent of any HEIC decode timing.

**Improvement:** interleave traversal with processing using bounded queues and
an iterator/head index; honor child-scan suppression and propagate appropriate
filters. Keep cover discovery for gallery scans that actually need it, symlink
containment, ignore-marker rules and metadata precedence.

**Validation/measurement:** nested tree with photo/video/metafile filters, symlink
aliases, excluded directories and unreadable files. Count readdir/stat/metadata
calls; compare time to first converted file, maximum queued paths and peak RSS
on a large synthetic directory tree and a representative network mount.

### B6 — P2: synchronous filesystem work scales with response size

Sources: `src/backend/middlewares/thumbnail/ThumbnailGeneratorMWs.ts`
(`addThInfoToAPhoto`, `addThumbnailInfoForPersons`), `MetadataLoader.ts`
(`loadPhotoMetadata:179`), `IndexingJob.ts` (`step`),
`IndexingManager.ts:75` (`indexDirectory`), `SafePath.ts` (`resolveExisting`).
Resources: event loop and filesystem metadata I/O.

Thumbnail decoration calls `existsSync` for each thumbnail-map entry per media,
plus directory cover decoration; person decoration adds one check per person.
With the default four sizes and one distinct icon size this is five synchronous
checks per media. Photo metadata reads synchronously stat each source and can
check four sidecar candidate paths. Indexing synchronously readdir's the root
on every indexed directory, and its changes-only path uses exists/statSync.
On a slow mount, other requests wait even when no pixels are decoded.

The conversion job also checks existing outputs in `shouldProcess` and again
inside generation. A successful `resolveExisting` uses realpath on both root
and target, followed by access. These are measurable redundant metadata trips,
but the canonical containment checks are security controls, not disposable
“unnecessary stats.” Warm filesystem caches reduce physical I/O, not JS blocking
or syscall count.

**Improvement:** bounded async response decoration or a carefully invalidated
per-directory derivative manifest; reuse a validated existence result within a
single operation while still rechecking at publication. Use async metadata/root
checks. Preserve the empty-root safeguard against wiping the index when a
library mount disappears; do not simply delete it.

**Validation/measurement:** record filesystem call counts and event-loop delay
for 1,000-item responses while another lightweight request runs. Test missing,
newly generated, deleted and symlinked cache entries. Avoid unbounded
`Promise.all` over the library or a long-lived cached security decision.

### B7 — P2: unstable OFFSET paging rather than an index-seek cursor

Source: `FileJob.ts:180` (`loadMediaFilesFromDB`, `countMediaFromDB`).
Schema: `src/backend/model/database/enitites/MediaEntity.ts`,
`DirectoryEntity.ts`, `FileEntity.ts`. Resources: DB reads, round trips, hydration.

The job counts matching rows once, then loads narrow path fields in batches
(default 1,000) using LIMIT/OFFSET without ORDER BY. Later pages must skip earlier
rows; concurrent indexing/deletion can shift pages and omit/repeat work. The
shared media/metafile offset would skip rows for a subclass requesting both
tables; Photo Converting has `noMetaFile=true`, so that secondary issue does not
affect its current path. This is batch access, not a per-photo SQL query.

An isolated in-memory SQLite database built from the current entity decorators
and SQL captured during `getMany()` showed:

| Query | SQLite plan |
| --- | --- |
| Current path selection, LIMIT 1000 OFFSET 10000 | SCAN media USING COVERING INDEX on unique `(name,directoryId)`; directory PK lookup |
| Candidate `media.id > :cursor ORDER BY media.id LIMIT 1000` | SEARCH media USING INTEGER PRIMARY KEY `(rowid>?)`; directory PK lookup |

This verifies plan shape, **not a measured slow query**: the schema was empty,
not populated with a representative library. TypeORM adds primary-key columns
for hydration even though the source select lists paths. Existing PK, directory
FK and name/directory uniqueness indexes are present; do not prescribe a missing
join index here.

**Improvement:** ordered keyset pages with separate cursors per entity/table and
an explicit high-water mark or documented live-scan semantics. Consider raw path
rows to avoid hydration only after preserving discriminator and relationship
semantics. Do not hold a DB transaction open during file conversion to freeze
pagination.

**Validation/measurement:** dedicated populated DB at 1k/100k/1m rows; first/middle/
last-page query times, rows visited and total job enumeration time. Concurrent
insert/delete tests must account for every intended source exactly once. Repeat
EXPLAIN and timings on MariaDB/MySQL; no MariaDB measurements were performed.

### B8 — P2: indexing queue grows without effective deduplication

Sources: `IndexingManager.ts` (`indexDirectory:75`, `queueForSave:158`,
`runSavingLoop`, `saveToDB`, `saveMedia`, `saveMetaFiles`). Resources: retained
metadata graphs, event loop, database write queue.

Scanning can return before persistence. The queue merely warns above 100
entries; it does not throttle producers. Its equality test compares
`(entry.dir.media || entry.dir.media.length)` with the analogous new expression.
Arrays are truthy, so independently scanned arrays are compared by reference,
not length/content. `lastScanned` also differs on later scans. Simultaneous scans
of the same directory are not coalesced before metadata work. Replacing `||`
with a length comparison alone would not be a safe content-version check.

**Improvement:** bound queued bytes/directories and await admission when full;
coalesce concurrent scans by directory with explicit refresh/version rules.
Replace repeated in-memory `findIndex`/splice reconciliation with maps where
identity is known. Keep a single SQLite write lane; do not turn all directory
saves into concurrent transactions. Preserve rejection of queued promises and
`SavingReady` settlement introduced/fixed in `95de5eb1` (and the queue warning in
`ca0a5c18`), plus NaN cleanup from `af1e3387`.

**Validation/measurement:** scans faster than writes, two requests for one folder,
a folder modified while queued, and injected DB save failure. Record queue
high-water bytes, metadata calls, p95 response latency, save rate and whether all
waiters settle. Current scanning/decoding is outside `saveToDB`; no explicit
transaction surrounds HEIC conversion or the complete scan/save operation.

### B9 — P2: person maintenance has repeated global reads and N sample queries

Sources: `IndexingManager.ts` (`saveMedia`, `savePersonsToMedia`),
`src/backend/model/database/PersonManager.ts:58` (`saveAll`) and `:159`
(`updateCacheForAll`), `enitites/person/PersonJunctionTable.ts`, `MediaEntity.ts`.
Resources: DB round trips, hydration and JS reconciliation CPU.

For each saved directory, `savePersonsToMedia` calls `PersonManager.saveAll`,
which loads all persons, then loads all persons again itself. Both use linear
name searches. Media and face reconciliation also use nested scans/splices.
On person-cache refresh, counts are batched in groups of 200, but best sample
selection awaits one query per person. Batch cache upserts already exist; keep
them. The per-person query is explicitly justified by compatibility with older
SQLite in commit `d1def7437`; a window-function replacement needs supported DB
version decisions and ranking tie tests.

The isolated SQLite sample query used the existing personId index, media PK
lookups, then a temporary B-tree for rating/date ordering. Indexes on media
rating and creation date separately do not automatically remove a sort after a
person/media join. No claim that an additional composite index will fix it is
justified by this empty-schema plan alone.

**Improvement:** fetch only relevant person names/IDs once, use maps, and prototype
batched top-per-person selection with identical projection filtering and stable
ties. Check junction identity by **person and media**, not just person name:
the current reconciliation matches names only, which can retain an old link
when a person's occurrence moves between existing photos in the same folder.
Treat that as a correctness test before optimizing the loop.

**Validation/measurement:** query counts for 200/2,000 uncached persons, full vs
restricted projections, deleted/moved faces and tied ratings/dates. Compare
cache-refresh elapsed time, rows fetched and RSS on SQLite and MariaDB. The N
sample queries are verified; their share of real workload time is unknown.

### B10 — P2: job progress is lossy status, not reliable completion/resume

Sources: `FileJob.step`, `src/backend/model/jobs/jobs/JobProgress.ts` (`log`,
`Processed`, `toDTO`), `src/backend/model/jobs/JobProgressManager.ts`
(`loadDB:53`, `saveDB`, `delayedSave`), `JobManager.onJobFinished`.
Resources: repeat work, status serialization, progress-file I/O.

`Processed` increments before conversion; a per-file error is logged and the
job continues, potentially finishing and triggering dependent jobs despite
failed files. There is no automatic per-file retry or durable file checkpoint;
restart enumerates again and relies on derivative existence checks (B2).
Progress writes are throttled to five seconds, so there is **not** a SQL write
per converted file. Logs are bounded near `maxSavedProgress` (the check before
push permits one extra entry), not an unbounded per-file history.

`jobs.db` is directly overwritten, the asynchronous load can race early updates,
and saved-history pruning runs only at load. Distinct configuration hashes can
grow the map during a long-lived process. A slow write can overlap the next
five-second save because the timer is cleared before write completion. There
is no shutdown flush. These are source-verified hazards, not reproduced crashes.

**Improvement:** separate attempted/succeeded/failed counts; define whether
partial failure blocks after-jobs. Serialize atomic snapshot writes, await load
before accepting updates, prune on insertion and flush on shutdown. Retry only
classified transient failures with limits/backoff; keep successful derivatives.

**Validation/measurement:** conversion failure on size 2, failed progress write,
slow write beyond five seconds, immediate startup job and termination before
flush. Compare snapshot counts/bytes and restarted work; do not introduce a
per-file SQL transaction merely to improve the progress bar.

### B11 — P2: repeated video probes and incomplete child-process ownership

Sources: `PhotoWorker.ts:74` (`VideoRendererFactory.build`),
`src/backend/model/FFmpegFactory.ts` (`takeScreenshots:167`,
`executeFfmpeg:316`, `probe`, `getAvailableCodecs:148`),
`src/backend/model/fileaccess/VideoConverterWorker.ts` (`convert`, `_convert`),
`fileaccess/fileprocessing/VideoProcessing.ts` (`convertVideo`).
Resources: subprocess slots, CPU, filesystem I/O.

Every video thumbnail first ffprobes dimensions, then `takeScreenshots` probes
again to resolve the `10%` timestamp. Each size repeats both probes and frame
extraction. Video conversion has a separate one-slot executor and loads metadata
before queue deduplication, so duplicate requests can repeat probe work even
when the conversion itself coalesces. `VideoConverterWorker.convert` mutates
its queued input's output path to `.part`, making equality against later
original-path inputs unreliable while it runs.

The wrapper drains encoding stderr into a bounded 4,000-character tail and
settles on child close: preserve this. It exposes `kill`, but jobs retain no
command handle and set no timeout. Probe stdout/stderr are accumulated strings;
`getAvailableCodecs` launches a piped stdout without consuming it. If codec-list
output exceeds pipe capacity it can block; this threshold was not reproduced.
Its error/close handlers can also call a callback twice on spawn failure.

**Improvement:** reuse one probe result for dimensions and timestamp, avoid
mutating queued identity, and own child handles with cancellation/deadline and
single-settlement handling. Drain or ignore unused stdout; cap diagnostic output.
Keep shell-free argv construction, percentage seek semantics, bounded stderr,
and `.part` cleanup/rename from the FFmpeg stability work (`80285483`).

**Validation/measurement:** count probes per video/size; compare thumbnail batch
time separately from HEIC. Test hung/failed child, spawn error, verbose output,
cancel/restart and duplicate requests. Never infer HEIC costs from video results.

### B12 — P2: bounded uploads can still exhaust memory; GPX processing blocks JS

Sources: `src/backend/middlewares/UploadMWs.ts` (`upload`, multer memoryStorage),
`src/backend/model/UploadManager.ts` (`saveFiles`, `saveFile`),
`src/backend/model/fileaccess/fileprocessing/GPXProcessing.ts` (`compressGPX`).
Resources: memory and event loop.

Upload limits allow up to 10 × 50 MiB buffered files per request and five active
requests: **2,500 MiB of file payload** at the configured ceiling, excluding
parser copies and the rest of the process. This is arithmetic from limits, not
a measured RSS peak. Files are fully buffered before sequential disk writes.
Use a byte budget or bounded disk-backed streaming for low-memory deployments,
preserving authorization, 429/413 handling, exclusive `wx` creation, finally-close
and owned-partial cleanup. Measure concurrent upload RSS and abort recovery with
small synthetic payloads before testing near limits.

GPX compression reads the whole XML, parses/transforms/builds synchronously,
repeatedly splices point arrays and writes directly to the final cache path.
Large tracks can block the event loop and retain several representations. Use
linear compaction and size limits first, then evaluate a worker for CPU-heavy
parsing if measured; preserve compression semantics across segments, missing
timestamps and extension removal. Measure points/sec, maximum event-loop delay
and peak RSS on synthetic tracks, with output-equivalence checks. Atomic output
publication from B2 also applies here.

## HEIC and job pipeline, end to end

### Stages and concurrency boundaries

| Stage | Execution and completion contract |
| --- | --- |
| Schedule/manual start | `JobManager.runSchedule/run` → repository job → `Job.start`; non-instant start returns before work completes. After-job scheduling is based on final job state. |
| Enumerate | `FileJob`: COUNT plus DB pages (default indexedOnly), or disk tree scan. Indexed mode does not rerun full photo metadata extraction for each conversion. |
| Skip check | `PhotoConvertingJob.shouldProcess` checks output paths sequentially. Existing successful sizes can survive restart; no durable cursor. Video sizes above maxVideoSize are checked here even though `processFile` skips generating them. |
| Per-file/per-size dispatch | One awaited file and one awaited size at a time. `generateThumbnail` repeats hit check, validates source/destination containment, creates directory. |
| Shared executor | `TaskExecuter` calls a JS async worker in the main process; it is **not a worker-thread pool**. Cap is max(1, CPU count − 1), optionally lowered by config. Pending distinct work has no queue length bound; equality dedup uses linear scans. |
| Source/header | HEIC/JPEG: `sharp(filename, options)`, `rotate()`, `metadata()`. RAW: exifr parse → explicit preview range read/fallback thumbnail → Sharp Buffer (or original file fallback). |
| Native pixel work | Resize, color/orientation handling and WebP encode in Sharp/libvips native work. libuv worker availability, libvips per-image threads and codec threads are separate constraints. |
| Publish | `toFile(finalPath)` awaited; no photo `.part` protocol. No photo-conversion SQL transaction/update records success. |
| Report | Progress mutation/log and throttled `jobs.db` snapshot. Yield via setImmediate between steps. At exhaustion state becomes finished; after-jobs may start. |

Historical comments saying “run on other thread” are stale descriptions of the
application executor: commit `2b0d1a96` removed explicit threading in 2023. Sharp
still does native asynchronous work. Its cache/thread settings are process-wide;
MetadataLoader also disables Sharp cache. Separate video conversion and concurrent
requests can compete with jobs. Adding file concurrency, raising libuv threads
and raising libvips threads together would confound measurement and can oversubscribe
CPU/memory. The installed implementation and [Sharp concurrency documentation](https://sharp.pixelplumbing.com/api-utility/)
distinguish per-image threads, operation cache and queued native work.

For a 4284 × 5712 RGB8 image, a single full raw frame is about **70 MiB** before
intermediates; RGBA8 is about 93 MiB. These are dimensional estimates, not observed
RSS. Decode-once approaches trade CPU for live memory and must handle wider
channels/depths, ICC profiles, orientation and page selection explicitly.

### Measurements actually performed

Safe sources only: repository fixtures; no real-library scans or conversions.
Three read-only metadata calls and attempted 100-pixel WebP buffer renders were
run sequentially, without installing tools or changing Sharp's installation.

| Fixture | Bytes | Header dimensions | Characteristics reported by Sharp |
| --- | ---: | --- | --- |
| `test/backend/assets/parsingfromheic.heic` | 2,158,564 | 1600 × 3232 | HEVC, RGB8/sRGB, profile present, one page |
| `test/backend/assets/orientation/IMG_0307.HEIC` | 3,946,347 | 4284 × 5712 | HEVC, RGB8/sRGB, profile present, one page |
| `test/backend/assets/live_photo/IMG_7943.HEIC` | 15,230 | 100 × 133 | HEVC, RGB8/sRGB, profile present, one page; tiny fixture unsuitable for throughput conclusions |

Environment: Node **24.21.0**, Sharp **0.35.5**, libvips **8.18.7**, libheif
**1.23.5**, libwebp **1.6.0**, 16 reported logical CPUs, `sharp.concurrency()=1`,
`UV_THREADPOOL_SIZE` unset. The capability probe loaded Sharp directly (default
operation cache 50 MB/20 files/100 items), not PhotoWorker (which disables it).
Filesystem cache state was uncontrolled; no system caches were dropped.

All three pixel renders failed with “Support for this compression format has
not been built in: HEVC” (libde265 suggested by libheif). Header reads succeeded;
`sharp.format.heif.input.file` was true but suffix support listed `.avif`.
Therefore **elapsed conversion time, stage shares, CPU, peak conversion RSS,
one-file latency and batch throughput are unavailable**. Failure duration is
not a HEIC benchmark, and no JPEG/AVIF result is used as a substitute.

The Docker build is a different codec environment; AGENTS.md and
`docker/build-libvips.sh` describe custom libvips with HEIC/RAW support. It was
not rebuilt or launched here. Sharp's [installation documentation](https://sharp.pixelplumbing.com/install/)
lists the prebuilt format set and custom-libvips route; inspect the actual
production binary and perform a pixel decode rather than trusting header support.

### Reproducible profiling protocol and exact instrumentation points

1. Use the deployed HEVC-capable image/runtime in a disposable environment. Copy
   only the first two fixtures above into a temporary image root; put cache,
   `jobs.db`, config and a new SQLite database beneath that same temporary root.
   Disable schedules and extensions, set indexedOnly=true for the job baseline (false for traversal tests), and reject
   any path outside that root. Do not mount the real DB/library read-write.
   Verify versions, codec decode, allocator, CPU/container limits, thread settings,
   source hashes/dimensions/ICC/orientation and effective quality/kernel/options.
2. Establish renderer-only one-file baselines with `[320]`, then
   `[320,540,1080,2160]`, using the exact `ImageRendererFactory.render` settings:
   failOn none, explicit animation option, auto-rotate, metadata-dependent
   short-side resize, configured kernel, WebP quality 80/smartSubsample setting,
   effort 6. Indexing is excluded from this timing. Preserve the job's default
   one-size case as a separate result.
3. In a temporary instrumented copy/harness, time these boundaries with
   `performance.now()`: `FileJob` COUNT/page fetch; `shouldProcess`; source/output
   SafePath checks; mkdir; `TaskExecuter.execute` admission and `run` worker start;
   `ImageRendererFactory.render` entry, RAW extraction when applicable, before/
   after `image.metadata()`, before/after `processedImg.toFile`; and progress
   `saveDB` serialize/write. Correlate source, size and output-key IDs.
4. `toFile` fuses decode/resize/encode/write. Its wall time does not isolate decode.
   Compare a diagnostic oriented raw-buffer decode, resize/encode from that buffer,
   `toBuffer` and `toFile` in controlled variants; these alter the pipeline and
   their times must not be added up as an exact production breakdown. If a native
   profiler is already available, sample the fused operation to attribute codec
   CPU. Explain any proposed profiler installation separately before doing it.
5. Record `process.cpuUsage`, `process.resourceUsage().maxRSS` (Linux KiB), sampled
   `process.memoryUsage()` (RSS/external/arrayBuffers),
   `perf_hooks.monitorEventLoopDelay`, `sharp.counters()`, executor active/pending
   counts and `/proc/<pid>/io` before/after. `/proc` read_bytes and syscall-level
   bytes have different cache semantics. For video, include child resource usage;
   parent CPU alone is insufficient.
6. Run fresh processes for peak-memory comparison. Use an empty derivative cache
   first, then retained outputs for skip-only timing. Report OS cache as warm/
   uncontrolled; copying to a new path does not establish cold physical storage.
   Do not globally drop filesystem caches. Use at least three repetitions and
   report individual values/median, not a precision-heavy average of tiny runs.
7. Compare the same two-source batch with file concurrency 1 and 2, keeping sizes,
   native threads and output settings fixed. One-file latency and batch files/min
   are separate metrics. A two-file batch is only a pilot; expand later with
   explicitly selected representative 12/24/48 MP HEIC, HDR/wide-gamut and rotated
   inputs before choosing production limits. Avoid copies of one source masquerading
   as a diverse workload.
8. If decoding dominates, test per-file decode reuse under a byte budget. If
   encoding dominates, test effort values in isolation, recording output bytes
   and visual quality. If metadata/syscalls dominate, prioritize B5/B6. Validate
   output geometry, orientation, color/alpha/page behavior and cancellation before
   accepting any speed gain. Keep RAW preview and JPEG experiments separate:
   JPEG shrink-on-load can make full raw materialization a regression.

For a codec preflight, from the repository root in the candidate runtime:

```sh
source ~/.nvm/nvm.sh && nvm use >/dev/null && node - <<'NODE'
const sharp = require('sharp');
(async () => {
  console.log(process.version, sharp.versions, sharp.concurrency());
  const p = 'test/backend/assets/orientation/IMG_0307.HEIC';
  const m = await sharp(p).metadata();
  console.log({width:m.width, height:m.height, compression:m.compression});
  await sharp(p, {failOn:'none'}).rotate().resize(100).webp().toBuffer();
  console.log('HEVC pixel decode succeeded; profiling may proceed');
})().catch(e => { console.error(e.message); process.exitCode = 1; });
NODE
```

This command is a capability check, not the production resize benchmark.

## Database engines, streams and safeguards to preserve

- **SQLite:** installed better-sqlite3 12.11.1 / SQLite 3.53.2 executes statements
  synchronously (`BetterSqlite3QueryRunner` uses `stmt.all/run`). The TypeORM
  driver enables WAL unless disabled. Async manager methods do not make SQL
  nonblocking or create multiple SQLite writers. Keep the serialized save lane;
  measure statement/event-loop duration before changing transaction boundaries.
- **MariaDB/MySQL:** `SQLConnection.getDriver` selects mysql2 and does not override
  pool size. Installed mysql2 defaults are 10 connections, waitForConnections true,
  queueLimit 0 (mysql2 **3.24.5**, TypeORM **0.3.31**). These settings agree with the
  [mysql2 pool documentation](https://sidorares.github.io/node-mysql2/docs#using-connection-pools). Repeated awaited queries add round trips; increasing parallel
  jobs can shift waiting into the pool. Pool contention/locks were not measured.
  No reviewed conversion job holds an explicit DB transaction across image work.
  TypeORM save batches may use their own transactions; capture query logs when
  measuring write/lock durations rather than assuming one transaction per file.
- **Indexes examined:** media PK/directory/name+directory/creationDate/rating,
  directory PK/name/path/parent/unique name+path, person junction media/person,
  projected directory cache composite indexes and projected person uniqueness.
  Search, gallery and cover query call sites were sampled; arbitrary search
  combinations and production projection selectivity were not exhaustively
  explained. Do not label every sort as a missing-index defect.
- **ZIP:** `GalleryMWs.zipDirectory` uses `archive.pipe(res)` with normal stream
  backpressure, store-only ZIP, error handling and disconnect abort. Archiver
  queues file paths rather than reading every photo into one application Buffer.
  Preserve containment/authorization and `headersSent` handling from hardening.
  Search results/name maps and queued paths are still retained; slow-client,
  warning and disconnect behavior merits a targeted stream test, but this audit
  did not reproduce a ZIP descriptor leak or premature stream closure.
- **Uploads:** `wx` ownership plus finally-close and failure unlink are good
  safeguards. Do not replace with exists-then-write or unbounded uploads.
- **DB lifecycle:** preserve shared connection-opening promise, migration-before-
  publication, non-destructive migrations/WAL-aware backup and root test teardown.
  `SQLConnection.tryConnection` and temporary DB creation close on success, but
  need `finally` cleanup if their post-connect query fails; validate with injected
  query errors. API renaming alone does not fix these failure paths.
- **Memory/caches:** keep bounded progress logs, batched index writes, exact-input
  in-flight renderer deduplication and the current global Sharp cache restriction
  until a measured replacement demonstrates bounded memory. No reason was found
  to remove SafePath realpath checks, async password hashing or migration backups
  for performance.

## Implementation order

1. Small correctness changes: B3 handle cleanup/range validation; B4 parallel-flag
   truth table; B5 child-scan suppression; align video skip checks with generated
   sizes. Add focused failure tests, not a broad dependency update.
2. Make outputs trustworthy (B2 atomic publication and transform/source identity)
   and define failed-file/progress semantics. Add orderly drain/flush behavior.
3. On an HEVC-capable runtime, measure the current one-size and multi-size HEIC
   baseline, then try bounded **file** concurrency. This is the most promising
   first runtime reduction experiment because the producer is demonstrably serial.
4. Address larger-library overhead: B6 async/batched filesystem decoration,
   B7 keyset paging, B8 bounded/coalesced indexing and B9 narrower/batched queries.
5. Architectural work only after evidence: shared decode/multi-output rendering,
   byte-based global resource admission, disk-backed upload streaming and workers
   for measured JS-heavy tasks. Tune codec effort only with quality validation.

## Evidence, scope and remaining uncertainty

Read AGENTS.md, the prior Backend-Audit and Frontend-Audit, and upgrade/security/
technical-debt records. Traced Photo Converting, FileJob, generic job scheduler/
progress, indexing traversal/save queue, RAW/Sharp rendering, video conversion/
FFmpeg wrapper, SafePath, metadata/sidecars, thumbnail response decoration,
GPX conversion, uploads, ZIP streaming, SQL connection handling and relevant
entity/index definitions. Sampled gallery/search/cover/person/timeline call sites;
this is not a line-by-line audit of every extension, router or manager.

New verification used TypeScript source transpiled in memory with explicit
mocks to prevent config/library access: RAW read-failure close count; real
filesystem zero-byte/freshness cache checks beneath `/tmp`; the four scheduler
flag combinations; and a stub-counted child-cover metadata scan. SQLite EXPLAIN
used current entity decorators with SQLite charset settings and captured ORM
queries in an isolated **in-memory** schema; no application migrations or real
DB initialization were invoked. The schema was empty, so no populated-data timing
or selectivity conclusion follows. Temporary harnesses/results are in
`/tmp/pg-backend-audit/{probes.cjs,probes.log,sql.cjs,sql.log}` for this session.
No installed test setup or ignored test config was changed. Full suites, MariaDB,
production profiling, live shutdown/disconnect injection and image-quality
comparisons were not run; they would not solve the missing local HEVC decoder.

The previous document was an API/deprecation audit, not a performance audit. Its
specific TypeORM factory/close findings were rechecked against current source and
installed TypeORM declarations/implementation (`close()` delegates to `destroy()`).
Its claimed exhaustive AST coverage and absence of all other deprecated calls
were **not rerun or newly established**. Retain that historical report below for
traceability; it does not establish a performance benefit from API renaming.
“100% drop-in” below describes the library alias only, not verification of an
entire DataSource refactor. The modern lifecycle is documented in the official
[TypeORM DataSource guide](https://typeorm.io/docs/data-source/data-source/).

---

## Preserved previous API audit (historical text)

# Backend API and Deprecation Audit

Date: 2026-10-09. Status: findings and recommendations; no application changes.

## Scope and Summary

Static AST analysis of the backend and integration test TypeScript suites (`tsconfig.json` and `test/tsconfig.json`) was conducted across all backend services, managers, middlewares, routers, and database abstraction layers.

All identified deprecated function calls in the backend originate from **TypeORM 0.3+ database connection management APIs** concentrated within a single file: [`src/backend/model/database/SQLConnection.ts`](../../src/backend/model/database/SQLConnection.ts). No other deprecated Node.js runtime, Express 5, or third-party library functions are currently invoked in the backend source code.

---

## Deprecated API Usages

A total of **10 deprecated function/method calls** were identified across `SQLConnection.ts`:

### 1. `createConnection` (Global Factory Function)
* **Locations:**
  * `src/backend/model/database/SQLConnection.ts:245`: `await createConnection(options)`
  * `src/backend/model/database/SQLConnection.ts:248`: `await createConnection(options)`
  * `src/backend/model/database/SQLConnection.ts:256`: `await createConnection(options)`
  * `src/backend/model/database/SQLConnection.ts:261`: `await createConnection(options)`
* **Deprecation status:**
  * Deprecated in TypeORM 0.3.0 (`@deprecated`).
  * In TypeORM 0.3+, connection creation via the global `createConnection()` factory is superseded by the `DataSource` API.
* **Modern replacement:**
  * Instantiate a `DataSource` directly and call `.initialize()`:
    ```typescript
    import { DataSource } from 'typeorm';

    const dataSource = new DataSource(options);
    await dataSource.initialize();
    ```

---

### 2. `getConnection` (Global Connection Registry)
* **Location:**
  * `src/backend/model/database/SQLConnection.ts:115`: `getConnection('test').close()`
* **Deprecation status:**
  * Deprecated in TypeORM 0.3.0 (`@deprecated`).
  * The global connection manager registry pattern (`getConnection(...)`, `getConnectionManager()`) is deprecated in favor of passing or injecting the `DataSource` instance directly.
* **Modern replacement:**
  * Maintain explicit references to active `DataSource` instances rather than relying on TypeORM's ambient global connection registry.

---

### 3. `Connection.prototype.close` (Connection Teardown)
* **Locations:**
  * `src/backend/model/database/SQLConnection.ts:106`: `await connection.close()`
  * `src/backend/model/database/SQLConnection.ts:115`: `await getConnection('test').close()`
  * `src/backend/model/database/SQLConnection.ts:123`: `await conn.close()`
  * `src/backend/model/database/SQLConnection.ts:204`: `await this.connection.close()`
  * `src/backend/model/database/SQLConnection.ts:260`: `await tmpConn.close()`
* **Deprecation status:**
  * Deprecated in TypeORM 0.3.0 (`@deprecated use .destroy method instead`).
  * `Connection.prototype.close()` is retained solely as an alias for `destroy()` in TypeORM 0.3.
* **Modern replacement:**
  * Replace all `.close()` calls with `.destroy()`:
    ```typescript
    await connection.destroy();
    ```

---

## Findings Summary Table

| File | Line | Method / Call | Upstream Library | Deprecation Reason & Target Replacement |
|---|---|---|---|---|
| `SQLConnection.ts` | 106 | `connection.close()` | TypeORM | Use `.destroy()` instead. |
| `SQLConnection.ts` | 115 | `getConnection('test')` | TypeORM | Deprecated global registry; track `DataSource` reference directly. |
| `SQLConnection.ts` | 115 | `.close()` | TypeORM | Use `.destroy()` instead. |
| `SQLConnection.ts` | 123 | `conn.close()` | TypeORM | Use `.destroy()` instead. |
| `SQLConnection.ts` | 204 | `this.connection.close()` | TypeORM | Use `.destroy()` instead. |
| `SQLConnection.ts` | 245 | `createConnection(...)` | TypeORM | Use `new DataSource(...).initialize()`. |
| `SQLConnection.ts` | 248 | `createConnection(...)` | TypeORM | Use `new DataSource(...).initialize()`. |
| `SQLConnection.ts` | 256 | `createConnection(...)` | TypeORM | Use `new DataSource(...).initialize()`. |
| `SQLConnection.ts` | 260 | `tmpConn.close()` | TypeORM | Use `.destroy()` instead. |
| `SQLConnection.ts` | 261 | `createConnection(...)` | TypeORM | Use `new DataSource(...).initialize()`. |

---

## Architectural Recommendations

1. **Step 1 (Immediate / Low Risk):**
   * Replace all occurrences of `.close()` with `.destroy()` on TypeORM connection handles. This is a 100% drop-in semantic replacement supported in TypeORM 0.3+.

2. **Step 2 (Medium Term / DataSource Migration):**
   * Refactor `SQLConnection.ts` from returning/storing `Connection` to `DataSource`.
   * Update helper connection tests (such as SQLite memory test resets and schema synchronization in `test/backend/TestHelper.ts`) to manage `DataSource` lifecycles directly without `getConnection()`.
