/**
 * Still-image ingestion acceptance: JPEG and WebP publish on the runtime
 * under test (#302).
 *
 * The codec Wasm used to be compiled from bytes at runtime, which Node allows
 * and deployed Workers refuse — so every local flow was green while deployed
 * JPEG/WebP ingestion failed, and the failure surfaced as a rejected
 * operation (`incomplete-jpeg-frame`) because the decode throw is
 * indistinguishable from an undecodable image at the validation boundary.
 * This harness PUTs one marked fixture per format through the ordinary
 * ingestion routes and demands each publishes with the facts the validator
 * derives by actually decoding it.
 *
 * PNG runs first as the discriminator: it is the one still-image path that
 * never touches Wasm, so `still-image-ingestion-refused` on JPEG or WebP
 * beside a publishing PNG is the codec runtime failing — not ingestion, not
 * provisioning, not the harness.
 *
 * Usage: node scripts/run-still-image-ingestion-acceptance.mjs [--deployed]
 *
 * Local runs default to `http://127.0.0.1:8787` (`pnpm preview`), where
 * workerd enforces the same no-runtime-compilation rule as production;
 * deployed runs take the installation from `STREAM_KEEPR_BROWSER_ACCEPTANCE_URL`.
 * No local configuration gate: ingestion needs an author session the
 * installation mints itself, never a locally supplied secret.
 */

import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { checkStillImagePublication } from './graphics-acceptance/assertions.mjs';
import { runAcceptanceHarness } from './graphics-acceptance/harness.mjs';
import {
	acceptanceOrigin,
	distinctPixelJpeg,
	distinctPixelPng,
	distinctPixelWebp,
	openInstallation,
	registerSessionSecrets,
	stageStillImagePublication,
} from './graphics-acceptance/installation.mjs';

const HARNESS = 'still-image-ingestion-v1';

const FORMATS = [
	{
		format: 'png',
		sourceFileName: 'acceptance-still.png',
		declaredMime: 'image/png',
		bytesFor: distinctPixelPng,
	},
	{
		format: 'jpeg',
		sourceFileName: 'acceptance-still.jpg',
		declaredMime: 'image/jpeg',
		bytesFor: distinctPixelJpeg,
	},
	{
		format: 'webp',
		sourceFileName: 'acceptance-still.webp',
		declaredMime: 'image/webp',
		bytesFor: distinctPixelWebp,
	},
];

export async function main(argv = process.argv) {
	const deployed = argv.includes('--deployed');

	await runAcceptanceHarness({
		harness: HARNESS,
		async run({ evidence, record }) {
			const session = await openInstallation(acceptanceOrigin({ deployed }), { deployed });
			registerSessionSecrets(evidence, session);
			const marker = randomUUID();
			const staged = [];
			try {
				for (const { format, sourceFileName, declaredMime, bytesFor } of FORMATS) {
					const bytes = bytesFor(`${marker}-${format}`);
					const publication = await stageStillImagePublication(session, {
						name: `Staging acceptance ${format} ${marker.slice(0, 8)}`,
						sourceFileName,
						declaredMime,
						bytes,
					});
					staged.push(publication);
					record(checkStillImagePublication(publication.settled, {
						format,
						byteLength: bytes.byteLength,
					}));
				}
			}
			finally {
				for (const publication of staged)
					await publication.dispose();
			}
			return {
				mode: deployed ? 'deployed' : 'local',
				formats: FORMATS.map(({ format }) => format).join(','),
			};
		},
	});
}

if (import.meta.main)
	await main();
