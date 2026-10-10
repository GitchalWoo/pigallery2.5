# PiGallery2 docker installation

You can use [docker](https://docs.docker.com/install/) to run PiGallery2. 

For docker installation and usage, please see the [documentation](https://bpatrik.github.io/pigallery2/setup/docker/).

## Experimental ARMv7 build

Published fork images remain amd64/arm64-only. An isolated ARM32 experiment
using Debian's Node 24 packages passed application and media smoke checks,
including a Canon CR2 thumbnail. See the [test report and reproduction steps](../docs/fork-features/ARMv7-Docker-Experiment.md).

The [experimental Dockerfile](armv7/Dockerfile.experimental) expects `release/`
as its build context, not the repository root. It is not a production image.

