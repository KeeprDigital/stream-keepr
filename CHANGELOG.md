# Changelog

## [1.3.0](https://github.com/KeeprDigital/stream-keepr/compare/v1.2.0...v1.3.0) (2026-09-23)


### Features

* add built Worker smoke gate ([#437](https://github.com/KeeprDigital/stream-keepr/issues/437)) ([603e68f](https://github.com/KeeprDigital/stream-keepr/commit/603e68f953d74307c18e46870b70e4d67f72b8d5))
* add synchronized social profile rotation ([73694c4](https://github.com/KeeprDigital/stream-keepr/commit/73694c44c9f2f6aefa61747e71e3207966aa48d3))
* animate social profile transitions ([9495778](https://github.com/KeeprDigital/stream-keepr/commit/9495778e32e501178d65f30b34c83c6556ca53d2))
* **animation-effects:** add the ember shader-plane effect ([#473](https://github.com/KeeprDigital/stream-keepr/issues/473)) ([890c8c3](https://github.com/KeeprDigital/stream-keepr/commit/890c8c31127680ccdf67df907efe82a3955a2769))
* **animation-effects:** add the inkmap shader-plane effect ([#473](https://github.com/KeeprDigital/stream-keepr/issues/473)) ([d9c36f9](https://github.com/KeeprDigital/stream-keepr/commit/d9c36f90f6ceca6431a15acfb8e59e949a1de2ec))
* **animation-effects:** add the ridgelines shader-plane effect ([#473](https://github.com/KeeprDigital/stream-keepr/issues/473)) ([5f90bec](https://github.com/KeeprDigital/stream-keepr/commit/5f90bec6802664ee3e658ca72e728c1fd73663c7))
* **animation-effects:** add the shards shader-plane effect ([#473](https://github.com/KeeprDigital/stream-keepr/issues/473)) ([225c9c1](https://github.com/KeeprDigital/stream-keepr/commit/225c9c10cc8f537e065ff398aaafca7047351909))
* **animation-effects:** add the weave shader-plane effect ([#473](https://github.com/KeeprDigital/stream-keepr/issues/473)) ([f1476e1](https://github.com/KeeprDigital/stream-keepr/commit/f1476e1932ce8b329f0a1ff4fdce718d45fb999a))
* **animation-effects:** first slice of the in-house Animation Effect system ([#473](https://github.com/KeeprDigital/stream-keepr/issues/473)) ([6fda25a](https://github.com/KeeprDigital/stream-keepr/commit/6fda25ad7f0393555d6ed62af3ea2522dee9152e))
* **animation-effects:** port cells and ripple from the retired fork ([#473](https://github.com/KeeprDigital/stream-keepr/issues/473)) ([4c1dbc6](https://github.com/KeeprDigital/stream-keepr/commit/4c1dbc67d58eedd82fd78e4053db8f3186618fff))
* **animation-effects:** port dots onto the scene/mesh base ([#473](https://github.com/KeeprDigital/stream-keepr/issues/473)) ([e0367dd](https://github.com/KeeprDigital/stream-keepr/commit/e0367dd60a151c4b8e9bc7e215556e52ae015b19))
* **animation-effects:** port globe onto the scene/mesh base ([#473](https://github.com/KeeprDigital/stream-keepr/issues/473)) ([deee18d](https://github.com/KeeprDigital/stream-keepr/commit/deee18db3cfeb1e7546e04f81136419a67a1975f))
* **animation-effects:** port halo onto a feedback-buffer shader plane ([#473](https://github.com/KeeprDigital/stream-keepr/issues/473)) ([14955d3](https://github.com/KeeprDigital/stream-keepr/commit/14955d3b0879f4433f09606a7a3f400c8c0c8dbe))
* **animation-effects:** port net onto the scene/mesh base ([#473](https://github.com/KeeprDigital/stream-keepr/issues/473)) ([9ec6d6f](https://github.com/KeeprDigital/stream-keepr/commit/9ec6d6f4f377443b0c655441e0b3dc20a82dee58))
* **animation-effects:** port rings onto the scene/mesh base ([#473](https://github.com/KeeprDigital/stream-keepr/issues/473)) ([14ac1a3](https://github.com/KeeprDigital/stream-keepr/commit/14ac1a3b3d90483c49810e3a387c15caa01cc216))
* **animation-effects:** port waves onto the scene/mesh base ([#473](https://github.com/KeeprDigital/stream-keepr/issues/473)) ([a903575](https://github.com/KeeprDigital/stream-keepr/commit/a9035750055c91c30e93bf9639ca9c536d4de7c0))
* **animation:** give the ripple effect centre and frequency controls ([e4083ce](https://github.com/KeeprDigital/stream-keepr/commit/e4083ceee40eee4dab5b61c7d147c6cd493539b0))
* **auth:** add local developer session ([#456](https://github.com/KeeprDigital/stream-keepr/issues/456)) ([b52cf8c](https://github.com/KeeprDigital/stream-keepr/commit/b52cf8cfb451aaf75a6f3b07662070a4f56eaab7))
* **auth:** Better Auth on D1 via the Drizzle adapter ([#393](https://github.com/KeeprDigital/stream-keepr/issues/393)) ([45af73a](https://github.com/KeeprDigital/stream-keepr/commit/45af73a24748a4839f6108b1d7beaef30dacae31))
* **auth:** capability-gated slug lookup and dual-grant realtime token ([#397](https://github.com/KeeprDigital/stream-keepr/issues/397)) ([#409](https://github.com/KeeprDigital/stream-keepr/issues/409)) ([7ac879a](https://github.com/KeeprDigital/stream-keepr/commit/7ac879a48dbd9fc47e1f60383690b6556a2ef25d))
* **auth:** carry local session through preview ([#457](https://github.com/KeeprDigital/stream-keepr/issues/457)) ([1555444](https://github.com/KeeprDigital/stream-keepr/commit/15554449e723255ddf4464a7936b1a78c587c6e8))
* **auth:** deny-by-default API boundary over /api/** ([#396](https://github.com/KeeprDigital/stream-keepr/issues/396)) ([#408](https://github.com/KeeprDigital/stream-keepr/issues/408)) ([02279f0](https://github.com/KeeprDigital/stream-keepr/commit/02279f00f63772685edaf865cd67c135f04b4609))
* **auth:** login page, sign-out, and the client-side page gate ([#395](https://github.com/KeeprDigital/stream-keepr/issues/395)) ([#403](https://github.com/KeeprDigital/stream-keepr/issues/403)) ([06701bc](https://github.com/KeeprDigital/stream-keepr/commit/06701bcf69c71450e0737ce45b8dfcf21bbe6dd0))
* **auth:** name the person holding a Graphics Authoring Lease ([#398](https://github.com/KeeprDigital/stream-keepr/issues/398)) ([e3f354d](https://github.com/KeeprDigital/stream-keepr/commit/e3f354d1004d95e2be9a8a912f1d5d9c321c4f96))
* author social profile projections ([#421](https://github.com/KeeprDigital/stream-keepr/issues/421)) ([44b263d](https://github.com/KeeprDigital/stream-keepr/commit/44b263dfe0062132b206e65f9e5eba3aa927efc1))
* **auth:** secret-armed first-admin bootstrap endpoint ([#394](https://github.com/KeeprDigital/stream-keepr/issues/394)) ([a9a01f2](https://github.com/KeeprDigital/stream-keepr/commit/a9a01f2b043fbcf1d4db9e0e1a6fc4023df380c3))
* **auth:** the user replaces the Graphics Author Session ([#398](https://github.com/KeeprDigital/stream-keepr/issues/398)) ([0bedc0d](https://github.com/KeeprDigital/stream-keepr/commit/0bedc0db12e6788f6cdcb0652db9e74c189528f7))
* **auth:** user administration surface — invites, reset links, ban, revoke ([#399](https://github.com/KeeprDigital/stream-keepr/issues/399)) ([#415](https://github.com/KeeprDigital/stream-keepr/issues/415)) ([9c32533](https://github.com/KeeprDigital/stream-keepr/commit/9c325330c4edc442d635cf2d8b29961d17b79bd0))
* **background-screen:** rename idle to background and build the layer stack ([#473](https://github.com/KeeprDigital/stream-keepr/issues/473)) ([6a53b08](https://github.com/KeeprDigital/stream-keepr/commit/6a53b08d2c3fcd76cde1117ca223ac359e8f0ce6))
* **broadcast-decks:** add strict import engine ([#512](https://github.com/KeeprDigital/stream-keepr/issues/512)) ([720d073](https://github.com/KeeprDigital/stream-keepr/commit/720d073e00c9e50c242154755a8c97d5c8963171))
* **broadcast-decks:** persist Event deck lists ([#513](https://github.com/KeeprDigital/stream-keepr/issues/513)) ([bd14f99](https://github.com/KeeprDigital/stream-keepr/commit/bd14f993995996924944314d03d1fd83f065c184))
* **broadcast-graphics:** add manual social profile live control ([1e878f1](https://github.com/KeeprDigital/stream-keepr/commit/1e878f174a28278e131c598eb8b6085d9463879f))
* **broadcast-graphics:** animated background as the third Animation Effect host ([#495](https://github.com/KeeprDigital/stream-keepr/issues/495)) ([a9e8999](https://github.com/KeeprDigital/stream-keepr/commit/a9e8999dbda2213c19cffaff6d88333cca08db48))
* **broadcast:** add Deck List library workflow ([#515](https://github.com/KeeprDigital/stream-keepr/issues/515)) ([eb3f3f5](https://github.com/KeeprDigital/stream-keepr/commit/eb3f3f5b6dceaa349d64a2669e74fda42482037c))
* **deck-screen:** board selection and per-board layout blocks ([#488](https://github.com/KeeprDigital/stream-keepr/issues/488)) ([dcca431](https://github.com/KeeprDigital/stream-keepr/commit/dcca431fc348809fb359b2585f165e9aa2ac10cd))
* **deck:** bounded retry with backoff for Scryfall batch fetches ([#465](https://github.com/KeeprDigital/stream-keepr/issues/465)) ([9e16272](https://github.com/KeeprDigital/stream-keepr/commit/9e162720a2d871285589b969f5845054660a812d))
* **deck:** degraded card data reporting and reload-free re-fetch on the deck overlay ([#465](https://github.com/KeeprDigital/stream-keepr/issues/465)) ([f5ca3ad](https://github.com/KeeprDigital/stream-keepr/commit/f5ca3ad215645806f87b9c4d3367bbbb0e4bd74c))
* **deck:** enforce canonical Deck sources ([#514](https://github.com/KeeprDigital/stream-keepr/issues/514)) ([33a9bb8](https://github.com/KeeprDigital/stream-keepr/commit/33a9bb8c8b7b4bff045b61f2e9b9c5d61188bec7))
* **deck:** render Broadcast Deck Lists ([#516](https://github.com/KeeprDigital/stream-keepr/issues/516)) ([29336b5](https://github.com/KeeprDigital/stream-keepr/commit/29336b52998faad07d69626bb3cb20098ad003c6))
* expand feature match notes ([#429](https://github.com/KeeprDigital/stream-keepr/issues/429)) ([72e60cb](https://github.com/KeeprDigital/stream-keepr/commit/72e60cbd44f5dd851f8076647baddef4fed93d62))
* **feature-match-overlay:** place a Source Item glow inside or outside its border ([d59eb62](https://github.com/KeeprDigital/stream-keepr/commit/d59eb622a409a2e2100049e0743084083402b3b8))
* **feature-match-overlay:** resolve record tokens and win indicators from the Event ([6b5a267](https://github.com/KeeprDigital/stream-keepr/commit/6b5a26723a92f247bdf8ae74403e6bfb65ec5002))
* **feature-match:** add the Edit Match State dialog ([#463](https://github.com/KeeprDigital/stream-keepr/issues/463) follow-up) ([bffade3](https://github.com/KeeprDigital/stream-keepr/commit/bffade301a459febb90f2e7c0aae0d9ad310629d))
* **feature-match:** sideboardRevealed live state, SetSideboardRevealed command, Show-sideboards toggle ([#490](https://github.com/KeeprDigital/stream-keepr/issues/490)) ([652835d](https://github.com/KeeprDigital/stream-keepr/commit/652835dea1d0564e5f77a1526638ee00c3cfd377))
* **fmo:** per-item reveal animation trigger in the FMO host ([#492](https://github.com/KeeprDigital/stream-keepr/issues/492)) ([d11f986](https://github.com/KeeprDigital/stream-keepr/commit/d11f9868e488455066d5ab761530449794ba70eb))
* **fmo:** real sideboard card data into the Feature Match Overlay output ([#491](https://github.com/KeeprDigital/stream-keepr/issues/491)) ([26d557f](https://github.com/KeeprDigital/stream-keepr/commit/26d557f32f971a2f6242e1e82e4fa4acbba9f834))
* **graphics:** deck-list Graphic Item — kind, schema, rendering, authoring UI ([#489](https://github.com/KeeprDigital/stream-keepr/issues/489)) ([30e1a2f](https://github.com/KeeprDigital/stream-keepr/commit/30e1a2f21aa22649cc17f3725347c92b19f9f3ad))
* **graphics:** let a Graphic Placeholder override the base font style ([22b4073](https://github.com/KeeprDigital/stream-keepr/commit/22b407371734a78aba2b57b602297f44b4d39f97))
* **graphics:** paint Deck Colours tokens as MTG mana pips ([a6ad31b](https://github.com/KeeprDigital/stream-keepr/commit/a6ad31ba16e7c456a73276b3367abc0b83072033))
* **graphics:** project social profiles into items ([5e6072b](https://github.com/KeeprDigital/stream-keepr/commit/5e6072b2ad264b3a1a69153f539b40f15a90735e))
* **graphics:** re-resolve social profiles on air ([afb4356](https://github.com/KeeprDigital/stream-keepr/commit/afb435676471266fc28b694c874b0e3419d4df4c))
* **melee:** log which fields failed schema validation ([196b58a](https://github.com/KeeprDigital/stream-keepr/commit/196b58a332ecf757e30ed1c7184ca24d22276e6d))
* **metagame:** add a minimum-points scope, an archetype limit, and conversion rate ([7791d52](https://github.com/KeeprDigital/stream-keepr/commit/7791d529519ded01dc5bdae875cf55f2db93376a))
* **screen:** give every plain overlay mode its own Background Layer stack ([b996219](https://github.com/KeeprDigital/stream-keepr/commit/b996219959219d2a2d78f8b0ce1a8c0f6b467d5e))
* **screen:** operator-visible degraded card data on the screen config page ([#465](https://github.com/KeeprDigital/stream-keepr/issues/465)) ([19b2b1a](https://github.com/KeeprDigital/stream-keepr/commit/19b2b1a2400c3ff4ae615effdd255cd2deb59b14))
* **screen:** presence update path for Screen Output self-reports ([#465](https://github.com/KeeprDigital/stream-keepr/issues/465)) ([ebb33f1](https://github.com/KeeprDigital/stream-keepr/commit/ebb33f1c11ebdbbc0be0a55027e1867079ad8813))
* **screens:** show the card-data health badge on every screens-index row ([ee38761](https://github.com/KeeprDigital/stream-keepr/commit/ee3876179c987c22e5bbf0ca7f8428511c7806f7))
* **shared:** BoardSelection enum; metagame board filter 'both' becomes 'full' ([#487](https://github.com/KeeprDigital/stream-keepr/issues/487)) ([eef842c](https://github.com/KeeprDigital/stream-keepr/commit/eef842c953f9728b78851ffbc877072206ff9c89))
* **talents:** manage social profiles ([#417](https://github.com/KeeprDigital/stream-keepr/issues/417)) ([d7416b5](https://github.com/KeeprDigital/stream-keepr/commit/d7416b53df190633bcdd6598248cb74557d94a38))


### Bug Fixes

* animate social updates to transparency ([2f4cbb8](https://github.com/KeeprDigital/stream-keepr/commit/2f4cbb86c23d9ace6e712a04dfee27d10d870db4))
* **animation-effects:** cap the ember halo inside its 3x3 gather ([#473](https://github.com/KeeprDigital/stream-keepr/issues/473)) ([8fa0b3f](https://github.com/KeeprDigital/stream-keepr/commit/8fa0b3fcc910e8dda6df287bb816273661ccdffa))
* **animation-effects:** close the spec review's three findings ([#473](https://github.com/KeeprDigital/stream-keepr/issues/473)) ([b4015bf](https://github.com/KeeprDigital/stream-keepr/commit/b4015bf30f43b81af6a4929719977cddeda9d816))
* **animation-effects:** dim the weave threads to ambient levels ([#473](https://github.com/KeeprDigital/stream-keepr/issues/473)) ([5975a0d](https://github.com/KeeprDigital/stream-keepr/commit/5975a0dafa514057a71525f0a307fce527cd6069))
* **animation-effects:** dots review follow-ups ([#473](https://github.com/KeeprDigital/stream-keepr/issues/473)) ([4c5be54](https://github.com/KeeprDigital/stream-keepr/commit/4c5be54ddd972bfa806498f2fdfebd3536323d7f))
* **animation-effects:** net review follow-ups ([#473](https://github.com/KeeprDigital/stream-keepr/issues/473)) ([4d253c6](https://github.com/KeeprDigital/stream-keepr/commit/4d253c6d2a3d047e6681b33cbd6ce1814cc7ed28))
* **animation-effects:** review follow-ups for the halo slice ([#473](https://github.com/KeeprDigital/stream-keepr/issues/473)) ([751c310](https://github.com/KeeprDigital/stream-keepr/commit/751c31095a4d44fd447a9995d94026e152069cca))
* **animation-effects:** review remediation for the first slice ([#473](https://github.com/KeeprDigital/stream-keepr/issues/473)) ([24b13bc](https://github.com/KeeprDigital/stream-keepr/commit/24b13bc9c2a04442103c3bb0f139ea91954f2c88))
* **animation-effects:** waves keeps the fork's background colour ([#473](https://github.com/KeeprDigital/stream-keepr/issues/473)) ([9538337](https://github.com/KeeprDigital/stream-keepr/commit/9538337c2cd0dad5afe53a8b83bb6ac698fe0946))
* **auth:** audit NODE_ENV-dependent library behaviour; state the client-IP header ([#438](https://github.com/KeeprDigital/stream-keepr/issues/438)) ([e11c02a](https://github.com/KeeprDigital/stream-keepr/commit/e11c02a684a1035d655ff8e396f9610152d7d84a))
* **auth:** close local bypass review gaps ([#456](https://github.com/KeeprDigital/stream-keepr/issues/456)) ([ff8f973](https://github.com/KeeprDigital/stream-keepr/commit/ff8f9739007af7d614cfccf1f1082ab19584d3ff))
* **auth:** correct a false claim the email normalization made about itself ([#394](https://github.com/KeeprDigital/stream-keepr/issues/394)) ([c7091ff](https://github.com/KeeprDigital/stream-keepr/commit/c7091ff21e8bb8da7c89ec4701b1d1139c0bc87f))
* **auth:** remediate [#393](https://github.com/KeeprDigital/stream-keepr/issues/393) review findings on the scrypt guard's spelling ([cb0c57d](https://github.com/KeeprDigital/stream-keepr/commit/cb0c57d1dc6a192872739270acecc08f4033fb74))
* **auth:** state the origin check and the hostnames it admits ([#410](https://github.com/KeeprDigital/stream-keepr/issues/410)) ([b816911](https://github.com/KeeprDigital/stream-keepr/commit/b8169115f75faaeaa1740e8f383a199df51ad57f))
* **background-screen:** let the asset picker's select own the source write ([#473](https://github.com/KeeprDigital/stream-keepr/issues/473)) ([5ab3604](https://github.com/KeeprDigital/stream-keepr/commit/5ab36047001f45ece2102269af6f265831411723))
* **background-screen:** rename the lease suite's non-graphics-mode screen ([#473](https://github.com/KeeprDigital/stream-keepr/issues/473)) ([d60f44c](https://github.com/KeeprDigital/stream-keepr/commit/d60f44c738c447fbe3f793baa03dbbd9ec5daf9b))
* **background-screen:** tolerate a stored background fragment with no layers key ([#473](https://github.com/KeeprDigital/stream-keepr/issues/473)) ([97e922c](https://github.com/KeeprDigital/stream-keepr/commit/97e922ce5d51a283b8cba769eeb211318e0791d2))
* **broadcast-decks:** close authority response races ([52e423c](https://github.com/KeeprDigital/stream-keepr/commit/52e423c4316e1c202eff5f06962d7e9757b3bff7))
* **broadcast-decks:** preserve authoritative state in races ([fb425c3](https://github.com/KeeprDigital/stream-keepr/commit/fb425c3bb636052232926b779e16639e232a48ea))
* **broadcast-decks:** restrict heading lookup keys ([#512](https://github.com/KeeprDigital/stream-keepr/issues/512)) ([13b6fe9](https://github.com/KeeprDigital/stream-keepr/commit/13b6fe9f16c4a01e9fd0a39d664a59f41300c471))
* **broadcast-decks:** tighten import contract ([#512](https://github.com/KeeprDigital/stream-keepr/issues/512)) ([3db7fbc](https://github.com/KeeprDigital/stream-keepr/commit/3db7fbc25ebaaa9f6994221b3b3d229f91f69c6e))
* **broadcast-graphics:** preserve manual profile authority ([3a42114](https://github.com/KeeprDigital/stream-keepr/commit/3a42114bb6343c86eaa7668a123057bca0c82d15))
* **broadcast:** harden editor lifecycle and form semantics ([#515](https://github.com/KeeprDigital/stream-keepr/issues/515)) ([7565c02](https://github.com/KeeprDigital/stream-keepr/commit/7565c02aa971996789d4ce36d8e33b2a11b28e36))
* **broadcast:** recover refused settings and stale deletes ([#515](https://github.com/KeeprDigital/stream-keepr/issues/515)) ([77c70c7](https://github.com/KeeprDigital/stream-keepr/commit/77c70c770562387184cc27b5d6a9230fcceb222c))
* **build:** let nuxt prepare run while the local-auth bypass is armed ([#504](https://github.com/KeeprDigital/stream-keepr/issues/504)) ([7ea61c7](https://github.com/KeeprDigital/stream-keepr/commit/7ea61c779119483b990aeae909e402defed3b8c8))
* **build:** stop resolving system fallback fonts against remote providers ([#405](https://github.com/KeeprDigital/stream-keepr/issues/405)) ([1252e0f](https://github.com/KeeprDigital/stream-keepr/commit/1252e0f9b98fc26f1fb1d44fb0ac3e303f3af96d))
* **card-screen:** report Scryfall degradation and re-fetch deck sources ([#471](https://github.com/KeeprDigital/stream-keepr/issues/471)) ([9bc9ee2](https://github.com/KeeprDigital/stream-keepr/commit/9bc9ee26ec80cfc3f60f031089df3c8d0e3cc407))
* **card:** accept full Scryfall set names in persisted cards ([e5d2018](https://github.com/KeeprDigital/stream-keepr/commit/e5d2018d5f9433757ebbd23326adcc213b7ee218))
* **card:** round the synchronized clock into card timeout timestamps ([500e730](https://github.com/KeeprDigital/stream-keepr/commit/500e7303e355245dc04327b53d86b53c9b457e58))
* close feature match note acceptance gaps ([#429](https://github.com/KeeprDigital/stream-keepr/issues/429)) ([9ad79fa](https://github.com/KeeprDigital/stream-keepr/commit/9ad79fae1ab62764af3a1891daadcfb0512f1b85))
* close social profile rotation review findings ([36c5796](https://github.com/KeeprDigital/stream-keepr/commit/36c579667ac6304d19d3b2806b9e88e3644e580f))
* **db:** name every insert-select expression by column ([#467](https://github.com/KeeprDigital/stream-keepr/issues/467)) ([9b8d9cc](https://github.com/KeeprDigital/stream-keepr/commit/9b8d9cc92b2f2decd39184759ab76a19c435c7be))
* **deck:** handle art and empty-board degradation ([#516](https://github.com/KeeprDigital/stream-keepr/issues/516)) ([b576cb6](https://github.com/KeeprDigital/stream-keepr/commit/b576cb6af6c7261b77e1e7c4a9e72c95461cc229))
* **deck:** preserve conflict semantics across preflight ([#514](https://github.com/KeeprDigital/stream-keepr/issues/514)) ([2728f6f](https://github.com/KeeprDigital/stream-keepr/commit/2728f6f1a44b11f8bbf4ddadbade2061ce24e28e))
* **deck:** recovery cadence survives failed re-fetches; changed decks swap in even degraded ([#465](https://github.com/KeeprDigital/stream-keepr/issues/465) review) ([474d406](https://github.com/KeeprDigital/stream-keepr/commit/474d4066e791df796a506a8072fc073dd8ecf5d5))
* **deck:** still-degraded re-fetch keeps program untouched instead of re-swapping placeholders ([#465](https://github.com/KeeprDigital/stream-keepr/issues/465)) ([cac398f](https://github.com/KeeprDigital/stream-keepr/commit/cac398f1c33560096e6ff4b7599a118b06d82ecf))
* **deck:** stop structuredClone-ing reactive deck list props in DeckListModal ([037f448](https://github.com/KeeprDigital/stream-keepr/commit/037f4485c50050fa6658cfe04767269797e2eee7))
* **deploy:** harden the deploy pipeline ([#461](https://github.com/KeeprDigital/stream-keepr/issues/461)) ([c77cc22](https://github.com/KeeprDigital/stream-keepr/commit/c77cc228e8d2c1fd38dc9995dc74fddd7f3ff59d))
* **dev:** reap orphaned workerd at every spawn point ([ff75d2c](https://github.com/KeeprDigital/stream-keepr/commit/ff75d2c689fa498d8348f92ccbf4d47ff68a35a0))
* **dev:** stop NuxtHub appending worktree .data paths to .gitignore ([#523](https://github.com/KeeprDigital/stream-keepr/issues/523)) ([145e002](https://github.com/KeeprDigital/stream-keepr/commit/145e00265297abe827780593be3b8fdfa46c2c20))
* **dev:** stop vue-tsc watch mode exhausting file descriptors on macOS ([0f1bb87](https://github.com/KeeprDigital/stream-keepr/commit/0f1bb878d9760b091a1c69492341ca25bcd7063a))
* **export:** keep the PNG export canvas origin-clean and wait for the renderer ([9df58e4](https://github.com/KeeprDigital/stream-keepr/commit/9df58e481107f71d25bea6f1506bac2c2e44b22f))
* **export:** match CSS url() forms without super-linear backtracking ([ee447e6](https://github.com/KeeprDigital/stream-keepr/commit/ee447e65ecf01343f839ac180a15528b5ac62aa6))
* **feature-match-overlay:** mask Frame content in CSS so composited layers stay clipped ([2dd3ed5](https://github.com/KeeprDigital/stream-keepr/commit/2dd3ed5a24f1321c569e5f69961a2367add56d3e))
* **feature-match:** batch updateState into one atomic command ([#463](https://github.com/KeeprDigital/stream-keepr/issues/463)) ([055ebe6](https://github.com/KeeprDigital/stream-keepr/commit/055ebe699bdd86189043aaa555b739d7f6434d3b))
* **feature-match:** close two slot write-integrity gaps ([#462](https://github.com/KeeprDigital/stream-keepr/issues/462)) ([75e59fe](https://github.com/KeeprDigital/stream-keepr/commit/75e59fea3b44b402d10f1fe259df650ac648ec4b))
* **feature-match:** guard reducer payload coercion and align clock input validation ([#464](https://github.com/KeeprDigital/stream-keepr/issues/464)) ([1a333ce](https://github.com/KeeprDigital/stream-keepr/commit/1a333ce67ead8fbb0a8565aea064a4c5f491f78b))
* **feature-match:** honest state-update seam and dialog review fixes ([#463](https://github.com/KeeprDigital/stream-keepr/issues/463) follow-up) ([c75cf0e](https://github.com/KeeprDigital/stream-keepr/commit/c75cf0e45b7992687fc06a520bf638a8d5530b71))
* **feature-match:** only reserve grid rows for counters when counters show ([b78c777](https://github.com/KeeprDigital/stream-keepr/commit/b78c7775e3b61836b538c4664eb11c26c7f8901a))
* **feature-match:** pin Batch sub-command schema to the batchable list ([#463](https://github.com/KeeprDigital/stream-keepr/issues/463)) ([66221d2](https://github.com/KeeprDigital/stream-keepr/commit/66221d218b691f35da2603ccac4b166ba0397ead))
* **feature-match:** review remediation — optional sideboardRevealed, no floating toggle promise ([#490](https://github.com/KeeprDigital/stream-keepr/issues/490)) ([2cadf33](https://github.com/KeeprDigital/stream-keepr/commit/2cadf33c74acc3b1fc667559cdc884a3b5e8ec7b))
* **feature-match:** sink a whole Batch when any sub-command is rejected ([#464](https://github.com/KeeprDigital/stream-keepr/issues/464) review) ([ca7b730](https://github.com/KeeprDigital/stream-keepr/commit/ca7b730a7177dd2588b15a27bf178aca3e68bd45))
* **graphics:** close four live session playout correctness gaps ([#459](https://github.com/KeeprDigital/stream-keepr/issues/459)) ([078be9d](https://github.com/KeeprDigital/stream-keepr/commit/078be9d88a2779aa0660b6ec9ed803fe93dfd20a))
* **graphics:** compare social presentation frames ([fef1250](https://github.com/KeeprDigital/stream-keepr/commit/fef125002f102bd06674030333b6111012605574))
* **graphics:** give Game Wins boxes pixel units so they are not collapsed ([f63b2f9](https://github.com/KeeprDigital/stream-keepr/commit/f63b2f9c37f5ae73405032c680beccd7fd4d8e4b))
* **graphics:** preserve social profile update frames ([538a680](https://github.com/KeeprDigital/stream-keepr/commit/538a680f0976e925d43accc1a5c01b744b1e61c8))
* **graphics:** retain child social update motion ([512d337](https://github.com/KeeprDigital/stream-keepr/commit/512d3370b4a191a58de917d2de6c353730c8fa47))
* **graphics:** retain manual profile on retake ([ecc01ce](https://github.com/KeeprDigital/stream-keepr/commit/ecc01ce225026674e3277116d7f997b529463b72))
* **graphics:** scope projected text references ([ed46e02](https://github.com/KeeprDigital/stream-keepr/commit/ed46e02fdadce0ef80b269c515d784f6dd340c45))
* harden Worker smoke isolation and cleanup ([#437](https://github.com/KeeprDigital/stream-keepr/issues/437)) ([a44bc86](https://github.com/KeeprDigital/stream-keepr/commit/a44bc866cbdffe8d7b009349b55dbd020259d0d5))
* **melee-sync:** align pagination with Melee's per-page RecordsFiltered and bypass its response cache ([cadb4c1](https://github.com/KeeprDigital/stream-keepr/commit/cadb4c19eedbfda2e0b99ac223e2dd655ae838ea))
* **melee-sync:** recognize PascalCase Melee game enum names ([1b4e01a](https://github.com/KeeprDigital/stream-keepr/commit/1b4e01a34dcfb5b2c3685147a98ffc3903e16849))
* **melee-sync:** treat a Melee 404 on a never-synced round as not ready ([05b8e53](https://github.com/KeeprDigital/stream-keepr/commit/05b8e53c14a8f3253f51a5b4fd92a2db9518ca8c))
* **melee:** read a keyring the environment handed over as destr parsed it ([6bcb182](https://github.com/KeeprDigital/stream-keepr/commit/6bcb1829146bfaad2e788a0f273ec22f84d8a5d9))
* **melee:** requeue changed deck lists ([2105a2e](https://github.com/KeeprDigital/stream-keepr/commit/2105a2e18b15989ecdaa4b387cbc04c19e1d636a))
* **melee:** tolerate the shapes Melee actually returns ([8f4635a](https://github.com/KeeprDigital/stream-keepr/commit/8f4635a7b00324c43a9e1d5fde18e53e251afc21))
* preserve social profile rejection messages ([e607158](https://github.com/KeeprDigital/stream-keepr/commit/e607158e8bc7bdbcc40c8ca9335fed0e2df72f5b))
* preserve social projection authoring invariants ([#421](https://github.com/KeeprDigital/stream-keepr/issues/421)) ([db66ad9](https://github.com/KeeprDigital/stream-keepr/commit/db66ad9d097fecf2f03a4ffe9f7f5fe21dc55997))
* preserve social transition composition ([410fe8d](https://github.com/KeeprDigital/stream-keepr/commit/410fe8d9eddbd97ead03f70d7f30391bb4c02077))
* **realtime:** coverage waits on first mint, closed state, dedupe dead code, connection-id validation ([#466](https://github.com/KeeprDigital/stream-keepr/issues/466)) ([0d41f34](https://github.com/KeeprDigital/stream-keepr/commit/0d41f34018a2c310a0eaac04c87379e85b9a9527))
* **realtime:** defer the first connect until an Event is known ([#474](https://github.com/KeeprDigital/stream-keepr/issues/474)) ([b0ee0dd](https://github.com/KeeprDigital/stream-keepr/commit/b0ee0dd249cf9b2f8ac601f248b65c4a3de890c9))
* **screen:** size Metagame rows from the rows container, not the whole table ([3bcf7db](https://github.com/KeeprDigital/stream-keepr/commit/3bcf7db0453e6812820628e7d7039010b7db9cc6))
* **screen:** size the animation surface once its effect finishes loading ([76cc6f7](https://github.com/KeeprDigital/stream-keepr/commit/76cc6f7802dd0f7734bdd9d7b855d7b9dd811620))
* **screen:** strip zod defaults when deriving mode-config PATCH schemas ([48d57cb](https://github.com/KeeprDigital/stream-keepr/commit/48d57cba88c31422ad45714658897072f2b43466))
* **talents:** close social profile review findings ([5dbd354](https://github.com/KeeprDigital/stream-keepr/commit/5dbd3548158318c2c98df0f786ecf2ff5e5298c2))


### Performance

* **verify:** parallel verify gates and leaner CI ([#524](https://github.com/KeeprDigital/stream-keepr/issues/524)) ([0f050d4](https://github.com/KeeprDigital/stream-keepr/commit/0f050d44dfa8aeb8018b9ef92c0e81196888e1c0))


### Refactoring

* **animation-effects:** globe review follow-ups ([#473](https://github.com/KeeprDigital/stream-keepr/issues/473)) ([43ac93a](https://github.com/KeeprDigital/stream-keepr/commit/43ac93a1e9070dc791fd8f8984be439646d63b46))
* **animation-effects:** one render plan for all three hosts, and a catalogue-coverage pin ([47b5d09](https://github.com/KeeprDigital/stream-keepr/commit/47b5d0979d476e3dd29cccdc31492becd6ff22d3))
* **animation-effects:** rings review follow-ups ([#473](https://github.com/KeeprDigital/stream-keepr/issues/473)) ([f0f85f1](https://github.com/KeeprDigital/stream-keepr/commit/f0f85f1293dfb83c0283f0dc5631d96ed9370330))
* **auth:** apply the two-axis review's findings ([#398](https://github.com/KeeprDigital/stream-keepr/issues/398)) ([e0ff3d5](https://github.com/KeeprDigital/stream-keepr/commit/e0ff3d57b7f1d75e299951a7d9631622476575d6))
* **auth:** make the local bypass one launcher-owned name ([#519](https://github.com/KeeprDigital/stream-keepr/issues/519)) ([6dad3fe](https://github.com/KeeprDigital/stream-keepr/commit/6dad3fe1c0cbf04d14cbf808c2a0234f1ad3db1c))
* **auth:** remediate [#394](https://github.com/KeeprDigital/stream-keepr/issues/394) review findings — one guard shape, roles as roles ([128ad07](https://github.com/KeeprDigital/stream-keepr/commit/128ad0770aec9bc65d0be17bf3418a313f53ffd5))
* **background-screen:** review follow-ups ([#473](https://github.com/KeeprDigital/stream-keepr/issues/473)) ([9fcd7db](https://github.com/KeeprDigital/stream-keepr/commit/9fcd7db81873202357fbe9c0e6ffdbdb8682a47f))
* **card-screen:** review follow-ups for [#471](https://github.com/KeeprDigital/stream-keepr/issues/471) ([18e38da](https://github.com/KeeprDigital/stream-keepr/commit/18e38daf3bd19c12673a1c2019cef28e3cdee583))
* **config:** collapse local configuration to one .env ([#412](https://github.com/KeeprDigital/stream-keepr/issues/412)) ([f6b5bb9](https://github.com/KeeprDigital/stream-keepr/commit/f6b5bb9cc594625dbaad66e693b5dedc55165d11))
* **db:** review follow-ups for selectForInsert ([#467](https://github.com/KeeprDigital/stream-keepr/issues/467)) ([06a23da](https://github.com/KeeprDigital/stream-keepr/commit/06a23daacad38b16b5a4c6f664630da6cb13a6f6))
* **deck-data:** extract the shared degraded-refetch lifecycle ([#472](https://github.com/KeeprDigital/stream-keepr/issues/472)) ([f805161](https://github.com/KeeprDigital/stream-keepr/commit/f80516195464070ffcda3cc231aae064d29b1d22))
* **deck-data:** review follow-ups for [#472](https://github.com/KeeprDigital/stream-keepr/issues/472) ([a012f42](https://github.com/KeeprDigital/stream-keepr/commit/a012f42fdb3552a8b0bfce4a4ede2d3af980ac63))
* **deck-screen:** review remediation — shared board resolver, beside widths, Guarded Sequence ([#488](https://github.com/KeeprDigital/stream-keepr/issues/488)) ([4167a59](https://github.com/KeeprDigital/stream-keepr/commit/4167a59efacff656c2eee0c12af44e3119024323))
* **fmo:** review remediation — Sideboards vocabulary, keep-on-error doc, test typing ([#491](https://github.com/KeeprDigital/stream-keepr/issues/491)) ([074c101](https://github.com/KeeprDigital/stream-keepr/commit/074c10124f6ff34b27c9a14d5e30562b0edbe7df))
* **graphics-assets:** use the shared randomUuid helper ([1cfbbad](https://github.com/KeeprDigital/stream-keepr/commit/1cfbbadfb729c889c20488dd31717ee31e33332d))
* **realtime:** single claimCoverage seat, settle helper, stale-check invariant comment ([#466](https://github.com/KeeprDigital/stream-keepr/issues/466) review) ([9354388](https://github.com/KeeprDigital/stream-keepr/commit/9354388db95cb2e80a4e9d6e0e923cb3d859591e))
* **test:** review remediation for the [#438](https://github.com/KeeprDigital/stream-keepr/issues/438) audit ([8ef458b](https://github.com/KeeprDigital/stream-keepr/commit/8ef458b1a6ed8935fd02b5115d91728a6a2228c4))


### Documentation

* **adr:** ADR-0010 — the locked authentication design ([6d18418](https://github.com/KeeprDigital/stream-keepr/commit/6d18418508d113b6ae26166317d2987f2b42f37a))
* **adr:** give ADR 0015 the ADR-0015 header prefix its filename claims ([#494](https://github.com/KeeprDigital/stream-keepr/issues/494)) ([af29adf](https://github.com/KeeprDigital/stream-keepr/commit/af29adff9168f8027251534ed98e2eeba5c9f86c))
* **adr:** record ADR-0010 — the locked authentication design ([#389](https://github.com/KeeprDigital/stream-keepr/issues/389)) ([a591202](https://github.com/KeeprDigital/stream-keepr/commit/a5912028d0f5f5b984579f3c3503a5023a839515))
* align animation acceptance testing table ([#499](https://github.com/KeeprDigital/stream-keepr/issues/499)) ([21b99be](https://github.com/KeeprDigital/stream-keepr/commit/21b99be38cb181b72cb67a51084c643206879615))
* **animation-effects:** cite the coverage pin by the title it actually carries ([9158308](https://github.com/KeeprDigital/stream-keepr/commit/91583085edba9a78a983debb8728e5caa4a26346))
* **animation-effects:** correct two claims the verification caught ([#499](https://github.com/KeeprDigital/stream-keepr/issues/499)) ([16f1033](https://github.com/KeeprDigital/stream-keepr/commit/16f10338c6fc8ca07db4bca846f5f011c422e746))
* **auth:** accept the two-runtime-var local bypass residual ([#460](https://github.com/KeeprDigital/stream-keepr/issues/460)) ([955740d](https://github.com/KeeprDigital/stream-keepr/commit/955740db07fa8a3c4250775bdf1330090f4c295c))
* **auth:** fix a false history sentence and a detached docblock ([#394](https://github.com/KeeprDigital/stream-keepr/issues/394)) ([73cf081](https://github.com/KeeprDigital/stream-keepr/commit/73cf0816afba576250eb840ebdfdf2590c832080))
* **auth:** give the deferred env-name promise a home on the ticket that inherits it ([#394](https://github.com/KeeprDigital/stream-keepr/issues/394)) ([9b404d0](https://github.com/KeeprDigital/stream-keepr/commit/9b404d00645acaf44ef40bb2c9986b013450bc37))
* **auth:** record dev:local:bypass as an accepted LAN exposure ([ed612d1](https://github.com/KeeprDigital/stream-keepr/commit/ed612d1a2fedd7d7ea66e86390476f44b55fa41f))
* **auth:** say that pre-creating authors makes them administrators ([#398](https://github.com/KeeprDigital/stream-keepr/issues/398)) ([1996a08](https://github.com/KeeprDigital/stream-keepr/commit/1996a080d287335df55a7fa804cabe36a83bcb28))
* **auth:** say what a blank-name account looks like at cutover verification ([#398](https://github.com/KeeprDigital/stream-keepr/issues/398)) ([51664b6](https://github.com/KeeprDigital/stream-keepr/commit/51664b6f2ffa64e6b266a6c893ac60603520d6fc))
* **auth:** say when the retired cookies are actually expired ([#398](https://github.com/KeeprDigital/stream-keepr/issues/398)) ([5c02db4](https://github.com/KeeprDigital/stream-keepr/commit/5c02db48205fced18fc3fb691010be007571e462))
* **background-screen:** record the Background Screen in the domain model ([#473](https://github.com/KeeprDigital/stream-keepr/issues/473)) ([4fc5adc](https://github.com/KeeprDigital/stream-keepr/commit/4fc5adcaee3911e47c4c637b828edac41b98f902))
* consolidate documentation into README, DECISIONS.md, CONTEXT.md, AGENTS.md ([#522](https://github.com/KeeprDigital/stream-keepr/issues/522)) ([7b8fd3c](https://github.com/KeeprDigital/stream-keepr/commit/7b8fd3c2e595e8fb4c5249623996c8016d3e2fd2))
* **coverage:** review follow-ups for [#469](https://github.com/KeeprDigital/stream-keepr/issues/469) ([5cd156b](https://github.com/KeeprDigital/stream-keepr/commit/5cd156bf732cd97abf7e7c1b69f7dcd6d07a9627))
* define broadcast deck list vocabulary ([14d2fce](https://github.com/KeeprDigital/stream-keepr/commit/14d2fce14ac6447497f815ba3f5c58eb1fa1d05e))
* **domain:** record Animation Effect concept and rebuild decision ([#473](https://github.com/KeeprDigital/stream-keepr/issues/473)) ([4924a44](https://github.com/KeeprDigital/stream-keepr/commit/4924a446a316e22e70de23ba30381d8c0395b927))
* **graphics:** review polish — Deck List Item vocabulary, named card-text floor ([#489](https://github.com/KeeprDigital/stream-keepr/issues/489)) ([5b266ff](https://github.com/KeeprDigital/stream-keepr/commit/5b266ff7b1bad9668dcb6aac3aae05b520fa6773))
* land sideboard-display glossary and ADR 0015 ([#486](https://github.com/KeeprDigital/stream-keepr/issues/486)) ([b4331de](https://github.com/KeeprDigital/stream-keepr/commit/b4331decb70054818a293dc38c00fa5273a6b681))
* **research:** land the two auth assessments ADR-0010 cites but main does not have ([#414](https://github.com/KeeprDigital/stream-keepr/issues/414)) ([59b304b](https://github.com/KeeprDigital/stream-keepr/commit/59b304b7436cb6ec8e3624eb964fad5b14fb4e77))
* settle Feature Match Note ownership ([#429](https://github.com/KeeprDigital/stream-keepr/issues/429)) ([c4c0db6](https://github.com/KeeprDigital/stream-keepr/commit/c4c0db6637904322883aba35f4d46e1923c2257d))

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
