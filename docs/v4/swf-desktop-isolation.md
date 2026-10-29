# Desktop SWF isolation (#253)

The desktop player runs the client-bundled `swf-player.html` in a hidden, sandboxed, offscreen `BrowserWindow`. SWF scripts and the entire player page are untrusted. Only the bounded playback preload is available; neither management APIs nor remote-play credentials are exposed. The game UI receives transparent image frames and draws them into a DOM canvas. Hit/completion callbacks remain cosmetic and never enter the authoritative battle protocol.

## Rendering and composition

The initial visible `WebContentsView` implementation did not participate in the game's DOM stacking context. Real-window inspection found displaced sprites when the battle stage applied CSS scaling; original Climax effects also could not cover native child views. That implementation is superseded. The final player is never attached as a child view over the game window.

Electron's [offscreen rendering](https://www.electronjs.org/docs/latest/tutorial/offscreen-rendering) supplies native paint images. The host sends bounded PNG updates through a presentation-only channel. The owner draws them into `canvas[data-swf-player]` inside the existing sprite element, with pointer events disabled. Existing CSS transforms, clipping, opacity, HUD controls, Climax effects, and result overlays therefore use the normal page compositor. The browser iframe implementation is unchanged.

The logical canvas retains the battle stage's dimensions, normally 1600×900. Offscreen device scale factor is explicitly 1, avoiding accidental Retina multiplication. GPU acceleration stays enabled. The frame rate is capped at 24 fps, matching the bundled petContainer SWF header. No screenshot polling, external URL capture, or native module is exposed to the renderer.

## Bounded frame channel

`swf-frame-broker.mjs` accepts images only from Electron's native `paint` event. The untrusted player preload cannot emit image frames. The trusted game preload exposes fixed `onFrame` and `ackFrame` operations in addition to playback controls; the host checks the actual registered owner main frame.

Frames carry an instance, playback task, increasing frame number, logical canvas dimensions, a dirty rectangle, and PNG bytes. Dimensions are limited to 2048 per axis and 2,097,152 total pixels; encoded frames are limited to 8 MiB. The host permits one unacknowledged frame and one newest coalesced paint image per player. Intermediate changes accumulate into one dirty region. The first frame after a task change or resize covers the complete canvas; a resize waits for any old frame acknowledgement.

For ordinary updates, the host conservatively trims fully zero pixels before encoding. Channel ordering is irrelevant to this test; nonzero transparent pixels are retained. The region includes both previous and current content so moving sprites leave no trails. Raw native bitmap data never crosses the IPC boundary. The owner validates PNG dimensions before decoding, clears the dirty rectangle before drawing, closes decoded ImageBitmaps, and acknowledges completed or discarded work. Stale tasks and disposed canvas instances cannot repaint a newer scene.

## Permissions and lifecycle

Each player receives a distinct nonpersistent session with HTTP caching disabled. Node integration is disabled; sandbox, context isolation, and web security are enabled. The exact bundled custom-protocol page is the only served file. HTTP(S), WebSocket, arbitrary file/custom paths, navigation, popups, webviews, downloads, device access, and permission requests are denied. Blob URLs contain only the approved runtime and media bytes already delivered to the player. There is no network or file proxy.

Runtime files are loaded from the pinned local Ruffle distribution and replace caller-provided runtime bytes. Container/movie bytes remain bounded and validated. The shared player uses the installed Ruffle v1 API's `suspend()` / `resume()` methods. Resources are requested on demand, without a shared asset cache or prefetch.

The host permits two players per owner. Main-frame document navigation/reload, owner crash/destruction, explicit disposal, and player failures release the renderer, session, listeners, and frame state. Hash navigation and child-frame navigation do not destroy active players. A host-side heartbeat watchdog detects blocked player JavaScript; it checks actual renderer process ownership before forcibly terminating a process, avoiding a shared-process crash. An acknowledgement deadline also prevents a stalled frame channel from freezing silently.

Development resolves the fixed page from `public/swf-player.html` and runtime from `node_modules/@ruffle-rs/ruffle`; built clients use `dist/swf-player.html` and `dist/ruffle`. Import `swf-host.mjs` before Electron readiness to register its scheme, then register its IPC after readiness. The two trusted game preloads use the same bounded protocol. No battle wire message was added.

## Validation evidence

2026-10-29, macOS arm64, Electron 41.10.7:

- The two-player offscreen prototype retained GPU acceleration and separate renderer PIDs. At 1600×900, conservative trimming reduced measured scan/crop/PNG work from roughly 32 ms to 4.9–5.5 ms per frame in the sampled original animation; approximately 24 paint frames per second were observed per player over five seconds. This measures the prototype, not guaranteed performance on every machine or adversarial material.
- The real Electron canvas fixture passed transparency, CSS stage scales 0.5/0.75, owner zoom 1.25/0.8, resize, modal clicks, and absence of native child views over the UI. Three reloads recovered both playback slots; owner crash/recovery/destruction and listener cleanup passed.
- The real Electron security fixture passed independent process/session checks, denied network/file/native/device operations, callback-flood disposal, and watchdog recovery from blocked player JavaScript.
- Full production-client gameplay and Climax composition evidence is recorded separately in `validation/remote-gameplay-desktop-2026-10-29.md`. Earlier visible-child-view screenshots and functional results are historical evidence, not acceptance of the final compositor.

These checks do not establish hard CPU/heap quotas. Signed installers, Windows/Linux behavior, a wider malicious binary SWF corpus, physical audio timing, and sustained resource-pressure testing remain release acceptance work.
