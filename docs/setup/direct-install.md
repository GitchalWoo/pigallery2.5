# Direct Installation (Unsupported)

!!! danger "Unsupported Installation Method"
    Running PiGallery2 natively (non-Docker) is possible but **not officially supported**. The maintainer will not answer questions or fix bugs specifically related to native installations. For the best experience and support, use the [Docker Installation](docker.md).

## Prerequisites
- **Node.js**: Node.js **>=24.15.0 <25** and npm **11.19.0** (see `package.json`).
- **Build Tools**: Required for building some native modules.
  ```bash
  sudo apt-get install build-essential libkrb5-dev gcc g++
  ```

## Installation

### 1. Install Node.js
```bash
curl -sL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install --global npm@11.19.0
```

### 2. Install PiGallery2

#### From Release
Use a built archive for this fork, such as `pigallery2.zip` produced by
`npm run create-release`, rather than an upstream source archive.

```bash
unzip pigallery2.zip -d pigallery2
cd pigallery2
npm install
```

#### From Source
**Note**: Requires ~2GB of memory for building.
```bash
wget https://github.com/GitchalWoo/pigallery2.5/archive/refs/heads/master.zip
unzip master.zip
cd pigallery2.5-master
npm ci
npm run build
```

When building this fork, `npm run build` builds all 16 locales; use
`npm run build-en` instead if you only need English. Both commands compile the
backend and produce the frontend under `dist/`. To produce a distributable
release directory and `pigallery2.zip`, use `npm run create-release`.
See the [contribution guide](../development/contributing.md#build-and-release-tooling)
for the fork's release options.

## Running the App
```bash
npm start
```
Default credentials: `admin` / `admin`.

## Configuration
- Run the app once to generate `config.json`.
- Edit `config.json` manually or use the Settings UI.
- Use command-line switches for quick overrides:
  ```bash
  npm start -- --Server-port=8080
  ```
