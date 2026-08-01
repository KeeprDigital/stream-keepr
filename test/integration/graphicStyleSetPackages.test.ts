import type {
	GraphicStyleSetEntry,
	GraphicStyleSetResponse,
} from '~~/shared/types/graphicStyleSet';
import type { GraphicStyleSetPackagePreflightReport } from '~~/shared/types/graphicStyleSetPackage';
import { randomUUID } from 'node:crypto';
import { fetch } from '@nuxt/test-utils/e2e';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	GRAPHIC_STYLE_SET_PACKAGE_MANIFEST_ENTRY,
	GRAPHIC_STYLE_SET_PACKAGE_MEDIA_TYPE,
	GRAPHIC_STYLE_SET_PACKAGE_STYLE_SET_ENTRY,
} from '../../shared/types/graphicStyleSetPackage';
import { collectStream, readStoredZipArchive } from '../helpers/storedZipArchive';
import { createGraphicsAuthorSessionCookie } from './graphicsAuthorSession';

/**
 * A show's style travelling as a `.skstyle` package, through the real API.
 *
 * The behaviour under test is the operator-visible contract of a portable style: what
 * leaves an installation is the published revision frozen whole, what arrives keeps the
 * identity and revision it left with, an import of something already installed does
 * nothing at all, an older revision never comes back over a newer one, and a package
 * can always be taken as an independent copy instead.
 *
 * Everything goes through the routes: the Style Set is authored and published through
 * its own API, exported as bytes, and fed back in as bytes. Nothing here inspects
 * storage.
 */

const runId = randomUUID();
const BRAND = `brand-${runId}`;
const HEADING = `heading-${runId}`;

function draft(fontSize = 64): GraphicStyleSetEntry[] {
	return [
		{ id: BRAND, kind: 'palette', name: 'Brand', schemaVersion: 1, value: { color: '#ff0044' } },
		{
			id: HEADING,
			kind: 'typography',
			name: 'Heading',
			schemaVersion: 1,
			value: {
				font: { kind: 'application', fontId: 'inter' },
				fontSize,
				fontWeight: 800,
				fontStyle: 'normal',
				textTransform: 'uppercase',
				letterSpacing: 2,
				lineHeight: 1,
				colorEntryId: BRAND,
			},
		},
	];
}

const STYLE_SETS = '/api/graphics-style-sets';
const PACKAGES = '/api/graphics-style-sets/packages';

async function request(
	path: string,
	options: { method?: string; body?: unknown; cookie?: string } = {},
): Promise<{ status: number; data: any }> {
	const headers: Record<string, string> = {};
	if (options.cookie)
		headers.cookie = options.cookie;
	if (options.body !== undefined)
		headers['content-type'] = 'application/json';

	const response = await fetch(path, {
		method: options.method ?? 'GET',
		headers,
		body: options.body === undefined ? undefined : JSON.stringify(options.body),
	});
	const text = await response.text();
	return { status: response.status, data: text ? JSON.parse(text) : null };
}

describe('graphic Style Set Packages', () => {
	let authorCookie: string;
	let styleSetId: string;
	/** The archive exported at revision one, kept so later imports can offer it back. */
	let revisionOnePackage: Uint8Array;
	let revisionTwoPackage: Uint8Array;

	async function styleSet(id = styleSetId): Promise<GraphicStyleSetResponse> {
		const current = await request(`${STYLE_SETS}/${id}`, { cookie: authorCookie });
		return current.data as GraphicStyleSetResponse;
	}

	async function saveDraft(entries: GraphicStyleSetEntry[]) {
		const current = await styleSet();
		return await request(`${STYLE_SETS}/${styleSetId}`, {
			method: 'PATCH',
			cookie: authorCookie,
			body: { draft: entries, draftRevision: current.draftRevision },
		});
	}

	async function publish() {
		const current = await styleSet();
		return await request(`${STYLE_SETS}/${styleSetId}/publish`, {
			method: 'POST',
			cookie: authorCookie,
			body: { draftRevision: current.draftRevision },
		});
	}

	async function exportPackage(id = styleSetId) {
		return await fetch(`${STYLE_SETS}/${id}/package`, { headers: { cookie: authorCookie } });
	}

	async function sendPackage(
		path: string,
		archive: Uint8Array,
	): Promise<{ status: number; data: any }> {
		const response = await fetch(path, {
			method: 'POST',
			headers: {
				'cookie': authorCookie,
				'content-type': GRAPHIC_STYLE_SET_PACKAGE_MEDIA_TYPE,
			},
			body: archive,
		});
		const text = await response.text();
		return { status: response.status, data: text ? JSON.parse(text) : null };
	}

	async function remove(id: string) {
		const current = await styleSet(id);
		return await request(`${STYLE_SETS}/${id}`, {
			method: 'DELETE',
			cookie: authorCookie,
			body: { draftRevision: current.draftRevision },
		});
	}

	beforeAll(async () => {
		authorCookie = await createGraphicsAuthorSessionCookie();
		const created = await request(STYLE_SETS, {
			method: 'POST',
			cookie: authorCookie,
			body: { name: `Show style ${runId}`, description: 'The 2026 season look' },
		});
		styleSetId = (created.data as GraphicStyleSetResponse).id;
	});

	afterAll(async () => {
		for (const id of [styleSetId]) {
			try {
				await remove(id);
			}
			catch {}
		}
	});

	it('refuses to export a Graphic Style Set that has never been published', async () => {
		const response = await exportPackage();

		expect(response.status).toBe(409);
		const body = await response.json() as { data: { issues: { code: string }[] } };
		expect(body.data.issues).toMatchObject([{ code: 'graphic-style-set-never-published' }]);
	});

	it('exports the published revision as a `.skstyle` archive of exactly two documents', async () => {
		await saveDraft(draft());
		expect((await publish()).status).toBe(200);

		const response = await exportPackage();
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe(GRAPHIC_STYLE_SET_PACKAGE_MEDIA_TYPE);
		expect(response.headers.get('content-disposition'))
			.toBe(`attachment; filename="show-style-${runId}.skstyle"`);
		expect(response.headers.get('cache-control')).toBe('no-store');

		revisionOnePackage = await collectStream(response.body!);
		// The declared length is settled before streaming, so it must be exact.
		expect(Number(response.headers.get('content-length'))).toBe(revisionOnePackage.byteLength);

		const archive = readStoredZipArchive(revisionOnePackage);
		expect(archive.entryNames).toEqual([
			GRAPHIC_STYLE_SET_PACKAGE_MANIFEST_ENTRY,
			GRAPHIC_STYLE_SET_PACKAGE_STYLE_SET_ENTRY,
		]);
		expect(archive.json(GRAPHIC_STYLE_SET_PACKAGE_MANIFEST_ENTRY)).toMatchObject({
			packageKind: 'skstyle',
			artifactKind: 'graphic-style-set',
			styleSet: { identity: styleSetId, revision: 1, entryCount: 2 },
			applicationCapabilities: [{ capability: 'application-font', identity: 'inter' }],
		});
		expect(archive.json(GRAPHIC_STYLE_SET_PACKAGE_STYLE_SET_ENTRY)).toMatchObject({
			id: styleSetId,
			revision: 1,
			entries: draft(),
		});
	});

	it('recognises a package of what is already installed and writes nothing', async () => {
		const before = await styleSet();

		const preflight = await sendPackage(`${PACKAGES}/preflight`, revisionOnePackage);
		expect(preflight.status).toBe(200);
		const report = preflight.data as GraphicStyleSetPackagePreflightReport;
		expect(report.disposition).toBe('already-installed');
		expect(report.outcome).toBe('ready');
		expect(report.provenance).toMatchObject({ sourceStyleSetId: styleSetId, sourceRevision: 1 });

		const installed = await sendPackage(PACKAGES, revisionOnePackage);
		expect(installed.status).toBe(200);
		expect(installed.data.report.disposition).toBe('already-installed');

		const after = await styleSet();
		expect(after.revision).toBe(before.revision);
		expect(after.draftRevision).toBe(before.draftRevision);
	});

	it('never brings an older revision back over a newer installed one', async () => {
		await saveDraft(draft(96));
		expect((await publish()).status).toBe(200);
		revisionTwoPackage = await collectStream((await exportPackage()).body!);

		const refused = await sendPackage(PACKAGES, revisionOnePackage);

		expect(refused.status).toBe(422);
		expect(refused.data.data.report.issues)
			.toMatchObject([{ code: 'graphic-style-set-revision-superseded', severity: 'error' }]);
		expect((await styleSet()).revision).toBe(2);
	});

	it('installs a package as an independent copy under a new identity when asked', async () => {
		const preflight = await sendPackage(
			`${PACKAGES}/preflight?resolution=independent-copy`,
			revisionOnePackage,
		);
		const report = preflight.data as GraphicStyleSetPackagePreflightReport;
		expect(report.disposition).toBe('install-independent-copy');
		expect(report.outcome).toBe('requires-confirmation');

		const installed = await sendPackage(
			`${PACKAGES}?resolution=independent-copy&fingerprint=${report.fingerprint}`,
			revisionOnePackage,
		);

		expect(installed.status).toBe(201);
		const copy = installed.data.styleSet as GraphicStyleSetResponse;
		expect(copy.id).not.toBe(styleSetId);
		// A copy is the first published revision of something that did not exist a moment
		// ago, so it claims none of the packaged revision's history.
		expect(copy.revision).toBe(1);
		expect(copy.published).toMatchObject(draft());

		await remove(copy.id);
	});

	it('refuses an unconfirmed proposal that has anything to weigh', async () => {
		const refused = await sendPackage(`${PACKAGES}?resolution=independent-copy`, revisionOnePackage);

		expect(refused.status).toBe(409);
		expect(refused.data.data.report.disposition).toBe('install-independent-copy');
	});

	it('preserves the packaged identity and revision when nothing here holds them', async () => {
		expect((await remove(styleSetId)).status).toBe(204);

		const installed = await sendPackage(PACKAGES, revisionOnePackage);

		expect(installed.status).toBe(201);
		expect(installed.data.report.disposition).toBe('install-new');
		const restored = installed.data.styleSet as GraphicStyleSetResponse;
		expect(restored.id).toBe(styleSetId);
		expect(restored.revision).toBe(1);
		expect(restored.published).toMatchObject(draft());
		// It arrives with nothing unpublished, so the first thing an author does to it is
		// an edit rather than a reconciliation.
		expect(restored.hasUnpublishedChanges).toBe(false);
	});

	it('updates the installed Graphic Style Set to a newer packaged revision once confirmed', async () => {
		const unconfirmed = await sendPackage(PACKAGES, revisionTwoPackage);
		expect(unconfirmed.status).toBe(409);
		const report = unconfirmed.data.data.report as GraphicStyleSetPackagePreflightReport;
		expect(report.disposition).toBe('update-installed');
		expect(report.issues)
			.toMatchObject([{ code: 'graphic-style-set-revision-updated', severity: 'warning' }]);
		expect((await styleSet()).revision).toBe(1);

		const confirmed = await sendPackage(
			`${PACKAGES}?fingerprint=${report.fingerprint}`,
			revisionTwoPackage,
		);

		expect(confirmed.status).toBe(200);
		const updated = confirmed.data.styleSet as GraphicStyleSetResponse;
		// The packaged revision is preserved rather than incremented, so both
		// installations stay on one numbering.
		expect(updated.revision).toBe(2);
		expect(updated.published).toMatchObject(draft(96));
	});

	it('refuses a file that is not a Graphic Style Set Package', async () => {
		const refused = await sendPackage(
			`${PACKAGES}/preflight`,
			new TextEncoder().encode('not an archive at all'),
		);

		expect(refused.status).toBe(200);
		const report = refused.data as GraphicStyleSetPackagePreflightReport;
		expect(report.outcome).toBe('rejected');
		expect(report.issues.every(issue => issue.remediation.length > 0)).toBe(true);
	});
});
