import type { InstalledGraphicStyleSetFacts } from '~~/shared/modules/graphic-style-sets';
import type { GraphicFontId } from '~~/shared/types/graphics';
import type { GraphicStyleSetEntry } from '~~/shared/types/graphicStyleSet';
import { describe, expect, it } from 'vitest';
import {
	canonicalGraphicStyleSetJson,
	graphicStyleSetContentDigest,
	graphicStyleSetPackageCapabilities,
	graphicStyleSetPackageDisposition,
	readGraphicStyleSetPackageManifest,
} from '~~/shared/modules/graphic-style-sets';
import {
	GRAPHIC_STYLE_SET_PACKAGE_ARTIFACT_KIND,
	GRAPHIC_STYLE_SET_PACKAGE_KIND,
	GRAPHIC_STYLE_SET_PACKAGE_SCHEMA_VERSION,
	GRAPHIC_STYLE_SET_PACKAGE_STYLE_SET_ENTRY,
} from '~~/shared/types/graphicStyleSetPackage';

/**
 * What a `.skstyle` package decides, proved without an archive or a database.
 *
 * The rules under test are the glossary's, and they are the whole reason this artifact
 * is not a Template Package: an import preserves the packaged identity and revision, a
 * newer revision may update the installed Style Set, an older one never downgrades it,
 * an identical one does nothing, a same-revision content difference is a conflict, and
 * an independent copy is always available instead.
 */

const BRAND: GraphicStyleSetEntry = {
	id: 'brand',
	kind: 'palette',
	name: 'Brand',
	schemaVersion: 1,
	value: { color: '#ff0044' },
};

function heading(fontId: GraphicFontId = 'inter', fontSize = 64): GraphicStyleSetEntry {
	return {
		id: 'heading',
		kind: 'typography',
		name: 'Heading',
		schemaVersion: 1,
		value: {
			fontId,
			fontSize,
			fontWeight: 800,
			fontStyle: 'normal',
			textTransform: 'uppercase',
			letterSpacing: 2,
			lineHeight: 1,
			colorEntryId: 'brand',
		},
	};
}

const ENTRIES: GraphicStyleSetEntry[] = [BRAND, heading()];

function installed(
	overrides: Partial<InstalledGraphicStyleSetFacts> = {},
): InstalledGraphicStyleSetFacts {
	return {
		id: 'style-set-1',
		name: 'Show Style',
		revision: 3,
		draftRevision: 4,
		published: ENTRIES,
		hasUnpublishedChanges: false,
		...overrides,
	};
}

function packaged(overrides: Partial<{
	id: string;
	name: string;
	revision: number;
	entries: GraphicStyleSetEntry[];
}> = {}) {
	return {
		id: 'style-set-1',
		name: 'Show Style',
		revision: 3,
		entries: ENTRIES,
		...overrides,
	};
}

describe('the content digest a Graphic Style Set Package records', () => {
	it('reads the same on two installations that serialised the same entries differently', async () => {
		const reordered = [
			{ value: { color: '#ff0044' }, schemaVersion: 1, name: 'Brand', kind: 'palette', id: 'brand' },
			{ value: heading().value, schemaVersion: 1, name: 'Heading', kind: 'typography', id: 'heading' },
		] as unknown as GraphicStyleSetEntry[];

		expect(await graphicStyleSetContentDigest(reordered))
			.toBe(await graphicStyleSetContentDigest(ENTRIES));
	});

	it('changes when a published value changes', async () => {
		expect(await graphicStyleSetContentDigest([BRAND, heading('inter', 72)]))
			.not
			.toBe(await graphicStyleSetContentDigest(ENTRIES));
	});

	it('changes when the author reordered the entries, because the order is authored', async () => {
		expect(await graphicStyleSetContentDigest([heading(), BRAND]))
			.not
			.toBe(await graphicStyleSetContentDigest(ENTRIES));
	});

	it('drops undefined members, because storage does', () => {
		expect(canonicalGraphicStyleSetJson({ b: undefined, a: 1 }))
			.toBe(canonicalGraphicStyleSetJson({ a: 1 }));
	});
});

describe('the application fonts a Graphic Style Set Package declares', () => {
	it('names one declaration per distinct font, with every entry that needs it', () => {
		const second: GraphicStyleSetEntry = { ...heading(), id: 'caption', name: 'Caption' };

		expect(graphicStyleSetPackageCapabilities([BRAND, heading(), second])).toEqual([{
			capability: 'application-font',
			identity: 'inter',
			configurationVersion: 1,
			requiredBy: ['entries.caption.fontId', 'entries.heading.fontId'],
		}]);
	});

	it('declares nothing for a Style Set with no typography', () => {
		expect(graphicStyleSetPackageCapabilities([BRAND])).toEqual([]);
	});
});

describe('reading a received Graphic Style Set Package manifest', () => {
	function manifest(overrides: Record<string, unknown> = {}) {
		return {
			schemaVersion: GRAPHIC_STYLE_SET_PACKAGE_SCHEMA_VERSION,
			packageKind: GRAPHIC_STYLE_SET_PACKAGE_KIND,
			artifactKind: GRAPHIC_STYLE_SET_PACKAGE_ARTIFACT_KIND,
			createdAt: '2026-07-31T00:00:00.000Z',
			styleSet: {
				identity: 'style-set-1',
				name: 'Show Style',
				revision: 3,
				contentDigest: 'a'.repeat(64),
				entryCount: 2,
				entry: GRAPHIC_STYLE_SET_PACKAGE_STYLE_SET_ENTRY,
			},
			applicationCapabilities: [],
			totals: { entryCount: 2, expandedByteLength: 1024 },
			...overrides,
		};
	}

	it('reads a well-formed manifest', () => {
		const read = readGraphicStyleSetPackageManifest(manifest());
		expect(read.outcome).toBe('read');
	});

	it('refuses a schema newer than this installation reads rather than guessing at it', () => {
		const read = readGraphicStyleSetPackageManifest(manifest({
			schemaVersion: GRAPHIC_STYLE_SET_PACKAGE_SCHEMA_VERSION + 1,
		}));
		expect(read).toMatchObject({
			outcome: 'rejected',
			issues: [{ code: 'unsupported-package-schema-version' }],
		});
	});

	it('refuses a Template Package presented as a Graphic Style Set Package', () => {
		const read = readGraphicStyleSetPackageManifest(manifest({ packageKind: 'skgraphic' }));
		expect(read).toMatchObject({
			outcome: 'rejected',
			issues: [{ code: 'unsupported-package-artifact' }],
		});
	});

	it('refuses a manifest carrying an unpublished revision, because a package only carries published entries', () => {
		const read = readGraphicStyleSetPackageManifest(manifest({
			styleSet: { ...manifest().styleSet, revision: 0 },
		}));
		expect(read).toMatchObject({ outcome: 'rejected', issues: [{ code: 'invalid-package-manifest' }] });
	});

	it('refuses a manifest that does not agree with its own totals', () => {
		const read = readGraphicStyleSetPackageManifest(manifest({
			totals: { entryCount: 5, expandedByteLength: 1024 },
		}));
		expect(read).toMatchObject({ outcome: 'rejected', issues: [{ code: 'invalid-package-manifest' }] });
	});
});

describe('what installing a Graphic Style Set Package would do', () => {
	it('preserves the packaged identity and revision on a first import', () => {
		expect(graphicStyleSetPackageDisposition({
			packaged: packaged(),
			resolution: 'preserve-identity',
		})).toEqual({ disposition: 'install-new', issues: [] });
	});

	it('does nothing when the exact identity, revision, and content are already installed', () => {
		expect(graphicStyleSetPackageDisposition({
			packaged: packaged(),
			installed: installed(),
			resolution: 'preserve-identity',
		})).toEqual({ disposition: 'already-installed', issues: [] });
	});

	it('still recognises identical content that was stored with its keys in another order', () => {
		const restored = JSON.parse(JSON.stringify({ entries: ENTRIES })).entries as GraphicStyleSetEntry[];
		expect(graphicStyleSetPackageDisposition({
			packaged: packaged({ entries: restored }),
			installed: installed(),
			resolution: 'preserve-identity',
		}).disposition).toBe('already-installed');
	});

	it('reports a name difference without treating it as a conflict, because a rename creates no revision', () => {
		const decided = graphicStyleSetPackageDisposition({
			packaged: packaged({ name: 'Show Style 2026' }),
			installed: installed(),
			resolution: 'preserve-identity',
		});
		expect(decided.disposition).toBe('already-installed');
		expect(decided.issues).toMatchObject([
			{ code: 'graphic-style-set-name-differs', severity: 'warning' },
		]);
	});

	it('offers a newer revision as an update the author confirms', () => {
		const decided = graphicStyleSetPackageDisposition({
			packaged: packaged({ revision: 4, entries: [BRAND, heading('inter', 72)] }),
			installed: installed(),
			resolution: 'preserve-identity',
		});
		expect(decided.disposition).toBe('update-installed');
		expect(decided.issues).toMatchObject([
			{ code: 'graphic-style-set-revision-updated', severity: 'warning' },
		]);
	});

	it('never silently downgrades an installed Style Set to an older revision', () => {
		const decided = graphicStyleSetPackageDisposition({
			packaged: packaged({ revision: 2 }),
			installed: installed(),
			resolution: 'preserve-identity',
		});
		expect(decided.disposition).toBe('rejected');
		expect(decided.issues).toMatchObject([
			{ code: 'graphic-style-set-revision-superseded', severity: 'error' },
		]);
	});

	it('treats the same revision with different content as a conflict rather than merging it', () => {
		const decided = graphicStyleSetPackageDisposition({
			packaged: packaged({ entries: [BRAND, heading('inter', 72)] }),
			installed: installed(),
			resolution: 'preserve-identity',
		});
		expect(decided.disposition).toBe('rejected');
		expect(decided.issues).toMatchObject([
			{ code: 'graphic-style-set-revision-conflict', severity: 'error' },
		]);
	});

	it('refuses to publish an update over unpublished draft changes it would discard', () => {
		const decided = graphicStyleSetPackageDisposition({
			packaged: packaged({ revision: 4 }),
			installed: installed({ hasUnpublishedChanges: true }),
			resolution: 'preserve-identity',
		});
		expect(decided.disposition).toBe('rejected');
		expect(decided.issues).toMatchObject([
			{ code: 'graphic-style-set-draft-diverged', severity: 'error' },
		]);
	});

	it('refuses to install over an identity that exists here and has never been published', () => {
		const decided = graphicStyleSetPackageDisposition({
			packaged: packaged(),
			installed: installed({ revision: 0, published: null, hasUnpublishedChanges: true }),
			resolution: 'preserve-identity',
		});
		expect(decided.disposition).toBe('rejected');
		expect(decided.issues).toMatchObject([
			{ code: 'graphic-style-set-draft-diverged', severity: 'error' },
		]);
	});

	it.each([
		['a conflicting package', packaged({ entries: [BRAND, heading('inter', 72)] })],
		['an older package', packaged({ revision: 2 })],
		['an already-installed package', packaged()],
	])('offers %s an independent copy with a new identity instead', (_label, subject) => {
		const decided = graphicStyleSetPackageDisposition({
			packaged: subject,
			installed: installed(),
			resolution: 'independent-copy',
		});
		expect(decided.disposition).toBe('install-independent-copy');
		expect(decided.issues).toMatchObject([
			{ code: 'graphic-style-set-installed-as-copy', severity: 'warning' },
		]);
	});
});
