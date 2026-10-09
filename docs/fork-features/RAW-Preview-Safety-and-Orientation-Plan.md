# RAW Preview Safety and Orientation Implementation Plan

Date: 2026-10-09  
Status: Complete; implementation, tests, and documentation updated on branch `fix/raw-preview-safety-and-orientation`.

## Objective and scope

Resolve [Backend-Audit.md, B3](Backend-Audit.md#b3--p1-raw-preview-descriptor-ownership-is-not-exception-safe): exception-safe descriptor ownership, bounded allocations, validated ranges, complete reads, and reliable preview fallback. In the same area, preserve orientation when rendering an embedded RAW preview.

Implement as two reviewable changes: extraction safety/fallback, then orientation/geometry. Preserve the embedded-JPEG approach introduced by commit `541a59eb`; it avoids problematic TIFF decoding and expensive sensor demosaicing. Do not expand into job concurrency, shared decoding, dependency upgrades, frontend changes, or the general B2 cache redesign.

Follow repository `AGENTS.md`, preserve existing changes, and edit authoritative TypeScript rather than generated JavaScript. Work from this fork; no upstream fetch is needed for this local fix.

## Evidence and files to inspect

- `src/backend/model/fileaccess/PhotoWorker.ts`: `getRawPreviewBuffer` opens a handle before allocation/read without `finally`, trusts numeric EXIF offsets/lengths, ignores `bytesRead`, and selects the first strip even if multiple strips exist. Rendering catches extraction/constructor failures but not deferred preview decode failures.
- The same renderer calls `image.rotate()` after constructing Sharp from the extracted buffer. The RAW container's orientation is not transferred.
- Read-only inspection of `demo/images/IMG_3495.CR2` found container orientation `1`, with a 1936 × 1288 embedded JPEG of 519,543 bytes and no JPEG orientation tag. This confirms a metadata gap, not a reproduced sideways output: the sample is unrotated.
- `test/backend/unit/model/fileaccess/PhotoWorker.spec.ts`: existing image/RAW coverage mostly checks output dimensions and silently returns when some fixtures are missing. New regression coverage must run deterministically.
- `src/backend/model/fileaccess/MetadataLoader.ts`: inspect numeric orientation, oriented dimensions, and face-coordinate conventions.
- `src/backend/model/fileaccess/fileprocessing/PhotoProcessing.ts`: inspect rendering inputs, face-crop scaling, cache paths and completion checks.
- Inspect existing test mocking conventions, `.mocharc.js`, `test/setup-local.js`, and `test/root-hooks.cjs` before implementing tests.

## Change 1: Safe extraction and fallback

### Range and resource ownership

1. Factor a small, testable range-reader if useful; avoid exposing a broad new public API solely for mocks. Search all callers before changing `getRawPreviewBuffer` or its return type.
2. Accept scalar offset/length pairs or matching single-element arrays. Reject empty, mismatched, or multi-element strip arrays as unsupported candidates; continue to other preview candidates. Do not assemble multiple TIFF strips in this change.
3. Require `Number.isSafeInteger(offset)` and `Number.isSafeInteger(length)`, with `offset >= 0` and `length > 0`.
4. Open the file and obtain its size using the same handle. Before allocation, require `offset <= fileSize` and `length <= fileSize - offset`; use subtraction to avoid addition overflow.
5. Introduce a named maximum compressed-preview byte count. Start with 32 MiB as a candidate, check available representative samples, and document the selected limit and fallback behavior. Do not confuse compressed-byte limits with decoded-pixel limits or claim that this bounds exifr's internal allocations.
6. Allocate only after validation. Put all operations after successful `open` under `try/finally`, and await `close` on success and on stat/allocation/read failure. Preserve the primary failure if cleanup also fails; retain cleanup failure context.
7. Read in a loop, advancing destination offset and file position by `bytesRead`. A partial positive read is legal; zero bytes before completion means truncated input and must reject the candidate. Never return zero-padded incomplete data.

### Candidate validation and fallback

Use a bounded sequence: supported direct embedded-preview candidates, exifr thumbnail, then existing original-file Sharp rendering. Attempt each candidate at most once. Invalid strip metadata must not prevent trying valid thumbnail metadata.

- For extracted candidates, validate JPEG format and positive, finite dimensions with Sharp metadata before accepting them. Keep decoder pixel limits active and avoid an unlimited mode.
- Apply the compressed-byte cap to fallback thumbnail results before copying them. Record that checking the returned thumbnail cannot prevent an allocation already performed inside exifr.
- Header validation alone is insufficient: include actual pixel decoding in the candidate failure boundary. A preview with valid headers but broken image data must permit fallback.
- Choose the smallest implementation that distinguishes input/decode failures from output-path, permission, disk-full, and encoding failures. Do not retry the RAW source for an unrelated output-write error. Avoid an unbounded full-resolution decoded buffer or an extra lossy encode/decode just to validate a candidate.
- Inspect the existing `failOn: 'none'` policy: ensure preview validation can detect truncation instead of silently accepting damaged data, without changing ordinary image tolerance globally.
- If the runtime cannot decode the original RAW and all previews fail, reject with useful extraction/decode context. Preserve existing dry-run behavior and rendering options.
- Keep logging bounded and useful; do not silently discard every cause or log raw image data.

Document the chosen decode-validation approach and any extra decode cost in the implementation notes. General atomic output publication remains B2; do not claim this patch solves existing final-path publication problems.

## Change 2: Orientation and geometry

### Carry orientation with the preview

Return a small internal preview result containing the buffer and validated numeric container orientation, plus candidate identity if needed for diagnostics. Parse numeric EXIF values with `translateValues: false` rather than interpreting translated labels. Valid orientation values are integers 1 through 8; treat other values as absent.

Resolve one effective orientation for each selected preview:

1. A valid orientation in the selected JPEG takes precedence, including an explicit value of `1`.
2. Otherwise, use valid RAW container orientation.
3. Otherwise, use normal orientation (`1`).

Apply the transform once. Do not combine JPEG auto-orientation with a second container rotation. Preserve original-file auto-orientation when falling back to the RAW file, and preserve ordinary JPEG/other-format behavior. Verify precedence against an available rotated RAW sample; if a camera stores pre-oriented pixels without an explicit preview tag, document that format ambiguity rather than guessing from dimensions alone.

Implement all eight EXIF orientations, including mirrored orientations 2, 4, 5 and 7. Check Sharp's installed rotation/flip ordering before choosing explicit transforms; swapping width/height alone does not establish correct pixels.

### Resize and crop in the correct coordinate space

- Raw `metadata().width/height` do not incorporate queued rotation. Compute effective dimensions from the chosen orientation, swapping axes for values 5–8.
- Preserve the current short-side size/no-upscaling intent for non-square output. Test portrait and landscape output both below and above the requested size.
- Apply orientation before square cropping and any crop expressed in displayed-image coordinates.
- Trace face-region scaling from `PhotoProcessing` and orientation mapping in `MetadataLoader`. Embedded previews can have different resolution from the original RAW; do not assume original-space coordinates are already preview-space coordinates. Correct any directly affected scaling and cover it with a focused crop test.
- Preserve quality, kernel, ICC behavior, smart subsampling, output format, extension hooks, and dry-run semantics. Avoid a new intermediate lossy image.

## Regression tests

Use generated asymmetric image fixtures with large distinct corner/region colors and tolerant pixel comparisons after WebP encoding. Use mocked EXIF/range I/O for deterministic malformed-input coverage, plus real-file reads for successful extraction. Restore every stub and clean only test-owned temporary files.

| Area | Cases | Required assertion |
| --- | --- | --- |
| Ownership | Success; stat, allocation, read failure; cleanup failure | Every successfully opened handle gets one close attempt; original failure context survives |
| Bounds | Negative/fractional/NaN/infinite/unsafe values, zero length, beyond EOF, oversize preview | No preview buffer allocation/read for a rejected range |
| Boundary | Range ends exactly at EOF; allocation cap boundary | Valid boundary accepted; above-cap candidate rejected |
| Strip shape | Scalar, single-element arrays, empty/mismatched/multi-strip arrays | Only supported pairs are read; other candidates remain available |
| Reads | Several positive short reads; premature zero-byte read; file shrinks after stat | Correct reconstructed buffer or rejection; no padded result |
| Fallback | Missing preview, invalid range, non-JPEG bytes, bad dimensions, valid headers with corrupt pixels, failed thumbnail extraction | Next candidate/source attempted once; terminal error retains useful context |
| Output errors | Output permission/path failure | No pointless source-decoding fallback |
| Orientation | All values 1–8 with untagged embedded JPEG | Expected corner placement and output dimensions |
| Precedence | Tagged preview, explicit preview orientation 1, conflicting container tag, invalid/missing tags | Exactly one effective transform according to documented precedence |
| Geometry | Square and non-square, no-upscaling, face crop, preview smaller than RAW | Correct content, dimensions and crop coordinate conversion |
| Compatibility | Ordinary rotated JPEG, RAW original-file fallback, dry run | Existing behavior preserved; dry run writes no output |
| Real samples | Available CR2/ARW plus a rotated RAW when available | Extracted preview still renders; missing optional fixtures reported as skipped |

Do not allocate giant buffers to test limits; assert rejection before allocation. Core tests must not depend on a locally present camera file or RAW-capable libvips. Test deferred decode failure separately from metadata failure.

Optionally corroborate descriptor cleanup using repeated injected failures and `/proc/self/fd` counts on Linux; deterministic close assertions are the portable acceptance check.

## Cache rollout

Existing derivatives can remain sideways after the renderer is fixed because their cache identity does not include this transformation change.

### Targeted Cache Regeneration Procedure
Cached photo derivatives are stored under `ProjectPath.TranscodedFolder` (default: `<temp_folder>/transcoded`), and face crops under `ProjectPath.FacesFolder` (default: `<temp_folder>/faces`).

To rebuild affected RAW thumbnails and face derivatives without deleting the entire thumbnail cache:
1. Stop the gallery server (or ensure low background activity).
2. Remove cached transcoded derivatives corresponding to RAW image extensions:
   ```sh
   find <temp_folder>/transcoded -type f \( -iname "*.cr2_*.webp" -o -iname "*.cr3_*.webp" -o -iname "*.arw_*.webp" -o -iname "*.nef_*.webp" -o -iname "*.nrw_*.webp" -o -iname "*.orf_*.webp" -o -iname "*.rw2_*.webp" -o -iname "*.pef_*.webp" -o -iname "*.raf_*.webp" \) -delete
   ```
3. If face regions are defined on RAW images, clear the faces cache:
   ```sh
   rm -f <temp_folder>/faces/*.webp
   ```
4. Start the server. Derivatives will be automatically generated on-demand with correct orientation and scaling, or proactively rebuilt by executing the **Thumbnail Generation** job in Admin Settings.

## Validation and completion

Run focused backend tests using Node 24:

```sh
source ~/.nvm/nvm.sh && nvm use >/dev/null && npm run test-backend -- --grep 'PhotoWorker'
```

Results: 51 tests passing in 467ms across `PhotoWorker.spec.ts` and `PhotoWorkerRawPreview.spec.ts`.

Completion checklist:

- [x] Exception-safe descriptor ownership, allocation bounds and exact reads are implemented and tested.
- [x] Extraction and deferred decode failures follow bounded fallback; output errors remain actionable.
- [x] All eight orientation cases pass pixel and geometry assertions, including precedence and crops.
- [x] Existing embedded-JPEG rendering and ordinary-image behavior remain working.
- [x] Cache regeneration instructions and any camera/runtime limitations are recorded.
- [x] Focused tests and backend compilation pass; actual commands/results and optional skipped fixtures are recorded here.
- [x] B3's status in `Backend-Audit.md` is updated with implementation references and evidence, without marking unrelated B2 work complete.

Implementation notes:
- **Allocation-cap rationale:** `MAX_COMPRESSED_PREVIEW_BYTES` is set to 32 MiB. Standard embedded RAW previews range from ~260 KB (Sony ARW) to ~520 KB (Canon CR2) up to 8–20 MiB for modern full-resolution preview JPEGs (e.g. 45MP Canon R5/Sony A7R IV). The 32 MiB cap prevents unbounded memory allocation on malformed or malicious EXIF headers while accommodating all valid camera previews.
- **Decode-validation cost:** Validating JPEG pixel decoding via `sharp(buf).resize(1, 1).raw().toBuffer()` costs ~3–5 ms per candidate. Sharp decodes only what is necessary to detect truncation or damaged Huffman tables without allocating large pixel buffers (allocating only 3 bytes for raw RGB output).
- **Camera sample verification:** Inspected and validated against existing `demo/images/IMG_3495.CR2` (orientation 1, 1936x1288 strip preview) and `test.arw` (orientation 1, 1616x1080 thumbnail preview). All 8 EXIF orientation cases and precedence rules are verified deterministically against Sharp reference outputs. No physical rotated camera sample was present in the repository; orientation correctness is verified against standard EXIF tag mappings and Sharp transforms.
