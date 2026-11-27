# Battle chrome provenance

Reference: https://github.com/arcadia-star/seer2-fight-ui/tree/1c9d524e89b367fd5bc1d7fc2db1d55da0ad9218

The skill bar draws on the old Arena UI palette and layout. `skill-chrome.svg` is hand-authored radar glass with a cyan rim, reticle, sweep lines, and receiver arcs. CSS gives the glass a pale hover state and dims disabled cards. The live skill brief scales the old `UI_FightSkillBrief` (#300) anchors to the current card size.

`climax-emblem.svg` is an original hexagonal star accent inspired by the enabled and disabled lighting of `UI_FightSuperSkill` (#901). Eight CSS particles and a cyan edge pulse accompany enabled cards. Simple and reduced motion use a static highlight.

`command-chrome.svg` is a hand-authored navy surround with reflective end caps and a silver lip inspired by the palette of `UI_FightBarBack` (#327). Its proportions accommodate the current dock grid.

`loading/` contains vector exports of the shared battle loader `UI_FightLoading` (#602) from `UI_Arena.swf`: backdrop #540, tip strip #601, shade #555, band #543, glass frame #545, flash #557, VS #561 and its outline #568, gear #547, spark #551, level sign #597, percent sign #595 and the ten frames of digit #593. Exporter metadata is removed and viewBoxes are added. The `vs-outline.svg` stroke uses currentColor so CSS can apply the authored color transforms. `BattleLoading.vue` places them on the original 1200×660 stage. The entrance, line masks, VS bounce, frame-40 reveal and vanish keyframes in `battle-theme.css` are generated from the #572 placement matrices and mask shapes #541–#570. Player names, levels, portraits, reserves, tips, tasks and progress stay live in Vue.

`sounds/loading-enter.mp3` and `sounds/loading-vanish.mp3` are the original #553 and #571 MP3s, triggered on #572 frame 1 and on the `vanish` label at 100%. Content packs can override them with the `battle-ui:loading-enter` and `battle-ui:loading-vanish` tags.

`numbers/` contains the 20 HP/rage digit symbols and two slash symbols exported from the same reference SWF. Their native outlines, italic silhouettes and strokes are retained; exporter metadata is removed, viewBoxes are added, IDs are namespaced, and white fills use currentColor so live modifier colors remain visible. Values stay dynamic and accessible.

`status-chrome.svg` is an original vector design for the old status layout, with a chamfered indigo portrait bezel and a stepped gauge shelf. The layout and 40-frame meter behavior reference the old PVE controllers and the #228, #369 and #647 placements in `UI_Arena.swf`. The fill paths in `HealthRageBar.vue` are hand-authored, and the HP, rage and level labels use CSS text. The panel and fills contain no exported artwork or embedded rasters.
