# Public exposure security review — 2026-10-10

Reviewed commit: `08b8b28c`. Recommendation: use Cloudflare Access with an explicit user allowlist and MFA, plus Cloudflare Tunnel, while retaining application authentication. Fix the findings below before treating the application as ready for unrestricted direct Internet exposure. Access reduces who can reach vulnerable application behavior; it does not repair that behavior.

This is a focused source review and local verification, not a penetration-test certification. No production deployment, firewall, Cloudflare account, installed third-party extension code, or running production container was inspected. No application behavior or deployment configuration was changed by this audit.

## Findings

### PE1 — High, conditional: session-signing keys are not redacted from verbose startup logs

Evidence: `src/backend/server.ts:70`, `src/common/config/private/PrivateConfig.ts:1125`, `src/backend/Logger.ts:63`.

The JSON redactor only hides sensitive properties when their values are strings. `Server.sessionSecret` is an array: its value passes through, and its elements are visited under numeric property names, which do not match the sensitive-key expression. The actual redactor was tested with a synthetic signing key and emitted that key unchanged. No real key was printed or copied during the audit.

Exploit prerequisite: access to startup logs produced at verbose/debug/silly level or forced debug. Default info logging does not emit this diagnostic. A leaked signing key compromises cookie integrity; database user/role checks do not substitute for keeping signing keys secret.

Fix: redact the entire value of sensitive property names, including arrays and objects. Keep production logging at info until fixed. If real keys have reached accessible logs, remove all affected keys from the configured signing-key set and replace them, invalidating existing cookies; review log access and retention.

### PE2 — High for private media: existing share sessions retain outdated access

Evidence: `src/backend/middlewares/user/AuthenticationMWs.ts:49`, `src/backend/model/database/SessionManager.ts:16`, `src/backend/model/database/SharingManager.ts:81`.

An existing LimitedGuest session is checked for share existence and expiration. Its stored allow query is not refreshed from the current share or its creator. It is not rejected when sharing is disabled, and changing/adding a share password does not revoke it.

An already authenticated recipient can retain the previous wider media scope after the share is narrowed. Creator restriction changes also are not incorporated through this validation path. Deleting or expiring the share does invalidate it. A mocked-manager probe confirmed acceptance of the old scope even with sharing disabled and a changed password/query in the returned share.

Fix: validate sharing-enabled status and a share authorization version on every request; increment that version when credentials or access scope change. Recompute permissions from the current share and current creator restrictions, with tests for these changes. Until fixed, delete and recreate shares rather than relying on narrowing/password changes to revoke existing recipients.

### PE3 — Medium: copied sessions survive logout/password reset; some lack server expiry

Evidence: `src/backend/middlewares/user/AuthenticationMWs.ts:19`, `:359`, `:380`; `src/backend/model/database/UserManager.ts:85`.

The app uses signed client-side sessions. Logout removes context from the response cookie, but cannot invalidate a previously copied cookie. Password updates have no session-version or password-change timestamp check. Local probes confirmed both behaviors using mocked user lookup. Login with rememberMe=false also creates no server-checked expiry; browser-session lifetime does not stop replay by a client that saved the cookie. Remembered sessions use a renewable expiry, not an absolute lifetime.

Prerequisite: possession of an earlier valid session; this is not an unauthenticated login bypass. Role changes and deletion are checked and can invalidate sessions, as existing hardening intended.

Fix: give every session a server-enforced lifetime and revocation mechanism. Use server-side session IDs or database-checked session versions, incrementing versions on password resets; support explicit session revocation. Logout should revoke that session, and sensitive accounts should have an absolute lifetime as well as any idle timeout.

### PE4 — Medium, extension-dependent: extension handlers run before global CSRF validation

Evidence: `src/backend/server.ts:112`, `src/backend/model/extension/ExtensionManager.ts:52`, `src/backend/model/extension/ExpressRouterWrapper.ts:121`, `src/backend/routes/Router.ts:25`.

Object manager initialization mounts the extension router before the normal router installs the CSRF validator. The extension wrapper inserts authentication and authorization but no CSRF check. A local wrapper probe reached an authenticated POST handler without a CSRF token. A handler that finishes the response never reaches the later validator.

Impact depends on installed extension routes, accepted content types, and browser cookie behavior. SameSite=Lax restricts ordinary cross-site POSTs; this probe establishes the missing control, not a complete browser exploit. Same-site attacker contexts and state-changing GET handlers require particular care. The built-in extension install/reload/delete routes in ExtensionRouter are separate and occur after the global validator.

Fix: mount CSRF validation before extension handlers, with the required session/body middleware already present, or enforce it in the wrapper. Test through the real application middleware order, including rejected requests with no/wrong token.

Extensions also run trusted server code and can install npm dependencies. Their path containment is not a code sandbox. Disable unused extensions and audit any that remain enabled.

### PE5 — Medium, authenticated: upload memory ceiling is too large for small hosts

Evidence: `src/backend/middlewares/UploadMWs.ts:6`, `src/backend/routes/UploadRouter.ts:18`, `src/backend/model/UploadManager.ts:19`.

Multer buffers files in RAM with a 50 MiB per-file limit, a 10-file limit, and five concurrent requests. These configured caps represent approximately 2.5 GiB of file payload capacity before buffer copies and application overhead; exact achievable multipart payload depends on the parts limit. This is an estimate, not a load-test result.

Authentication and the minimum upload role are checked first (Admin by default), which limits reachability. However, Upload.enabled is checked only in saveFiles, after multipart buffering, so disabling uploads does not prevent an otherwise permitted user from consuming parsing/buffering resources.

Fix: reject disabled uploads before multipart parsing; enforce a total-request byte limit; prefer bounded disk/stream processing with storage quotas and cleanup. Bound expensive ZIP/search/thumbnail work and use host/container memory and CPU limits. Do not rely on process OOM termination as resource control.

### PE6 — Low to medium, scale-dependent: rate limiter never evicts inactive IPs

Evidence: `src/backend/middlewares/RateLimiter.ts:16`.

Expired entries are replaced only when that same IP makes another request. Unique IP keys accumulate for the lifetime of the process. A synthetic probe left 100 expired entries in the map after another request. Limits are also process-local, and apply only to login/share-login/OIDC callback routes.

Fix: bounded storage plus TTL eviction; coordinate limits across replicas when needed. Configure trusted proxies narrowly so client identity is correct. With trustProxy=false behind one proxy, users may share a single limit; indiscriminate trust can allow spoofed identities if an attacker can reach the origin or an unsanitized forwarded-header path.

## Deployment observations

The checked-in workspace's local config (not proof of production settings) has authentication enabled, anonymous role Admin, host 0.0.0.0, port 8081, trustProxy=false, uploads disabled with Admin minimum role, extensions enabled, and sharing enabled without a global password requirement.

**Do not disable application authentication just because Cloudflare adds a login page.** Anonymous role defaults to Admin (`ClientConfig.ts:1687`). With authentication disabled, every admitted visitor receives that configured role. Cloudflare admission does not automatically become a PiGallery identity or role. Keep distinct application accounts and use Guest/User roles for ordinary viewers.

Cookies already have HttpOnly/SameSite controls, but secure behavior behind an HTTP proxy depends on correctly recognizing the external HTTPS request. Validate the actual Set-Cookie attributes after deployment. Set publicUrl to the external HTTPS URL, use NODE_ENV=production, and trust only the known proxy path. There is no central security-header middleware in the reviewed backend; verify HSTS, framing protection, nosniff, and a compatible CSP at the edge/proxy/application boundary.

Protected media has private caching, but long browser cache lifetimes mean revocation cannot erase content already downloaded or cached by a recipient. Do not configure a CDN rule that caches authenticated HTML/API/media publicly.

## Recommended topology

```text
Browser → HTTPS → Cloudflare Access (allowlist + MFA)
                  → Cloudflare Tunnel → private PiGallery listener
                                        → app login and per-user roles
```

Cloudflare Tunnel establishes outbound connections, so **no inbound router port forwarding is required**. A private internal app port remains necessary. If cloudflared runs on the host, use a loopback listener such as 127.0.0.1:8081; if both services run in containers, use a private container network without publishing the app port publicly. Loopback in one container is not another container's loopback. See [Cloudflare Tunnel documentation](https://developers.cloudflare.com/tunnel/).

Create the Access application before publishing the tunnel route, protect the whole hostname including API/media/extension paths, and enable **Protect with Access** so cloudflared validates the Access token for the expected application. Tunnel by itself is not authentication. See [Cloudflare's self-hosted application setup](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/).

Use an explicit allowlist, MFA through the chosen identity setup, and finite Access sessions. Avoid bypass policies and alternate hostnames exposing the same origin. Block direct origin access over IPv4 and IPv6. Run PiGallery without root/privileged containers, expose no database/admin service publicly, and mount photos read-only when uploads and write-capable extensions are unnecessary. Keep writable config/database/cache volumes separate and maintain tested backups.

One public port (normally 443 on a hardened reverse proxy) is an alternative, but the number of ports does not determine application safety. If using Cloudflare without Tunnel, the origin must reject bypass traffic and validate Access tokens, with verified TLS to the origin. Prefer Tunnel for this private-gallery use case.

Access on the whole hostname means share recipients must also be admitted by Access. Anonymous public links require a deliberate separate design and expose those reachable app paths to everyone; they lose the pre-authentication protection. Do not add broad API/media bypasses merely to make sharing work.

Before enabling remote access, verify from outside the LAN that direct-origin connections fail, unauthenticated requests to the hostname encounter Access on every path, an admitted ordinary user cannot use admin/extension installation APIs, HTTPS cookies are secure, and protected responses cannot enter a shared public cache. Actual Cloudflare configuration and these external checks remain deployment work, not checks completed by this audit.

## Verification and limits

- Node 24 backend build passed.
- Existing focused tests: **63 passed**, covering filesystem/path/extension/metadata containment, CSRF, and rate limiting. These passes do not cover the new findings above.
- Seven isolated probes confirmed session/password/logout/expiry behavior, stale share permissions, retained limiter entries, missing extension-wrapper CSRF checks, and array-valued log-secret leakage. Probes used synthetic data and mocked managers; no real database, media, session secrets, or remote service was attacked. Temporary probe: `/tmp/pigallery-audit-probes.cjs`; test log: `/tmp/pigallery-audit-tests.log`.
- Upload memory arithmetic and router ordering were reviewed statically; no exhaustion test or end-to-end browser CSRF exploit was attempted.
- Live `npm audit --omit=dev` could not complete: sandbox DNS failed, and automatic approval review rejected the network retry because it would send production dependency metadata to registry.npmjs.org. Current advisory status is **unverified**; historical zero-vulnerability statements are not current evidence. User approval for that specific metadata disclosure is required to retry.
- Existing Security-Updates.md remains a historical remediation record. Its blanket closed status does not cover these new findings; notably the session, logging, and CSRF controls have the residual gaps described here.

Prioritize PE1/PE2/PE3, then PE4/PE5 and limiter hardening. For a small trusted group, Access + Tunnel + retained app login is the preferred deployment architecture, but it does not make the remaining findings disappear.
