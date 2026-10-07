# Battle chrome provenance

Reference: https://github.com/arcadia-star/seer2-fight-ui/tree/1c9d524e89b367fd5bc1d7fc2db1d55da0ad9218

The reference SWF vector symbols were inspected using JPEXS 22.0.2 SVG export. `skill-chrome.svg` is the original `UI_FightSkillBtn` (character 444 in `flash/src/_assets/assets.swf`) vector export, with exporter metadata removed and a viewBox added. Its cyan outline, curved translucent highlight, element ring and row separators are preserved. Live Vue text and icons follow `UI_FightSkillBrief` (character 898) coordinates. Climax adds a blue glow and eight bounded CSS particles; simplified/reduced motion retains a static highlight. The SVG contains no embedded text or icon.

`command-chrome.svg` recreates the colors and bevels of `UI_FightBarBack` (character 857), adapting its outer border to the current dock. Original fixed history/climax slot dividers are omitted because live Vue panels own those boundaries.

`loading-grid.svg` recreates the reference loading grid and radar using SVG patterns rather than thousands of repeated grid paths. All three SVGs contain native vector paths/gradients only, with no raster images or executable content. Player names, teams, progress, skill data, log entries and controls remain live Vue content. Reference artwork remains attributable to the reference project and its original game assets; recreating the interface does not change their ownership.
