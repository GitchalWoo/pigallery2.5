# PiGallery2 Docker Contribution Guide

Remember to update all the Dockerfiles.

## Linting
To quality check your Dockerfile changes, you can use hadolint:

1. Start the Docker daemon if it's not already started: `sudo dockerd`
2. Change directory to the `docker/` folder.
3. Run hadolint on the Dockerfiles:
```bash
docker run --rm -i -v ./.config/hadolint.yml:/.config/hadolint.yaml hadolint/hadolint < ./alpine/Dockerfile.build
docker run --rm -i -v ./.config/hadolint.yml:/.config/hadolint.yaml hadolint/hadolint < ./debian-trixie/Dockerfile.build
docker run --rm -i -v ./.config/hadolint.yml:/.config/hadolint.yaml hadolint/hadolint < ./debian-trixie/selfcontained/Dockerfile
```

Fix errors and warnings or add them to the ignore list of the [hadolint configuration file](https://github.com/bpatrik/pigallery2/blob/master/docker/.config/hadolint.yml) if there is a good reason for that. Read more [here](https://github.com/hadolint/hadolint).

### Building the docker image locally (Docs are as-it-is, no further support provided for this)

From this fork's repository root, use Node 24 and npm 11.19.0 to build the release
before building the image. The Node release script produces `release/` and
`pigallery2.zip`. The image's system FFmpeg replaces the bundled binaries; the
remaining optional dependencies, including `mysql2`, are required in its manifest.

```bash
npm ci
npm run create-release -- --skip-opt-packages=ffmpeg-static,ffprobe-static --force-opt-packages
mv release pigallery2-release
docker build --progress=plain -t local-pg -f docker/debian-trixie/Dockerfile.build .
```

The Dockerfile expects `pigallery2-release/` in the build context. Move the
generated directory to that name when it does not already exist; for subsequent
builds, replace only the previous generated release output.
The self-contained Dockerfile builds its release inside the image instead.
See [build and release tooling](contributing.md#build-and-release-tooling) for
locale filtering and the other release commands.
