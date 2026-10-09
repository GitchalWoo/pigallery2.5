# Prism — 2026 visual experiment

Branch: `design/prism-2026`.

A photo studio treatment built on the existing Bootstrap controls: a floating navigation shell, rounded folder/album/face covers, quieter photo tiles, and an orbital login illustration made entirely with CSS. No external fonts, image downloads, or new dependencies.

## Try it

```bash
source ~/.nvm/nvm.sh
nvm use
npm run build-en
npm start -- --Server-port=8081 --Gallery-Themes-selectedTheme=prism
```

Open http://localhost:8081. Use 8082 if another server owns 8081. For a persistent choice, select **prism** in the Gallery theme settings and save. The main menu still cycles Light → Dark → Auto.

Prism is an opt-in design: its layout and controls apply only when **prism** is selected and themes are enabled. Default, Classic, and existing custom themes retain the original component styles and original login layout. Collection mastheads have been removed. Light/Dark/Auto remains independent of the selected design. Existing saved theme lists offer Prism without changing their entries; selecting Prism adds its editable CSS only when missing. Existing custom CSS named `prism`, even an empty definition, takes precedence over the built-in palette.

Palette source: [PrismTheme.ts](../../src/common/config/public/PrismTheme.ts). The scoped skin and surface/accent tokens live in [prism.css](../../src/frontend/prism.css), derived from Bootstrap variables. The server marks Prism pages with `data-gallery-design="prism"` before rendering, so the selected design also applies to login without a layout flash. Custom palettes can override `--pg-accent`, `--pg-accent-rgb`, `--pg-surface`, `--pg-soft`, `--pg-stroke`, and `--pg-shadow`.

## Local container

Build the current working tree (including uncommitted design edits):

```bash
podman build -t pigallery2-prism -f docker/debian-trixie/selfcontained/Dockerfile .
podman run -d --name pigallery2-prism \
  -p 127.0.0.1:8083:80 \
  -v "$PWD/demo/images:/app/data/images:ro" \
  -v prism-config:/app/data/config \
  -v prism-db:/app/data/db \
  -v prism-cache:/app/data/tmp \
  pigallery2-prism
```

Open http://localhost:8083 and select Prism in settings. `docker` can replace `podman`. Subsequent starts use `podman start pigallery2-prism`; inspect startup credentials with `podman logs pigallery2-prism`.

## Compatibility and checks

- Bootstrap remains responsible for button states, contextual alerts, forms, modal and dropdown behavior.
- Light/dark/automatic mode and configurable navigation remain in place.
- Gallery rows retain their calculated layout; oversized sparse rows are constrained to narrow viewports. Long Markdown previews no longer extend the document width.
- Prism supports focus outlines, touch-visible photo actions, reduced-motion preferences, and translated UI text.
- Validation passed: production English build (1.54 MB initial bundle), 226 frontend tests, frontend spec type-check, 8 focused PublicRouter tests, and isolated Cypress desktop/mobile smoke checks. Browser checks covered Prism light/dark, Classic, default light/dark, login, gallery, mobile menu bounds, collection routes, settings dropdowns, and viewer open/close, plus the original Classic login/gallery on a separate server.
- The integrated browser was unavailable; visual inspection used Cypress screenshots from Brave. The container image itself was not built during this experiment.

New English messages use Angular i18n; translations can be added through the existing translation workflow.
