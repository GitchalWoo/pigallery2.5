# ARMv7 Docker experiment

## Status

On 2026-10-10, PiGallery ran successfully in a 32-bit ARMv7 container under
QEMU on an x86_64 Fedora 44 host using rootless Podman. No application source
changes were needed for the tested behavior. This is a feasibility experiment,
not restored production support: published images and CI still target amd64
and arm64 only.

The experimental recipe is [Dockerfile.experimental](../../docker/armv7/Dockerfile.experimental).
It replaces the unavailable official Node 24 ARMv7 base with Debian sid ARM
hard-float packages. The tested runtime was Node 24.21.0 (`process.arch: arm`,
ABI 137), npm 11.19.0, Sharp 0.35.5, and libvips 8.18.7. Native addons use
Debian's matching `libnode-dev` headers through `npm_config_nodedir=/usr`.
Sharp is explicitly built against system libvips. System FFmpeg/FFprobe replace
bundled executables, and optional npm dependencies are omitted in this recipe.

## Reproduce

On an x86 Fedora host, install and register ARM user-mode emulation:

```sh
sudo dnf install qemu-user-static-arm
sudo systemctl restart systemd-binfmt
podman run --rm --platform linux/arm/v7 docker.io/library/debian:trixie-slim uname -m
```

The smoke command should print `armv7l`. From the repository root, prepare a
fresh release using the project's Node/npm versions, then build the image:

```sh
source ~/.nvm/nvm.sh
nvm use
npm ci
npm run create-release -- --languages=en --skip-opt-packages=ffmpeg-static,ffprobe-static
podman build --platform linux/arm/v7 \
  -f "$PWD/docker/armv7/Dockerfile.experimental" \
  -t localhost/pigallery-armv7-experiment release
```

Use `release` as the build context, not the repository root: the root
`.dockerignore` excludes `release/`. The Dockerfile runs PiGallery's built-in
diagnostics during the build. The original experiment used an existing local
release artifact, not a fresh build of the source at the experiment date.

Start an isolated server using release-bundled diagnostic fixtures:

```sh
podman run -d --name pigallery-armv7-smoke --platform linux/arm/v7 \
  -p 127.0.0.1::80 localhost/pigallery-armv7-experiment \
  --Users-authenticationRequired=false \
  --Media-folder=/app/src/backend/model/diagnostics/image_formats --Server-port=80
podman port pigallery-armv7-smoke
podman logs pigallery-armv7-smoke
```

Wait for `Listening on port 80` in the log. Use the reported local port:

```sh
port=$(podman port pigallery-armv7-smoke 80/tcp | awk -F: '{print $NF}')
base="http://127.0.0.1:$port"
curl --fail "$base/heartbeat"
curl --fail "$base/"
curl --fail "$base/pgapi/gallery/content/"
curl --fail --output /tmp/armv7-heic.webp "$base/pgapi/gallery/content/test.heic/240"
curl --fail --output /tmp/armv7-arw.webp "$base/pgapi/gallery/content/test.arw/240"
podman cp demo/images/IMG_3495.CR2 \
  pigallery-armv7-smoke:/app/src/backend/model/diagnostics/image_formats/IMG_3495.CR2
curl --fail --output /tmp/armv7-cr2.webp "$base/pgapi/gallery/content/IMG_3495.CR2/240"
```

This server intentionally disables authentication and binds only to loopback.
It does not mount the demo gallery or any real config/database/cache directories.
The CR2 command copies one demo sample; it does not modify the original.
Diagnostic fixtures, rather than demo photos, explain the different gallery
contents. Thumbnail responses may be WebP even when the input is JPEG or RAW.

Remove the disposable server when finished:

```sh
podman rm -f pigallery-armv7-smoke
```

## Verified results

| Check | Result |
|---|---|
| ARMv7 execution | Debian container reported `armv7l`; Node reported `arm` |
| Native dependencies | SQLite file creation, insert/read, and bcrypt hash/compare passed |
| Application startup | Database migration and HTTP listening passed |
| HTTP basics | Heartbeat, frontend HTML, and gallery listing passed |
| Gallery indexing | Nine diagnostic fixtures indexed before adding CR2 |
| Built-in image diagnostics | JPEG, PNG, WebP, GIF, TIFF, HEIC, AVIF, ARW, DNG passed |
| Thumbnail endpoints | JPEG, HEIC, and ARW returned valid WebP images |
| CR2 thumbnail endpoint | `demo/images/IMG_3495.CR2` returned a decodable 1623 x 1080 WebP |
| Video tooling | Synthetic 64 x 64 MPEG-4 encode and FFprobe inspection passed |

CR2 was tested separately because built-in diagnostics have no CR2 fixture.
Only one CR2 sample was checked; this is not coverage of every Canon variant.

## Before production support

- Choose a maintained, pinned ARMv7 runtime supply chain; sid is rolling and this
  recipe does not pin its base digest or apt package versions.
- Split builder/runtime stages: the experimental image retains compilers,
  headers, npm packaging dependencies, and development libraries.
- Preserve HEIC/RAW codecs and make an explicit decision about optional runtime
  dependencies, including `mysql2`, which this experiment omits.
- Validate a fresh release on real ARMv7 hardware, including memory limits,
  indexing concurrency, and representative media performance.
- Run broader application tests: browser interaction, authentication/OIDC,
  MySQL, and PiGallery's full video workflow were not tested here.
- Add ARMv7 CI verification before enabling publishing. Do not simply add
  `linux/arm/v7` to the existing official-Node build matrix.

For published images, a 64-bit OS remains the supported Raspberry Pi route.
Node 24's ARMv7 platform is experimental; successful smoke tests do not provide
upstream platform support or establish long-term security maintenance.