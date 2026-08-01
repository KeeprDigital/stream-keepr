import type { GraphicsIngestionOperation } from '~~/shared/types/graphicsAsset';
import type {
	TemplatePackageExportReport,
	TemplatePackageManifest,
} from '~~/shared/types/templatePackage';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { $fetch, fetch } from '@nuxt/test-utils/e2e';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '../../shared/types/screenConfig';
import { collectStream, readStoredZipArchive } from '../helpers/storedZipArchive';
import { createGraphicsAuthorSessionCookie } from './graphicsAuthorSession';
import { executeIntegrationD1 } from './integrationD1';

const basePixelPng = Uint8Array.from(Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
	'base64',
));
/** Appends a valid ancillary text chunk so this suite owns a distinct digest. */
function pngWithTextChunk(source: Uint8Array, keyword: string): Uint8Array {
	const payload = Buffer.concat([Buffer.from('tEXt'), Buffer.from(`${keyword}\0`)]);
	const length = Buffer.alloc(4);
	length.writeUInt32BE(payload.byteLength - 4, 0);
	const checksum = Buffer.alloc(4);
	checksum.writeUInt32BE(crc32(payload), 0);
	return Uint8Array.from(Buffer.concat([
		Buffer.from(source.slice(0, -12)),
		length,
		payload,
		checksum,
		Buffer.from(source.slice(-12)),
	]));
}

const packagePixelPng = pngWithTextChunk(basePixelPng, 'sk-template-package-export');

function digestOf(bytes: Uint8Array) {
	return createHash('sha256').update(bytes).digest('hex');
}

describe('template Package export through the API boundary', () => {
	let eventId: number;
	let screenId: number;
	let operation: GraphicsIngestionOperation;
	let graphicsAuthorCookie: string;

	beforeAll(async () => {
		graphicsAuthorCookie = await createGraphicsAuthorSessionCookie();
		const created = await $fetch('/api/events', {
			method: 'POST',
			body: {
				name: 'Template Package Export Event',
				game: 'mtg',
				featureMatchOrientation: 'horizontal',
			},
		});
		eventId = created.id;
		const screen = await $fetch(`/api/events/${eventId}/screens`, {
			method: 'POST',
			body: {
				name: 'Exportable Overlay',
				slug: 'exportable-overlay',
				currentMode: 'feature-match-overlay',
			},
		});
		screenId = screen.id;
		const initiated = await $fetch<GraphicsIngestionOperation>('/api/graphics-assets/ingestion-operations', {
			method: 'POST',
			body: {
				idempotencyKey: 'template-package-export-logo',
				name: 'Packaged sponsor logo',
				defaultEventId: eventId,
				browserDecodeEvidence: {
					outcome: 'decoded',
					sourceDigest: digestOf(packagePixelPng),
					width: 1,
					height: 1,
				},
				declaredByteLength: packagePixelPng.byteLength,
			},
		});
		const response = await fetch(
			`/api/graphics-assets/ingestion-operations/${initiated.id}/content`,
			{ method: 'PUT', body: packagePixelPng },
		);
		operation = await response.json() as GraphicsIngestionOperation;
	});

	afterAll(async () => {
		try {
			await $fetch(`/api/events/${eventId}`, { method: 'DELETE' });
		}
		catch {}
	});

	it('streams a .sklayout package embedding the exact referenced revision', async () => {
		const reference = {
			assetId: operation.result!.assetId,
			revisionId: operation.result!.revisionId,
		};
		const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
		config.layout.frame.backgroundImage = reference;
		// The preset's Text Graphic Items already name an application font, so one
		// package proves both halves of the rule: declared capability, embedded asset.
		await $fetch(
			`/api/events/${eventId}/screens/${screenId}/config/feature-match-overlay`,
			{ method: 'PATCH', body: { layout: config.layout } },
		);

		const response = await fetch(
			`/api/events/${eventId}/screens/${screenId}/template-packages/feature-match-layout`,
			{ headers: { cookie: graphicsAuthorCookie } },
		);

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type'))
			.toBe('application/vnd.streamkeepr.feature-match-layout-template+zip');
		expect(response.headers.get('content-disposition'))
			.toBe('attachment; filename="exportable-overlay.sklayout"');
		expect(response.headers.get('cache-control')).toBe('no-store');

		const bytes = await collectStream(response.body!);
		// The declared length is settled before streaming, so it must be exact.
		expect(Number(response.headers.get('content-length'))).toBe(bytes.byteLength);

		const archive = readStoredZipArchive(bytes);
		const manifest = archive.json<TemplatePackageManifest>('manifest.json');
		expect(manifest.packageKind).toBe('sklayout');
		expect(manifest.templateKind).toBe('feature-match-layout-template');
		expect(manifest.packagedAssets).toHaveLength(1);
		const packaged = manifest.packagedAssets[0]!;
		expect(packaged.origin).toMatchObject({
			sourceAssetId: reference.assetId,
			sourceRevisionId: reference.revisionId,
			sourceRevisionNumber: 1,
			digest: digestOf(packagePixelPng),
		});
		expect(packaged.requiredBy).toEqual(['frame.backgroundImage']);
		expect(archive.entry(packaged.content.entry).bytes).toEqual(packagePixelPng);

		// The package carries exactly one Template plus only its assets.
		expect(archive.entryNames.sort()).toEqual([
			'content/sha256-'.concat(digestOf(packagePixelPng), '.bin'),
			'manifest.json',
			'template.json',
		].sort());
		const template = archive.json<{ frame: { backgroundImage: unknown }; sources: unknown[]; composition: { items: unknown[] } }>('template.json');
		expect(template.frame.backgroundImage).toEqual(reference);
		// A Template is not Screen live state: no Feature Match assignment travels.
		expect(archive.text('template.json')).not.toContain('featureMatchId');
		// Application-owned typography is declared, never duplicated as bytes.
		expect(manifest.applicationCapabilities).toEqual(expect.arrayContaining([
			expect.objectContaining({
				capability: 'application-font',
				identity: 'inter',
			}),
			expect.objectContaining({ capability: 'graphic-item-definition', identity: 'source' }),
			expect.objectContaining({ capability: 'graphic-item-definition', identity: 'group' }),
			expect.objectContaining({ capability: 'graphic-item-definition', identity: 'text' }),
		]));
	});

	it('blocks export with one complete report when a referenced revision is gone', async () => {
		// The Screen write boundary refuses a dangling reference, so a stored
		// configuration is planted directly to prove export also fails closed
		// rather than trusting whatever the catalogue already holds.
		const danglingScreen = await $fetch(`/api/events/${eventId}/screens`, {
			method: 'POST',
			body: {
				name: 'Dangling Overlay',
				slug: 'dangling-overlay',
				currentMode: 'feature-match-overlay',
			},
		});
		const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
		config.layout.frame.backgroundImage = {
			assetId: operation.result!.assetId,
			revisionId: 'revision-that-never-existed',
		} as never;
		await executeIntegrationD1(`
			UPDATE screens
			SET mode_configs = '${JSON.stringify({ 'feature-match-overlay': config }).replaceAll('\'', '\'\'')}'
			WHERE id = ${danglingScreen.id}
		`);

		const response = await fetch(
			`/api/events/${eventId}/screens/${danglingScreen.id}/template-packages/feature-match-layout`,
			{ headers: { cookie: graphicsAuthorCookie } },
		);

		expect(response.status).toBe(409);
		const body = await response.json() as { data: TemplatePackageExportReport };
		expect(body.data.issues).toEqual([
			expect.objectContaining({
				code: 'missing-graphic-asset-reference',
				slot: 'frame.backgroundImage',
				retryable: false,
				remediation: expect.any(String),
			}),
		]);
		expect(body.data.limits.maximumPackagedRevisionCount).toBe(100);
	});

	it('streams a .skgraphic package declaring application capabilities without duplicating them', async () => {
		const graphicsScreen = await $fetch(`/api/events/${eventId}/screens`, {
			method: 'POST',
			body: {
				name: 'Exportable Graphics',
				slug: 'exportable-graphics',
				currentMode: 'broadcast-graphics',
			},
		});
		const authored = await $fetch(
			`/api/events/${eventId}/screens/${graphicsScreen.id}/config/broadcast-graphics`,
			{
				method: 'PATCH',
				body: {
					graphics: [{
						id: 'lower-third',
						name: 'Lower third',
						items: [{
							id: 'headline',
							type: 'text',
							label: 'Headline',
							visible: true,
							anchor: 'top-left',
							x: 100,
							y: 900,
							width: 800,
							height: 120,
							text: 'Semifinal',
							overflowPolicy: 'ellipsis',
							minFontSize: 24,
							typography: {
								font: { kind: 'application', fontId: 'inter' },
								fontSize: 64,
								fontWeight: 700,
								fontStyle: 'normal',
								textTransform: 'none',
								letterSpacing: 0,
								lineHeight: 1.15,
								textAlign: 'left',
								color: '#ffffff',
							},
						}],
					}],
				},
			},
		);
		expect(authored.modeConfigs['broadcast-graphics'].graphics).toHaveLength(1);

		const response = await fetch(
			`/api/events/${eventId}/screens/${graphicsScreen.id}/template-packages/broadcast-graphic/lower-third`,
			{ headers: { cookie: graphicsAuthorCookie } },
		);

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type'))
			.toBe('application/vnd.streamkeepr.broadcast-graphic-template+zip');
		expect(response.headers.get('content-disposition'))
			.toBe('attachment; filename="lower-third.skgraphic"');

		const archive = readStoredZipArchive(await collectStream(response.body!));
		const manifest = archive.json<TemplatePackageManifest>('manifest.json');
		expect(manifest.packageKind).toBe('skgraphic');
		expect(manifest.templateKind).toBe('broadcast-graphic-template');
		expect(manifest.template).toMatchObject({ identity: 'lower-third', name: 'Lower third' });
		// No user-supplied asset is required, so no content entry exists at all.
		expect(manifest.packagedAssets).toEqual([]);
		expect(archive.entryNames.sort()).toEqual(['manifest.json', 'template.json']);
		expect(manifest.applicationCapabilities).toEqual(expect.arrayContaining([
			expect.objectContaining({ capability: 'application-font', identity: 'inter' }),
			expect.objectContaining({ capability: 'graphic-item-definition', identity: 'text' }),
		]));
		// The package carries one Broadcast Graphic, not the Screen's whole stack.
		const template = archive.json<{ id: string; items: unknown[] }>('template.json');
		expect(template.id).toBe('lower-third');
		expect(template.items).toHaveLength(1);
	});

	it('returns 404 for a Broadcast Graphic that is not on the Screen', async () => {
		const response = await fetch(
			`/api/events/${eventId}/screens/${screenId}/template-packages/broadcast-graphic/not-authored`,
			{ headers: { cookie: graphicsAuthorCookie } },
		);
		expect(response.status).toBe(404);
	});
});
