# PiGallery2.5
![GitHub package.json version](https://img.shields.io/github/package-json/v/GitchalWoo/pigallery2.5)
[![Coverage Status](https://coveralls.io/repos/github/GitchalWoo/pigallery2.5/badge.svg?branch=master)](https://coveralls.io/github/GitchalWoo/pigallery2.5?branch=master)
[![Docker build](https://github.com/GitchalWoo/pigallery2.5/workflows/docker-buildx/badge.svg)](https://github.com/GitchalWoo/pigallery2.5/actions)

PiGallery2.5 is a modernized fork of PiGallery2 which is a **fast** directory-first photo gallery website, optimized for running on low-resource servers (especially on Raspberry Pi).

## About This Fork
This repository is a fork of [PiGallery2](https://github.com/bpatrik/pigallery2). Its goal is to modernize the project while preserving the original's minimalist philosophy: a fast, directory-first gallery that stays simple to run and use. It keeps the upstream project's core functionality and documentation, with additional changes maintained here. For the original project and its releases, visit the [upstream repository](https://github.com/bpatrik/pigallery2). Changes specific to this fork are tracked in this repository's commit history.

For this fork's build, release, translation, and test commands, use the local
[contribution guide](docs/development/contributing.md). The
[tech debt tracker](docs/fork-features/Techdebt.md) records completed cleanup and
remaining work; the [security plan](docs/fork-features/Security-Updates.md) tracks
open security findings.

> [!WARNING]
> **Security upgrades and existing OpenID Connect (OIDC) providers:** Back up your
> database and configuration before upgrading this fork. Security updates can
> change the database schema and how existing users are linked to your identity
> provider. Existing OIDC users may need manual identity relinking or their
> PiGallery2 user accounts recreated; Admin and Developer accounts are no longer
> automatically linked by username. Verify that you have a working local
> administrator login before deploying an upgrade.
>
> Some incompatible upgrades may require database recreation and user
> reprovisioning. Treat that as a last resort: it loses database-held users,
> shares, permissions, and indexed metadata unless they are restored from a
> backup. The current **43 → 44 migration preserves existing data** and adds the
> missing OIDC columns automatically; do not reset the database to resolve that
> missing-column error. Review the
> [database upgrade and recovery notes](docs/fork-features/Security-Updates.md#34-database-upgrades--recovery-aud4)
> before deploying security updates.

## 🚀 Key Features
- **⚡ Fast**: Optimized for low-end hardware.
- **✔️ Simple**: Point to your photos and you are ready.
- **📁 Directory-first**: Shows your folder structure as it is.
- **Read-only**: Your photo folder is never modified.

[Full documentation here](http://bpatrik.github.io/pigallery2/).

[Try our live demo!](https://pigallery2.onrender.com/) (First load may take up to 60s while the server boots up)

## 🏁 Getting Started
The official and recommended way to run PiGallery2 is using **Docker**.

### [Install with Docker (Recommended)](https://bpatrik.github.io/pigallery2/setup/docker)

This fork publishes amd64/arm64 images. An unpublished ARMv7 experiment has
passed ARM32 smoke tests, including RAW/CR2 thumbnails; see the
[ARMv7 test report](docs/fork-features/ARMv7-Docker-Experiment.md) for reproduction
steps and limitations.

### [Native Installation (Unsupported)](https://bpatrik.github.io/pigallery2/setup/direct-install)
Native installation is possible for users familiar with Node.js but is not officially supported.

## 📖 Documentation
For more detailed information, please see our [Documentation Website](http://bpatrik.github.io/pigallery2) or the `docs/` folder:
- [FAQ (Frequently Asked Questions)](https://bpatrik.github.io/pigallery2/faq)
- [Configuration Guide](https://bpatrik.github.io/pigallery2/user-guide/configuration)
- [User Rights](https://bpatrik.github.io/pigallery2/user-guide/user-rights)
- [Contribution Guide](https://bpatrik.github.io/pigallery2/development/contributing)

## 🤝 Contributing
Contributions are welcome! Please read our [Contribution Guide](https://bpatrik.github.io/pigallery2/development/contributing) to get started.

## ⭐ Star History
[![Star History Chart](https://api.star-history.com/svg?repos=bpatrik/pigallery2&type=date&legend=top-left)](https://www.star-history.com/#bpatrik/pigallery2&type=date&legend=top-left)

## 📜 License
PiGallery2 is licensed under the MIT License.
