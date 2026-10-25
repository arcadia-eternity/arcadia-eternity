# Static Web host

Issue #208 adds a self-contained browser distribution. It runs local AI battles without a game server, account, Redis or database. The normal Web build continues to offer online rooms.

## Build and serve

```sh
pnpm install --frozen-lockfile
pnpm --filter @arcadia-eternity/web-ui run build:static
```

Publish the entire `packages/web-ui/dist/` directory to a static HTTP(S) host. A root URL or a subdirectory such as `/game/` works. Routes use `#/local-battle`, so the host does not need an SPA fallback or API proxy. Serve the directory URL with its trailing slash. JavaScript, JSON, PNG, MP3, SWF and WASM need their normal content types; `.wasm` is `application/wasm`. Opening `index.html` through `file://` is not supported.

`build:static` builds workspace dependencies, enables `VITE_STATIC_MODE=1`, bundles the application with relative URLs, copies official assets and generates the offline manifest and worker. The static entry opens local battle configuration; account and room routes are excluded. Ordinary `build`/`build-only` retain the existing online product. Direct local pages in that build no longer wait for server connection.

Official content and the compiled TypeScript effects remain part of the existing native loader. The 1,039 official media files are copied to `official-assets/`; they are real portraits, animations, icons, backgrounds and audio. `resource/static-assets.lock.json` pins their byte sizes and SHA256 hashes. The build downloads missing files from the two existing official resource origins and reuses `packages/web-ui/.static-assets-cache/` on later builds. It fails on a missing file or a hash mismatch. Binary assets are not checked into Git.

To deliberately refresh upstream media, review the changed sources, then run:

```sh
node scripts/prepare-static-assets.mjs --update-lock
```

Commit the reviewed lock changes with the corresponding content changes. Normal builds never update the lock. Build-time downloads require internet access on a cold machine; a completed distribution has no runtime dependency on those resource hosts. Custom user pack URLs keep their original semantics and are not part of this official offline package; cross-host user storage and sharing remain #214/#217.

## Offline and storage behavior

The browser can play immediately from the static host. “保存离线资源” explicitly saves the complete build, displays its size and progress, and enables reload without a network connection. Saving requires HTTPS or localhost and browser Cache Storage/Service Worker support. Every saved file is checked against the build manifest before the cache is marked ready. A failed download, version mismatch or quota failure does not report success, and the current page can continue playing. Previous complete caches are replaced only after a new complete build and worker are ready.

The worker is scoped to the mounted directory and only handles listed static files. It never caches game APIs, login data or third-party content. While online, the static host remains the source of responses; saved responses provide the offline fallback. Updating a published build requires saving its resources again to refresh the offline copy. Keep pages from a previous release online until their current match ends.

Browser data is local to that origin and browser profile. Cache eviction, private browsing, quota limits or clearing site data can remove downloaded resources, teams and settings. The app shows a persistent warning if local storage cannot be read or written and keeps the current session playable in memory. Export pets/teams from the storage page for backups. Resource caching does not save an in-progress battle; reopening starts a new local battle from the saved teams.

## Acceptance

```sh
pnpm --filter @arcadia-eternity/web-ui run build:static
pnpm --filter @arcadia-eternity/web-ui run test:e2e:static
```

The dedicated test server serves only `dist` beneath `/game/`, without a game backend or SPA rewrites. Tests use production UI controls and real media, without importing source modules or replacing assets. They cover a fresh profile selecting a team and reaching a natural AI result, starting another match, saved-resource offline reload, Cache Storage quota failure and blocked local storage. Requests outside the mounted static directory, game APIs and WebSockets are blocked and asserted absent. Browser results and screenshots are retained in Playwright artifacts; CI runs this suite in `native-browser-entry`.

Platform-specific hosting and real deployment remain #219; Electron remains #209. This change does not publish a server or a website.
