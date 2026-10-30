# Project sources

JSON/YAML content can contain one record or an array. Preserve unknown fields, comments and stable content IDs when making focused changes. Names, paths, namespace, projectId and useId are separate identities. A file rename does not rename a content ID.

Species learn skills; skills and marks reference effects defined in `createEffects`. Traits and emblems use mark references. Cross-package references use the dependency's projectId and require declared npm dependencies; resource namespace references have a separate shape. Consult actual nearby examples and types instead of inventing either format.

Keep runtime media in `assets` and declare its usage through `presentation`. Species may use icon, portrait and battle; battle renderer is explicitly `image` or `seer2-swf`. Skills use sfx, marks use icon. HTTP(S) references are not downloaded by authoring tools. Source media replacement changes the next build, not an existing battle. Dynamic TS resource paths need manual review when files move.

Language files live in `locales/<language>/<namespace>.json|yaml`. Reuse the project's i18next namespaces and FormatJS variable contract. Plain template text in the workspace is not a rendered battle description; dynamic values require real battle context. Missing references and partial drafts may remain on disk, but checking, building and testing must report their errors.

For sustained effects, use the existing template test as a starting point: miss/hit, repeated application, parameter change, source transfer/removal, natural expiry, supported waiting-point restore and deterministic full battles. Tests should run the actual npm artifact in an independent installation. Keep media/package-content assertions: they catch source-only files omitted by the npm files list.
