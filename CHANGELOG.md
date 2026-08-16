# Changelog

## [1.2.0](https://github.com/KeeprDigital/stream-keepr/compare/v1.1.0...v1.2.0) (2026-08-16)


### Features

* **broadcast-graphics:** the Edit workspace answers "did my save land?" ([#381](https://github.com/KeeprDigital/stream-keepr/issues/381)) ([1108737](https://github.com/KeeprDigital/stream-keepr/commit/1108737f5c9c60c175efa7fc850c64e69ce89b70))
* **deploy:** auto-detect whether the validator Worker must deploy ([51cae69](https://github.com/KeeprDigital/stream-keepr/commit/51cae6999e909681acfe5576e7137c5c7ecdb8b2))
* **deploy:** validator promotion decides itself from deployment records ([57e2a14](https://github.com/KeeprDigital/stream-keepr/commit/57e2a148158f50fd372934156d8f227757589586))


### Bug Fixes

* **graphics-templates:** fail the template asserts closed on a batch-answer hole ([#382](https://github.com/KeeprDigital/stream-keepr/issues/382)) ([56ca316](https://github.com/KeeprDigital/stream-keepr/commit/56ca316f5c657f95db8fd23e9ea013d71cd85bdf))
* **scripts:** mint the [#374](https://github.com/KeeprDigital/stream-keepr/issues/374) probe's session with an Accept: text/html header ([2d213d2](https://github.com/KeeprDigital/stream-keepr/commit/2d213d26fd81818f9ec375106ba33b077b46d856))


### Performance

* **graphics-templates:** batch both template saves' reference-existence checks ([#382](https://github.com/KeeprDigital/stream-keepr/issues/382)) ([8efc901](https://github.com/KeeprDigital/stream-keepr/commit/8efc901b29b25c492496c6ad41a6a41cabd3a7c8))
* **screens:** batch an authored save's selectability checks into one library question ([#374](https://github.com/KeeprDigital/stream-keepr/issues/374)) ([ca8fca9](https://github.com/KeeprDigital/stream-keepr/commit/ca8fca94b56b8e04a9b97fb2dde577cd7047f0f5))


### Refactoring

* **graphics-assets:** fold the inspect status shape the review flagged, pin the batch's refusal holes ([#374](https://github.com/KeeprDigital/stream-keepr/issues/374)) ([c8a3b12](https://github.com/KeeprDigital/stream-keepr/commit/c8a3b12180dbec5d4c5399d412771b0baa9cfce5))

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
