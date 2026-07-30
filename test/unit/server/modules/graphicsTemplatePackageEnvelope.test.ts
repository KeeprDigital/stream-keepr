import type { ResolvedPackagedRevision } from '~~/server/modules/graphics-asset-library/template-package';
import type { GraphicAssetId, GraphicAssetRevisionId } from '~~/shared/types/graphicsAsset';
import { Buffer } from 'node:buffer';
import { crc32 as nodeCrc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { readableBytes } from '~~/server/modules/graphics-asset-library/object-store';
import { planTemplatePackage } from '~~/server/modules/graphics-asset-library/template-package';
import {
	crc32,
	createStoredZipArchive,
	storedZipArchiveByteLength,
	StoredZipArchiveError,
} from '~~/server/modules/graphics-asset-library/zip-archive';
import { TEMPLATE_PACKAGE_LIMITS } from '~~/shared/types/templatePackage';
import { collectStream, readStoredZipArchive } from '../../../helpers/storedZipArchive';

/**
 * The envelope-measurement seam. Export refuses a package before writing a byte,
 * which means the archive length has to be exact and the settled gibibyte limits
 * have to be checkable without ever materialising a gibibyte.
 */

function packagedRevision(
	index: number,
	byteLength: number,
	digest = String(index).padStart(64, '0'),
): ResolvedPackagedRevision {
	return {
		reference: {
			assetId: `asset-${index}` as GraphicAssetId,
			revisionId: `revision-${index}` as GraphicAssetRevisionId,
		},
		name: `Asset ${index}`,
		kind: 'image',
		revisionNumber: 1,
		digest,
		byteLength,
		canonicalMime: 'image/png',
		facts: {
			kind: 'image',
			format: 'png',
			canonicalMime: 'image/png',
			byteLength,
			sha256: digest,
			width: 1,
			height: 1,
			pixelCount: 1,
			frameCount: 1,
			bitDepth: 8,
			colorSpace: 'srgb',
			colorModel: 'rgba',
			hasAlpha: true,
			orientation: 'normal',
		},
		compatibilityProfile: 'still-image-v1',
		requiredBy: [`items[${index}].asset`],
	};
}

function plan(revisions: readonly ResolvedPackagedRevision[]) {
	return planTemplatePackage({
		packageKind: 'sklayout',
		template: { identity: 'template', name: 'Envelope', document: {} },
		revisions,
		capabilities: [],
		createdAt: '2026-07-30T09:00:00.000Z',
		archiveByteLength: storedZipArchiveByteLength,
	});
}

describe('the stored-ZIP archive Template Packages are written as', () => {
	it('agrees with node:zlib on CRC-32', () => {
		for (const sample of ['', '123456789', 'the quick brown fox', 'multi-byte: \u00FF\u00FE']) {
			const bytes = new Uint8Array(Buffer.from(sample, 'utf8'));
			expect(crc32(bytes)).toBe(nodeCrc32(Buffer.from(bytes)));
		}
		// The published CRC-32 check value for "123456789".
		expect(crc32(new Uint8Array(Buffer.from('123456789')))).toBe(0xCBF43926);
	});

	it('predicts its own exact length before streaming', async () => {
		const entries = [
			{ name: 'manifest.json', bytes: new Uint8Array(Buffer.from('{"a":1}')) },
			{ name: 'template.json', bytes: new Uint8Array(Buffer.from('{}')) },
			{ name: 'content/sha256-aa.bin', bytes: new Uint8Array(512).fill(7) },
		];
		const sources = entries.map(entry => ({
			name: entry.name,
			byteLength: entry.bytes.byteLength,
			open: async () => readableBytes(entry.bytes),
		}));

		const predicted = storedZipArchiveByteLength(sources);
		const archive = await collectStream(createStoredZipArchive(sources));

		// 30-byte local header + name + data + 16-byte data descriptor per entry,
		// then a 46-byte central header + name per entry, then a 22-byte end record.
		const expected = entries.reduce(
			(total, entry) => total + 30 + entry.name.length + entry.bytes.byteLength + 16 + 46 + entry.name.length,
			22,
		);
		expect(predicted).toBe(expected);
		expect(archive.byteLength).toBe(predicted);

		const parsed = readStoredZipArchive(archive);
		expect(parsed.entryNames).toEqual(entries.map(entry => entry.name));
		for (const entry of entries)
			expect(parsed.entry(entry.name).bytes).toEqual(entry.bytes);
	});

	it('refuses an unsafe or colliding entry name', () => {
		const source = (name: string) => ({
			name,
			byteLength: 0,
			open: async () => readableBytes(new Uint8Array()),
		});
		for (const name of ['../escape.json', '/absolute.json', 'a\\b.json', 'a/../b.json', 'control\u0000.json', '']) {
			expect(() => createStoredZipArchive([source(name)]))
				.toThrow(StoredZipArchiveError);
		}
		expect(() => createStoredZipArchive([source('Manifest.json'), source('manifest.json')]))
			.toThrow(StoredZipArchiveError);
	});

	it('errors the stream rather than truncating when an entry produces the wrong byte count', async () => {
		const stream = createStoredZipArchive([{
			name: 'content/sha256-aa.bin',
			byteLength: 64,
			open: async () => readableBytes(new Uint8Array(8)),
		}]);
		await expect(collectStream(stream)).rejects.toThrow(StoredZipArchiveError);
	});
});

describe('template Package envelope limits', () => {
	it('accepts a package at the settled entry and revision ceilings', () => {
		const revisions = Array.from(
			{ length: TEMPLATE_PACKAGE_LIMITS.maximumPackagedRevisionCount },
			(_value, index) => packagedRevision(index, 1024),
		);
		const result = plan(revisions);

		expect(result.issues).toEqual([]);
		expect(result.totals.packagedRevisionCount).toBe(100);
		expect(result.totals.uniqueContentCount).toBe(100);
		expect(result.totals.entryCount).toBe(102);
	});

	it('reports the manifest expanded size it is itself part of', () => {
		const result = plan([packagedRevision(0, 4096)]);

		expect(result.manifest.totals.expandedByteLength).toBe(result.totals.expandedByteLength);
		expect(result.totals.expandedByteLength).toBe(
			result.manifestBytes.byteLength + result.templateBytes.byteLength + 4096,
		);
	});

	it('blocks a package that would carry more than 128 archive entries', () => {
		// 127 unique digests plus the manifest and template entries.
		const revisions = Array.from(
			{ length: 127 },
			(_value, index) => packagedRevision(index, 16),
		);
		const result = plan(revisions);

		expect(result.totals.entryCount).toBe(129);
		expect(result.issues.map(issue => issue.code)).toEqual(
			expect.arrayContaining(['package-entry-limit-exceeded']),
		);
	});

	it('blocks a package that would expand beyond one gibibyte', () => {
		const result = plan([packagedRevision(0, TEMPLATE_PACKAGE_LIMITS.maximumExpandedByteLength)]);

		expect(result.issues.map(issue => issue.code)).toEqual(
			expect.arrayContaining(['package-expanded-limit-exceeded', 'package-archive-limit-exceeded']),
		);
		expect(result.totals.archiveByteLength)
			.toBeGreaterThan(TEMPLATE_PACKAGE_LIMITS.maximumArchiveByteLength);
	});

	it('counts shared bytes once while keeping every packaged identity', () => {
		const shared = 'a'.repeat(64);
		const result = plan([
			packagedRevision(0, 2048, shared),
			packagedRevision(1, 2048, shared),
		]);

		expect(result.totals.packagedRevisionCount).toBe(2);
		expect(result.totals.uniqueContentCount).toBe(1);
		expect(result.totals.entryCount).toBe(3);
		expect(result.manifest.packagedAssets).toHaveLength(2);
		expect(result.totals.expandedByteLength).toBe(
			result.manifestBytes.byteLength + result.templateBytes.byteLength + 2048,
		);
	});
});
