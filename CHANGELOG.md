# Changelog

## [1.1.0](https://github.com/KeeprDigital/stream-keepr/compare/v1.0.0...v1.1.0) (2026-08-15)


### Features

* **graphics-retention:** stranded staged input stays on the books until its release is proven ([#358](https://github.com/KeeprDigital/stream-keepr/issues/358)) ([6cb719d](https://github.com/KeeprDigital/stream-keepr/commit/6cb719d91cd8acb024541bfb15b902c39bc7c797))
* **release:** version releases with release-please; deploys ship released tags ([19e1655](https://github.com/KeeprDigital/stream-keepr/commit/19e1655151b0ae0045be6ca66aa606c18cf73a4b))


### Bug Fixes

* **ci:** give build-running jobs a 6GB Node heap ([552d2c5](https://github.com/KeeprDigital/stream-keepr/commit/552d2c5e59185d137df4b01ceebaa7efefebfcdd))
* **ci:** heap bump belongs to every job, not just the builders ([1c831b0](https://github.com/KeeprDigital/stream-keepr/commit/1c831b012027a6175a35772a1afe81b4caf943f7))


### Performance

* **screens:** index an authored save's references in one json_each insert ([#374](https://github.com/KeeprDigital/stream-keepr/issues/374)) ([97dc9c3](https://github.com/KeeprDigital/stream-keepr/commit/97dc9c3bf5a6de01f7f524c410fbd206f08aa083))


### Refactoring

* **graphics-assets:** one resumable multipart transfer for both ingestion paths ([#150](https://github.com/KeeprDigital/stream-keepr/issues/150)) ([dd99d6a](https://github.com/KeeprDigital/stream-keepr/commit/dd99d6a25b0c661659ca9f6c270d1e4e7a821bdb))
* **review:** apply the two-axis review's standards findings ([#150](https://github.com/KeeprDigital/stream-keepr/issues/150), [#374](https://github.com/KeeprDigital/stream-keepr/issues/374), [#358](https://github.com/KeeprDigital/stream-keepr/issues/358)) ([2457f99](https://github.com/KeeprDigital/stream-keepr/commit/2457f99432d8b30307f9ee658342c8a20e84cf55))
