# SPDX reference texts

Desktop packaging and publication preserve this inventory and report unresolved
notice findings without blocking. `verify-desktop-pack.mjs --require-complete-notices`
and the equivalent staging option provide an optional strict audit. Runtime file,
dependency, native ABI and inventory integrity checks remain mandatory. The legacy
manifest field `releaseReady` describes strict notice completeness only.

The `.txt` files are verbatim copies from the SPDX License List Data repository,
release `v3.27.0`, commit `d46e94e2c78ceede1cfc63cfa0396472d2798d4c`:

| File                                                                                                                                | SHA-256                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| [MIT-0.txt](https://github.com/spdx/license-list-data/blob/d46e94e2c78ceede1cfc63cfa0396472d2798d4c/text/MIT-0.txt)                 | `59746d6285ffa44bfc7ecada352aa5d6a20dc8eab418a60ce091cc739012c135` |
| [BlueOak-1.0.0.txt](https://github.com/spdx/license-list-data/blob/d46e94e2c78ceede1cfc63cfa0396472d2798d4c/text/BlueOak-1.0.0.txt) | `8a1af140fdfbf5afd3df27f7e662f989c5b963a300020dfafce42033cae9e004` |
| [BSD-3-Clause.txt](https://github.com/spdx/license-list-data/blob/d46e94e2c78ceede1cfc63cfa0396472d2798d4c/text/BSD-3-Clause.txt)   | `5a93d5831e1297ab10fe643e1a631e83be392896da14ee2951285a79012df69d` |

The [upstream README](https://github.com/spdx/license-list-data/blob/d46e94e2c78ceede1cfc63cfa0396472d2798d4c/README.md) describes their origin in the SPDX License List XML repository. These files are comparison references, not evidence of a particular package's license. The inventory preserves the package's own original text and only accepts matching declared terms after limited normalization of copyright headers, formatting, punctuation, and list numbering. Additional or changed terms remain flagged for review; a successful comparison is not a substitute for legal review.

## Exact package notices

The files under `packages/` preserve the original notice bytes from the pinned package versions below. Their standard MIT terms or BSD-3-Clause terms were compared with the license reference; the BSD notices name the holder in the endorsement clause, and the MIT notices put the actual copyright holders after a description of their contributions. The inventory accepts one of these notices only for the same package name, version, and exact SHA-256; it still copies the actual installed package's notice into the runtime. Any change to the notice, package identity, or declared license remains subject to review.

| Source package and notice                                                                                    | Fixture                    | SHA-256                                                            |
| ------------------------------------------------------------------------------------------------------------ | -------------------------- | ------------------------------------------------------------------ |
| `balanced-match@4.0.4/LICENSE.md`                                                                            | `balanced-match-4.0.4.txt` | `d408f38ffa3355c5faec517153295338892eb0f1ea43f57874bb23c6075979b5` |
| `pngjs@7.0.0/LICENSE`                                                                                        | `pngjs-7.0.0.txt`          | `be75ef59c5cf59715588a17a82dff7dd3e83c4dba3c458676bb9311e05fbedc5` |
| `diff@8.0.4/LICENSE`                                                                                         | `diff-8.0.4.txt`           | `eda81a415869e67809f6a9f3fd6056062cb83a462118e07eec5e92b2e0c40ce9` |
| `esquery@1.7.0/license.txt`                                                                                  | `esquery-1.7.0.txt`        | `ac68116ae73740de4190892f334992e449a124600924ec761e64319d3aac9e6e` |
| `istanbul-lib-coverage@3.2.2/LICENSE`, `istanbul-lib-report@3.0.1/LICENSE`, `istanbul-reports@3.2.0/LICENSE` | `istanbul-licenses.txt`    | `e09f9b52c6ce5c17ba8103cd0cbf446c33b5448b0c1d01d711b36a1f15a501ba` |
| `source-map-js@1.2.2/LICENSE`                                                                                | `source-map-js-1.2.2.txt`  | `6cb0631f71c7749763fd3dd1d5bee52dd1070ec17f2edc1710079ad070bd2fbd` |
| `tough-cookie@5.1.2/LICENSE`                                                                                 | `tough-cookie-5.1.2.txt`   | `22ec6791c91ba42c0516a05f4cbdde019aae4687f8a38c5ca7e8a69ee68f851d` |

These package notices were copied from the locked staged npm dependencies. They are comparison/test fixtures, not a substitute for distributing each package's own notice.

## Additional reviewed published notices

The following fixtures also preserve the exact license files shipped by the locked packages. The collector still requires the package's declared license to match. It does not add or invent copyright holders when a publisher omitted them. Each allowance is restricted to the named version and identical original bytes; unknown packages and altered notices remain unresolved.

| Packages                                                                                                                        | Fixture                       | Reason for exact matching                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@colors/colors@1.5.0`                                                                                                          | `colors-1.5.0.txt`            | Full MIT grant with copyright holders in a bulleted list.                                                                                                                                                        |
| `@jitl/quickjs-ffi-types`, `quickjs-emscripten`, `quickjs-emscripten-core`, each `0.32.0`                                       | `quickjs-0.32.0.txt`          | Full MIT grant with the project name preceding the copyright line.                                                                                                                                               |
| `fast-uri@3.1.8`                                                                                                                | `fast-uri-3.1.8.txt`          | Full BSD-3-Clause grant with named contributors and the original contributor link.                                                                                                                               |
| `json-schema-typed@8.0.2`                                                                                                       | `json-schema-typed-8.0.2.txt` | Full BSD-2-Clause grant with attribution introduced by “Original source code”.                                                                                                                                   |
| `tslib@2.9.1`                                                                                                                   | `tslib-2.9.1.txt`             | Full 0BSD grant. Its separate `CopyrightNotice.txt` is also preserved in the inventory.                                                                                                                          |
| `archy@1.0.0`, `github-from-package@0.0.0`, `json-stable-stringify-without-jsonify@1.0.1`, `minimist@1.2.8`, `text-table@0.2.0` | `mit-publisher-no-holder.txt` | Publisher-supplied full MIT grant has no holder line; the original grant is preserved without adding a name.                                                                                                     |
| `pkce-challenge@5.0.0`                                                                                                          | `pkce-challenge-5.0.0.txt`    | Publisher-supplied full MIT grant leaves the holder blank after the year; those original bytes are retained.                                                                                                     |
| `nodemailer@10.2.1`                                                                                                             | `nodemailer-10.2.1.txt`       | Publisher declares MIT-0 and ships the full grant and disclaimer, with an empty conditions introduction; only these exact published bytes are accepted.                                                          |
| `chownr@3.0.0`, `glob@13.0.6`, `yallist@5.0.0`                                                                                  | `blueoak-published-dist.txt`  | The original Blue Oak notice excludes separately licensed `src/` packages. The published artifacts contain no `src/`; the collector checks this before accepting the notice and keeps the entire scope preamble. |

Single-entry legacy `licenses` metadata is recorded with its original field location; the known legacy spelling `Apache 2.0` is normalized to `Apache-2.0`. It never overrides a modern `license` field or combines ambiguous multiple declarations. An upstream declaration/text conflict, including `@npmcli/redact@4.0.0` declaring ISC while shipping MIT, remains an advisory inventory entry and only fails an explicitly requested strict audit.
