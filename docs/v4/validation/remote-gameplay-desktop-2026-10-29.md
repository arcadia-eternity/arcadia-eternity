# Bundled desktop remote gameplay acceptance — 2026-10-29

The harness launches two independent Electron processes with empty temporary user-data directories, imports the real `electron/main.mjs`, and loads the existing production distribution at `arcadia-client://app`. It uses real standalone backend fixtures and normal UI interactions; it does not substitute a renderer, intercept network traffic, or import application stores.

From `packages/web-ui`:

```sh
ARCADIA_DESKTOP_GAMEPLAY_TEST=1 node --import tsx --test electron/test/remote-gameplay-electron.test.mjs
```

Image-mode acceptance passed in 58.85 seconds. Both clients created/selected fixture teams, joined a private room, played three turns to natural victory/defeat, refreshed the guest during combat, and repeated against a second backend advertising the same server ID with a different skill label.

- All four remote windows used the bundled application origin and denied all 41 management IPC handlers.
- Tokens differed between players and between backend origins. The second backend received no first-backend token; neither backend received the management credential probe.
- Four fallback images decoded successfully at 1×1 pixels. All 57/53 observed fixture asset responses used `Cache-Control: no-store`.
- Both backend catalogs were requested three times; neither backend supplied executable renderer code or package archives.
- Both management windows retained zero installed content packages and idle local-battle state.

Local ignored evidence: `packages/web-ui/native-content-qa.local/remote-gameplay/acceptance.json`, `server-1-battle-result.png`, and `server-2-battle-result.png`. Earlier evidence in the separate desktop QA checkout remains untouched.

Optional original-SWF canvas composition acceptance uses the production distribution:

```sh
ARCADIA_DESKTOP_GAMEPLAY_TEST=1 ARCADIA_DESKTOP_SWF_GAMEPLAY=1 node --import tsx --test electron/test/remote-gameplay-electron.test.mjs
```

Final offscreen acceptance passed in **36.50 seconds** against the production build after shared preparation/recovery fixes (`e918b365`). Two clean clients completed a natural two-turn victory/defeat, with a guest refresh during combat and fresh player instances. There were no loading retries. Both 1600×900 canvases contained visible, transparent and partially transparent pixels; hidden offscreen renderers retained original ready/hit/complete callbacks.

The real `Category.Climax` fixture skill exercised the core black-screen and effect layers at z-indices 1050/1060 over both canvases. The original movies use physical-attack fallback for the missing Climax animation state. The real log button click changed its `aria-pressed` state during the effect. Host resize/page-zoom scenarios were 1100×750 at 1.25, 1440×900 at 0.8, and 1280×768 at 1. Returning to the lobby removed both canvases and isolated renderers. Both clients denied all 41 management handlers; 51 fixture-media responses were no-store and the catalog was requested three times. Sampled presentation transport measured 19.16–20.82 frames/second and approximately 157–181 kB/second per player; these are observations of these original movies, not performance guarantees.

Committed compact evidence: [desktop canvas results](desktop-canvas-2026-10-29.json). Local detailed evidence is under `native-content-qa.local/remote-gameplay-canvas/`: `acceptance.json`, `layout.json`, `climax-layer-observation.json`, `Host-canvas-initial.png`, `Guest-canvas-initial.png`, `climax-over-both-pets.png`, and result screenshots. The root inspected the actual combined initial and Climax screenshots.

Earlier offscreen runs are retained as failure evidence. The fourth run passed initial visuals/Climax/resize but failed after refresh with zero canvas/player events and unknown portraits. Delayed-loader regression tests reproduced concurrent application/battle initialization overwriting the accepted server catalog. Stores now own one shared initialization lifecycle, pages consume current readiness, and recovery waits for the room catalog before applying state. A later harness run failed because it reused HUD coordinates measured before the skill transition; the final harness measures the actual button location in the same observation as the active effect, retains hit-testing plus real click/toggle assertions, and records the hit stack. No application state or network response is substituted.

The superseded native-view implementation passed a functional four-turn duel in 56.30 seconds, including original ready/hit/complete events, refresh with fresh instances, natural victory/defeat, result hiding, and view disposal. This is historical functional evidence, not visual acceptance. Exact-owner composite captures then reproduced the reported misalignment: logical sprite size 1600×900, scaled DOM size 1258.67×708, but native viewport size 1259×708. Both pets appeared near the bottom/center. Separate native views also prevented existing DOM effects from covering sprites. These findings prompted the offscreen renderer-to-DOM canvas approach.

Historical ignored evidence remains under `native-content-qa.local/remote-gameplay-swf/`: `acceptance.json`, `Host-composite-before.png`, `Guest-composite-before.png`, `layout-before.json`, and individual renderer captures. Page-only screenshots from that implementation omit native sibling views and cannot establish alignment.

This acceptance exercises the full production renderer through Electron; it does not certify a signed installer, installer upgrade, or operating-system signing/notarization.
