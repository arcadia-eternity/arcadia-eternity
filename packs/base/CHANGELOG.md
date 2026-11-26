# Changelog

## [5.1.0](https://github.com/arcadia-eternity/arcadia-eternity/compare/data-pack-base-v5.0.3...data-pack-base-v5.1.0) (2026-11-26)


### ✨ Features

* play original skill VFX at the attacker's hit ([704b835](https://github.com/arcadia-eternity/arcadia-eternity/commit/704b835325397f9a4421aefdffdd6f4b25fdacc5))

## [5.0.3](https://github.com/arcadia-eternity/arcadia-eternity/compare/data-pack-base-v5.0.2...data-pack-base-v5.0.3) (2026-11-24)


### 🐛 Bug Fixes

* **base:** apply fengwen to poison damage ([426b60a](https://github.com/arcadia-eternity/arcadia-eternity/commit/426b60a43729d16b47f7f6aaa7a45cfff1061d95))
* **base:** correct restored pet and emblem effects ([eeb7dd0](https://github.com/arcadia-eternity/arcadia-eternity/commit/eeb7dd0d4db748e52bd1b89a12f078796833f5f0))

## [5.0.2](https://github.com/arcadia-eternity/arcadia-eternity/compare/data-pack-base-v5.0.1...data-pack-base-v5.0.2) (2026-11-24)


### 🐛 Bug Fixes

* **base:** bind missing mark icons ([0f6356f](https://github.com/arcadia-eternity/arcadia-eternity/commit/0f6356fa426b20737f761abd3a5abbb5d172d683))

## [5.0.1](https://github.com/arcadia-eternity/arcadia-eternity/compare/data-pack-base-v5.0.0...data-pack-base-v5.0.1) (2026-11-24)


### 🐛 Bug Fixes

* align bundled content with Arcadia 5 ([45336d5](https://github.com/arcadia-eternity/arcadia-eternity/commit/45336d5b9e0b67c28bf4f26b0a7a84da1c576541))

## [5.0.0](https://github.com/arcadia-eternity/arcadia-eternity/compare/data-pack-base-v4.14.2...data-pack-base-v5.0.0) (2026-11-24)


### ⚠ BREAKING CHANGES

* **battle:** route native effect mutations through ops
* **battle:** expose phase operations in the native effect SDK

### ♻️ Code Refactoring

* **base:** share pet effect logic across families ([263154e](https://github.com/arcadia-eternity/arcadia-eternity/commit/263154ef7fa0b40c97e762c1469e4e564f0d3002))
* **battle:** expose phase operations in the native effect SDK ([43d18b0](https://github.com/arcadia-eternity/arcadia-eternity/commit/43d18b0a8d18439d037bf23bd30b258e1e6a48d9))
* **battle:** move entity mutations into battle phases ([beb1e19](https://github.com/arcadia-eternity/arcadia-eternity/commit/beb1e198e91e926e1c782d2f22376324b0e32e95))
* **battle:** route native effect mutations through ops ([f3e23d6](https://github.com/arcadia-eternity/arcadia-eternity/commit/f3e23d6ca709a9b87c9e8b0a6e90cb88f29f0f6a))

## [4.14.2](https://github.com/arcadia-eternity/arcadia-eternity/compare/data-pack-base-v4.14.1...data-pack-base-v4.14.2) (2026-11-24)


### 🐛 Bug Fixes

* **base:** reuse shared skills and resolve stat changes before damage ([6d831fe](https://github.com/arcadia-eternity/arcadia-eternity/commit/6d831feeecd7c5af1321dbbbd9b5c46654ee0f40))

## [4.14.1](https://github.com/arcadia-eternity/arcadia-eternity/compare/data-pack-base-v4.14.0...data-pack-base-v4.14.1) (2026-11-23)


### 🐛 Bug Fixes

* **base:** correct mark lifetimes and battle triggers ([f823e5b](https://github.com/arcadia-eternity/arcadia-eternity/commit/f823e5beca1e7055e58f9b50924fc118b47842eb))
* **release:** group client and official content in one release PR ([30f4d26](https://github.com/arcadia-eternity/arcadia-eternity/commit/30f4d26cf41a698fff47cb1196fad6c5de2be546))

## [4.14.0](https://github.com/arcadia-eternity/arcadia-eternity/compare/data-pack-base-v4.13.2...data-pack-base-v4.14.0) (2026-11-23)


### ✨ Features

* **base:** restore 27 original pet families and wire their battle effects ([14754cb](https://github.com/arcadia-eternity/arcadia-eternity/commit/14754cbb032103beb6eb60053ef5eb74a73c5568))

## [4.13.2](https://github.com/arcadia-eternity/arcadia-eternity/compare/data-pack-base-v4.13.1...data-pack-base-v4.13.2) (2026-11-23)


### ♻️ Code Refactoring

* **battle:** resolve damage events and mark-held delayed strikes ([#328](https://github.com/arcadia-eternity/arcadia-eternity/issues/328)) ([180e66b](https://github.com/arcadia-eternity/arcadia-eternity/commit/180e66bf1b1153c0b1694ed13ce0a34bb31a533e))

## [4.13.1](https://github.com/arcadia-eternity/arcadia-eternity/compare/data-pack-base-v4.13.0...data-pack-base-v4.13.1) (2026-11-22)


### 🐛 Bug Fixes

* **release:** isolate client and content release manifests ([#318](https://github.com/arcadia-eternity/arcadia-eternity/issues/318)) ([590b968](https://github.com/arcadia-eternity/arcadia-eternity/commit/590b96808847b4add0f80ca7b20fee238670bb64))

## [4.13.0](https://github.com/arcadia-eternity/arcadia-eternity/compare/data-pack-base-v4.12.2...data-pack-base-v4.13.0) (2026-11-22)


### ✨ Features

* **base:** declare battle interface roles for pinned CDN assets ([14f4aca](https://github.com/arcadia-eternity/arcadia-eternity/commit/14f4acaafce3fc62418c4d0b7c7f339e8a4d3d67))
* **media:** preload environment assets and share battle resource reads ([c21d1a4](https://github.com/arcadia-eternity/arcadia-eternity/commit/c21d1a4b24ce372a004a2cdbfc6d1e750db8903c))

## [4.12.2](https://github.com/arcadia-eternity/arcadia-eternity/compare/data-pack-base-v4.12.1...data-pack-base-v4.12.2) (2026-11-22)


### 🐛 Bug Fixes

* **content:** ship official environments as standalone npm packages ([c117029](https://github.com/arcadia-eternity/arcadia-eternity/commit/c117029e7f69a7c3ebebb337eb253dedaed75946))

## [4.12.1](https://github.com/arcadia-eternity/arcadia-eternity/compare/data-pack-base-v4.12.0...data-pack-base-v4.12.1) (2026-11-21)


### 🐛 Bug Fixes

* **base:** watch the environment catalog and build staged base releases ([283a48e](https://github.com/arcadia-eternity/arcadia-eternity/commit/283a48e002310a800fedb8751a5bfebd69d3887c))

## [4.12.0](https://github.com/arcadia-eternity/arcadia-eternity/compare/data-pack-base-v4.11.1...data-pack-base-v4.12.0) (2026-11-21)


### ✨ Features

* **base:** release official environment presets with their base pack ([03ffe1f](https://github.com/arcadia-eternity/arcadia-eternity/commit/03ffe1f7db8a6955048256342b1cf0daee927d3e))
* **updates:** release and update the official base pack independently ([6ee1c77](https://github.com/arcadia-eternity/arcadia-eternity/commit/6ee1c772703bb41bad71dd5f6de4878319a127ce))
