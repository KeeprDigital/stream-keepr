import type { DbGraphicStyleSet } from '~~/server/db/schema';
import type { GraphicStyleSetPackageInstallPorts } from '~~/server/modules/graphic-style-set-package';
import type { GraphicApplicationFontId } from '~~/shared/modules/graphics/typography';
import type { AffectedGraphicsTemplate, GraphicStyleSetEntry } from '~~/shared/types/graphicStyleSet';
import { beforeEach, describe, expect, it } from 'vitest';
import {
	exportGraphicStyleSetPackage,
	graphicStyleSetPackagePreflight,
	installGraphicStyleSetPackage,
} from '~~/server/modules/graphic-style-set-package';
import { readableBytes } from '~~/server/modules/graphics-asset-library/object-store';
import { createStoredZipArchive } from '~~/server/modules/graphics-asset-library/zip-archive';
import { graphicStyleSetContentDigest, sameGraphicStyleValue } from '~~/shared/modules/graphic-style-sets';
import {
	GRAPHIC_STYLE_SET_PACKAGE_MANIFEST_ENTRY,
	GRAPHIC_STYLE_SET_PACKAGE_MEDIA_TYPE,
	GRAPHIC_STYLE_SET_PACKAGE_STYLE_SET_ENTRY,
} from '~~/shared/types/graphicStyleSetPackage';
import { collectStream, readStoredZipArchive } from '../../../helpers/storedZipArchive';

/**
 * A Graphic Style Set travelling out of one installation and into another, through the
 * package module's own contract rather than through storage.
 *
 * The two installations here are two in-memory libraries behind the same ports the
 * routes wire to a database, so a round trip proves the thing that actually matters:
 * whatever an export declares is exactly what a receiver holds it to, and the identity
 * and revision that left one library are the identity and revision that arrive in the
 * other.
 */

const NOW = () => new Date('2026-07-31T00:00:00.000Z');

const BRAND: GraphicStyleSetEntry = {
	id: 'brand',
	kind: 'palette',
	name: 'Brand',
	schemaVersion: 1,
	value: { color: '#ff0044' },
};

function heading(fontSize = 64, fontId: GraphicApplicationFontId = 'inter'): GraphicStyleSetEntry {
	return {
		id: 'heading',
		kind: 'typography',
		name: 'Heading',
		schemaVersion: 1,
		value: {
			font: { kind: 'application', fontId },
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

/**
 * An entry carrying a Graphic Asset Reference — the shape no Style Set entry kind
 * produces today, and the one both sides of a transfer refuse rather than drop.
 */
function styleEntryNeedingAnAsset(): GraphicStyleSetEntry {
	return {
		id: 'backdrop',
		kind: 'media-treatment',
		name: 'Backdrop',
		schemaVersion: 1,
		value: { source: { assetId: 'asset-1', revisionId: 'revision-1' } },
	} as unknown as GraphicStyleSetEntry;
}

const SOURCE_ID = 'style-set-from-the-sending-installation';

function storedStyleSet(overrides: Partial<DbGraphicStyleSet> = {}): DbGraphicStyleSet {
	const entries = [BRAND, heading()];
	return {
		id: SOURCE_ID,
		name: 'Show Style',
		description: 'The 2026 season look',
		revision: 3,
		draftRevision: 4,
		draft: entries,
		published: entries,
		publishedAt: NOW(),
		operationVersion: null,
		createdAt: NOW(),
		updatedAt: NOW(),
		...overrides,
	} as DbGraphicStyleSet;
}

/** One installation's Graphic Style Set library, behind the ports the module uses. */
function library(seed: DbGraphicStyleSet[] = []) {
	const rows = new Map(seed.map(row => [row.id, row]));
	let linked: AffectedGraphicsTemplate[] = [];
	let identities = 0;

	const ports: GraphicStyleSetPackageInstallPorts = {
		findInstalled: async (styleSetId) => {
			const row = rows.get(styleSetId);
			return row
				? {
						id: row.id,
						name: row.name,
						revision: row.revision,
						draftRevision: row.draftRevision,
						published: row.published,
						hasUnpublishedChanges: !sameGraphicStyleValue(row.draft, row.published),
					}
				: undefined;
		},
		findInstalledRow: async styleSetId => rows.get(styleSetId),
		findLinkedTemplates: async () => linked,
		createPublished: async (input) => {
			// Conditional on the identity being free, exactly as the stored library's
			// `INSERT … WHERE NOT EXISTS` is. A fake that overwrote instead would let an
			// unguarded creation pass a test the database would answer with a crash.
			if (rows.has(input.id))
				return undefined;
			const created = storedStyleSet({
				id: input.id,
				name: input.name,
				description: input.description,
				revision: input.revision,
				draftRevision: 1,
				draft: input.entries,
				published: input.entries,
			});
			rows.set(created.id, created);
			return created;
		},
		republish: async (input) => {
			const existing = rows.get(input.id);
			if (
				!existing
				|| existing.revision !== input.expectedRevision
				|| existing.draftRevision !== input.expectedDraftRevision
			) {
				return undefined;
			}
			const updated = {
				...existing,
				revision: input.revision,
				draftRevision: existing.draftRevision + 1,
				draft: input.entries,
				published: input.entries,
			} as DbGraphicStyleSet;
			rows.set(updated.id, updated);
			return updated;
		},
		newIdentity: () => `local-identity-${++identities}`,
	};

	return {
		ports,
		rows,
		linkTemplates(templates: AffectedGraphicsTemplate[]) {
			linked = templates;
		},
	};
}

async function packageBytes(styleSet: DbGraphicStyleSet): Promise<Uint8Array> {
	const outcome = await exportGraphicStyleSetPackage({ styleSet, now: NOW });
	if (outcome.outcome !== 'exported')
		throw new Error(`Export was rejected: ${JSON.stringify(outcome.report.issues)}`);
	return await collectStream(outcome.package.open());
}

/** Rebuilds an archive from a package's two documents, so a test can tamper with one. */
async function rebuiltArchive(
	bytes: Uint8Array,
	rewrite: (documents: { manifest: any; snapshot: any }) => void | Promise<void>,
): Promise<Uint8Array> {
	const archive = readStoredZipArchive(bytes);
	const documents = {
		manifest: archive.json(GRAPHIC_STYLE_SET_PACKAGE_MANIFEST_ENTRY),
		snapshot: archive.json(GRAPHIC_STYLE_SET_PACKAGE_STYLE_SET_ENTRY),
	};
	await rewrite(documents);
	const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value, null, '\t'));
	const encoded = [
		{ name: GRAPHIC_STYLE_SET_PACKAGE_MANIFEST_ENTRY, bytes: encode(documents.manifest) },
		{ name: GRAPHIC_STYLE_SET_PACKAGE_STYLE_SET_ENTRY, bytes: encode(documents.snapshot) },
	];
	return await collectStream(createStoredZipArchive(encoded.map(entry => ({
		name: entry.name,
		byteLength: entry.bytes.byteLength,
		open: async () => readableBytes(entry.bytes),
	}))));
}

describe('exporting a Graphic Style Set as a `.skstyle` package', () => {
	it('refuses a Graphic Style Set that has never been published', async () => {
		const outcome = await exportGraphicStyleSetPackage({
			styleSet: storedStyleSet({ revision: 0, published: null, publishedAt: null }),
			now: NOW,
		});

		expect(outcome).toMatchObject({
			outcome: 'rejected',
			report: { issues: [{ code: 'graphic-style-set-never-published' }] },
		});
	});

	it('refuses published entries that do not resolve, naming every entry at fault', async () => {
		const outcome = await exportGraphicStyleSetPackage({
			styleSet: storedStyleSet({ published: [heading()], draft: [heading()] }),
			now: NOW,
		});

		expect(outcome).toMatchObject({
			outcome: 'rejected',
			report: { issues: [{ code: 'graphic-style-set-unresolvable', entryId: 'heading' }] },
		});
	});

	it('carries the published entries, the identity, the revision, and the fonts it needs', async () => {
		const outcome = await exportGraphicStyleSetPackage({ styleSet: storedStyleSet(), now: NOW });
		expect(outcome.outcome).toBe('exported');
		if (outcome.outcome !== 'exported')
			return;

		expect(outcome.package.mediaType).toBe(GRAPHIC_STYLE_SET_PACKAGE_MEDIA_TYPE);
		expect(outcome.package.fileName).toBe('show-style.skstyle');

		const bytes = await collectStream(outcome.package.open());
		// The declared length is settled before streaming, so it must be exact.
		expect(bytes.byteLength).toBe(outcome.package.archiveByteLength);

		const archive = readStoredZipArchive(bytes);
		expect(archive.entryNames).toEqual([
			GRAPHIC_STYLE_SET_PACKAGE_MANIFEST_ENTRY,
			GRAPHIC_STYLE_SET_PACKAGE_STYLE_SET_ENTRY,
		]);
		expect(archive.json(GRAPHIC_STYLE_SET_PACKAGE_MANIFEST_ENTRY)).toMatchObject({
			packageKind: 'skstyle',
			artifactKind: 'graphic-style-set',
			styleSet: { identity: SOURCE_ID, name: 'Show Style', revision: 3, entryCount: 2 },
			applicationCapabilities: [{ capability: 'application-font', identity: 'inter' }],
		});
		expect(archive.json(GRAPHIC_STYLE_SET_PACKAGE_STYLE_SET_ENTRY)).toEqual({
			id: SOURCE_ID,
			name: 'Show Style',
			description: 'The 2026 season look',
			revision: 3,
			entries: [BRAND, heading()],
		});
	});

	it('refuses an entry that requires a Graphic Asset Revision the package cannot carry', async () => {
		// No Graphic Style Set entry carries one today, and this guard is why that stays a
		// fact rather than an assumption: the first entry kind that gains a media selection
		// fails loudly here instead of exporting a package whose asset silently vanished.
		const outcome = await exportGraphicStyleSetPackage({
			styleSet: storedStyleSet({
				published: [BRAND, styleEntryNeedingAnAsset()],
				draft: [BRAND, styleEntryNeedingAnAsset()],
			}),
			now: NOW,
		});

		expect(outcome.outcome).toBe('rejected');
		if (outcome.outcome !== 'rejected')
			return;
		expect(outcome.report.issues).toContainEqual(expect.objectContaining({
			code: 'undeclared-graphic-asset-dependency',
			entryId: 'entries[1].value.source',
		}));
	});

	it('freezes the published entries rather than the working draft', async () => {
		const bytes = await packageBytes(storedStyleSet({ draft: [BRAND, heading(96)] }));
		const snapshot = readStoredZipArchive(bytes)
			.json<{ entries: GraphicStyleSetEntry[] }>(GRAPHIC_STYLE_SET_PACKAGE_STYLE_SET_ENTRY);

		expect(snapshot.entries).toEqual([BRAND, heading()]);
	});
});

describe('receiving a `.skstyle` package on another installation', () => {
	let sent: Uint8Array;

	beforeEach(async () => {
		sent = await packageBytes(storedStyleSet());
	});

	it('installs the packaged identity and revision on a first import, with nothing to confirm', async () => {
		const receiver = library();
		const { report } = await graphicStyleSetPackagePreflight({
			archive: sent,
			resolution: 'preserve-identity',
			findInstalled: receiver.ports.findInstalled,
			findLinkedTemplates: receiver.ports.findLinkedTemplates,
			now: NOW,
		});

		expect(report.outcome).toBe('ready');
		expect(report.disposition).toBe('install-new');
		expect(report.provenance).toMatchObject({ sourceStyleSetId: SOURCE_ID, sourceRevision: 3 });

		const outcome = await installGraphicStyleSetPackage({
			archive: sent,
			resolution: 'preserve-identity',
			ports: receiver.ports,
			now: NOW,
		});

		expect(outcome.outcome).toBe('installed');
		if (outcome.outcome !== 'installed')
			return;
		expect(outcome.styleSet.id).toBe(SOURCE_ID);
		expect(outcome.styleSet.revision).toBe(3);
		expect(outcome.styleSet.published).toEqual([BRAND, heading()]);
		// The Style Set opens with no unpublished changes, so the first thing an author
		// does to it is an edit rather than a reconciliation.
		expect(outcome.styleSet.draft).toEqual(outcome.styleSet.published);
	});

	it('writes nothing at all when the exact identity, revision, and content are already installed', async () => {
		const receiver = library([storedStyleSet()]);
		const outcome = await installGraphicStyleSetPackage({
			archive: sent,
			resolution: 'preserve-identity',
			ports: receiver.ports,
			now: NOW,
		});

		expect(outcome.outcome).toBe('already-installed');
		if (outcome.outcome !== 'already-installed')
			return;
		expect(outcome.report.outcome).toBe('ready');
		expect(outcome.styleSet.draftRevision).toBe(4);
		expect(outcome.styleSet.revision).toBe(3);
	});

	it('never downgrades an installed Graphic Style Set to an older packaged revision', async () => {
		const receiver = library([storedStyleSet({ revision: 5 })]);
		const outcome = await installGraphicStyleSetPackage({
			archive: sent,
			resolution: 'preserve-identity',
			ports: receiver.ports,
			now: NOW,
		});

		expect(outcome.outcome).toBe('rejected');
		expect(outcome.report.issues).toMatchObject([
			{ code: 'graphic-style-set-revision-superseded', severity: 'error' },
		]);
		expect(receiver.rows.get(SOURCE_ID)?.revision).toBe(5);
	});

	it('publishes a newer packaged revision only once its author has confirmed the proposal', async () => {
		const receiver = library([storedStyleSet()]);
		receiver.linkTemplates([
			{ id: 'lower-third', name: 'Lower third', revision: 7, styleChanged: true },
		]);
		const newer = await packageBytes(storedStyleSet({
			revision: 4,
			draft: [BRAND, heading(96)],
			published: [BRAND, heading(96)],
		}));

		const unconfirmed = await installGraphicStyleSetPackage({
			archive: newer,
			resolution: 'preserve-identity',
			ports: receiver.ports,
			now: NOW,
		});
		expect(unconfirmed.outcome).toBe('requires-confirmation');
		expect(unconfirmed.report.disposition).toBe('update-installed');
		expect(unconfirmed.report.affectedTemplates).toMatchObject([
			{ id: 'lower-third', styleChanged: true },
		]);
		expect(receiver.rows.get(SOURCE_ID)?.revision).toBe(3);

		const confirmed = await installGraphicStyleSetPackage({
			archive: newer,
			resolution: 'preserve-identity',
			ports: receiver.ports,
			confirmedFingerprint: unconfirmed.report.fingerprint,
			now: NOW,
		});
		expect(confirmed.outcome).toBe('installed');
		if (confirmed.outcome !== 'installed')
			return;
		// The packaged revision is preserved rather than incremented, so both
		// installations stay on one numbering and a third package still recognises either.
		expect(confirmed.styleSet.revision).toBe(4);
		expect(confirmed.styleSet.published).toEqual([BRAND, heading(96)]);
		expect(confirmed.affectedTemplates).toMatchObject([{ id: 'lower-third' }]);
	});

	it('refuses a confirmation that was given for a different proposal', async () => {
		const receiver = library([storedStyleSet()]);
		const newer = await packageBytes(storedStyleSet({
			revision: 4,
			draft: [BRAND, heading(96)],
			published: [BRAND, heading(96)],
		}));

		const outcome = await installGraphicStyleSetPackage({
			archive: newer,
			resolution: 'preserve-identity',
			ports: receiver.ports,
			confirmedFingerprint: 'f'.repeat(64),
			now: NOW,
		});

		expect(outcome.outcome).toBe('requires-confirmation');
		expect(receiver.rows.get(SOURCE_ID)?.revision).toBe(3);
	});

	it('installs a conflicting package as an independent copy under a new identity when asked', async () => {
		const receiver = library([storedStyleSet({ published: [BRAND, heading(96)] })]);
		const outcome = await installGraphicStyleSetPackage({
			archive: sent,
			resolution: 'independent-copy',
			ports: receiver.ports,
			confirmedFingerprint: (await graphicStyleSetPackagePreflight({
				archive: sent,
				resolution: 'independent-copy',
				findInstalled: receiver.ports.findInstalled,
				findLinkedTemplates: receiver.ports.findLinkedTemplates,
				now: NOW,
			})).report.fingerprint,
			now: NOW,
		});

		expect(outcome.outcome).toBe('installed');
		if (outcome.outcome !== 'installed')
			return;
		expect(outcome.styleSet.id).toBe('local-identity-1');
		// A copy is the first published revision of something that did not exist a moment
		// ago, so it claims no history the packaged revision would have given it.
		expect(outcome.styleSet.revision).toBe(1);
		expect(receiver.rows.get(SOURCE_ID)?.published).toEqual([BRAND, heading(96)]);
	});

	it('binds a confirmation to the resolution it was given for', async () => {
		const receiver = library([storedStyleSet({ published: [BRAND, heading(96)] })]);
		const preserving = await graphicStyleSetPackagePreflight({
			archive: sent,
			resolution: 'preserve-identity',
			findInstalled: receiver.ports.findInstalled,
			findLinkedTemplates: receiver.ports.findLinkedTemplates,
			now: NOW,
		});
		const copying = await graphicStyleSetPackagePreflight({
			archive: sent,
			resolution: 'independent-copy',
			findInstalled: receiver.ports.findInstalled,
			findLinkedTemplates: receiver.ports.findLinkedTemplates,
			now: NOW,
		});

		expect(preserving.report.disposition).toBe('rejected');
		expect(copying.report.disposition).toBe('install-independent-copy');
		expect(preserving.report.fingerprint).not.toBe(copying.report.fingerprint);
	});

	it('refuses a package whose Graphic Style Set was altered after it was digested', async () => {
		const tampered = await rebuiltArchive(sent, (documents) => {
			documents.snapshot.entries[0].value.color = '#00ff00';
		});
		const receiver = library();

		const outcome = await installGraphicStyleSetPackage({
			archive: tampered,
			resolution: 'preserve-identity',
			ports: receiver.ports,
			now: NOW,
		});

		expect(outcome.outcome).toBe('rejected');
		expect(outcome.report.issues).toMatchObject([{ code: 'package-content-digest-mismatch' }]);
		expect(receiver.rows.size).toBe(0);
	});

	it('refuses a package needing a font this installation does not have, installing nothing', async () => {
		const unsupported = await rebuiltArchive(sent, (documents) => {
			documents.snapshot.entries[1].value.font.fontId = 'a-font-from-somewhere-else';
			documents.manifest.applicationCapabilities = [{
				capability: 'application-font',
				identity: 'a-font-from-somewhere-else',
				configurationVersion: 1,
				requiredBy: ['entries.heading.font.fontId'],
			}];
		});
		const receiver = library();

		const outcome = await installGraphicStyleSetPackage({
			archive: unsupported,
			resolution: 'preserve-identity',
			ports: receiver.ports,
			now: NOW,
		});

		expect(outcome.outcome).toBe('rejected');
		expect(outcome.report.issues.map(issue => issue.code))
			.toContain('unsupported-application-capability');
		expect(receiver.rows.size).toBe(0);
	});

	it('refuses a package carrying a file it never declares', async () => {
		const archive = readStoredZipArchive(sent);
		const withExtra = await collectStream(createStoredZipArchive([
			...archive.entries.map(entry => ({
				name: entry.name,
				byteLength: entry.bytes.byteLength,
				open: async () => readableBytes(entry.bytes),
			})),
			{
				name: 'stowaway.json',
				byteLength: 2,
				open: async () => readableBytes(new TextEncoder().encode('{}')),
			},
		]));
		const receiver = library();

		const outcome = await installGraphicStyleSetPackage({
			archive: withExtra,
			resolution: 'preserve-identity',
			ports: receiver.ports,
			now: NOW,
		});

		expect(outcome.outcome).toBe('rejected');
		expect(outcome.report.issues.map(issue => issue.code)).toContain('undeclared-package-entry');
		expect(receiver.rows.size).toBe(0);
	});

	it('refuses a document that is not a Graphic Style Set this installation reads', async () => {
		const wrong = await rebuiltArchive(sent, (documents) => {
			documents.snapshot.entries[0].kind = 'something-this-build-has-never-heard-of';
		});
		const receiver = library();

		const outcome = await installGraphicStyleSetPackage({
			archive: wrong,
			resolution: 'preserve-identity',
			ports: receiver.ports,
			now: NOW,
		});

		expect(outcome.outcome).toBe('rejected');
		expect(outcome.report.issues.map(issue => issue.code))
			.toContain('invalid-graphic-style-set-document');
		expect(receiver.rows.size).toBe(0);
	});

	it('names an unpublished draft it would discard, and discards it only once confirmed', async () => {
		const receiver = library([storedStyleSet({ draft: [BRAND, heading(120)] })]);
		const newer = await packageBytes(storedStyleSet({
			revision: 4,
			draft: [BRAND, heading(96)],
			published: [BRAND, heading(96)],
		}));

		const unconfirmed = await installGraphicStyleSetPackage({
			archive: newer,
			resolution: 'preserve-identity',
			ports: receiver.ports,
			now: NOW,
		});

		expect(unconfirmed.outcome).toBe('requires-confirmation');
		expect(unconfirmed.report.issues.map(issue => issue.code))
			.toContain('graphic-style-set-draft-discarded');
		expect(receiver.rows.get(SOURCE_ID)?.draft).toEqual([BRAND, heading(120)]);

		const confirmed = await installGraphicStyleSetPackage({
			archive: newer,
			resolution: 'preserve-identity',
			ports: receiver.ports,
			confirmedFingerprint: unconfirmed.report.fingerprint,
			now: NOW,
		});

		expect(confirmed.outcome).toBe('installed');
		expect(receiver.rows.get(SOURCE_ID)?.draft).toEqual([BRAND, heading(96)]);
	});

	it('refuses a package whose identity exists here and has never been published', async () => {
		const receiver = library([storedStyleSet({ revision: 0, published: null })]);

		const outcome = await installGraphicStyleSetPackage({
			archive: sent,
			resolution: 'preserve-identity',
			ports: receiver.ports,
			now: NOW,
		});

		expect(outcome.outcome).toBe('rejected');
		expect(outcome.report.issues)
			.toMatchObject([{ code: 'graphic-style-set-identity-unpublished', severity: 'error' }]);
		expect(receiver.rows.get(SOURCE_ID)?.revision).toBe(0);
	});

	it('refuses a package whose entries require a Graphic Asset Revision it never carried', async () => {
		// A digest the receiver agrees with, so this is the package a future build would
		// legitimately produce rather than a tampered one — the asset dependency is the
		// only thing wrong with it, and it is enough on its own.
		const withAsset = await rebuiltArchive(sent, async (documents) => {
			documents.snapshot.entries[1] = styleEntryNeedingAnAsset();
			documents.manifest.styleSet.contentDigest
				= await graphicStyleSetContentDigest(documents.snapshot.entries);
		});
		const receiver = library();

		const outcome = await installGraphicStyleSetPackage({
			archive: withAsset,
			resolution: 'preserve-identity',
			ports: receiver.ports,
			now: NOW,
		});

		expect(outcome.outcome).toBe('rejected');
		expect(outcome.report.issues).toContainEqual(expect.objectContaining({
			code: 'undeclared-graphic-asset-dependency',
			severity: 'error',
			subject: 'entries[1].value.source',
		}));
		expect(receiver.rows.size).toBe(0);
	});

	it('writes nothing when a draft edit lands between the confirmed report and the install', async () => {
		// The installed Style Set already has unpublished draft changes, so the warning
		// naming them is in *both* reports and the only thing the second author's edit
		// moves is the draft revision. A baseline whose draft matched its published
		// entries would pass this for the wrong reason: the edit would introduce a warning
		// that was absent before, and the confirmation would be refused over the issue
		// list rather than over the revision the write is actually bound to.
		const receiver = library([storedStyleSet({ draft: [BRAND, heading(120)] })]);
		const newer = await packageBytes(storedStyleSet({
			revision: 4,
			draft: [BRAND, heading(96)],
			published: [BRAND, heading(96)],
		}));

		const proposal = await installGraphicStyleSetPackage({
			archive: newer,
			resolution: 'preserve-identity',
			ports: receiver.ports,
			now: NOW,
		});
		expect(proposal.outcome).toBe('requires-confirmation');
		expect(proposal.report.issues.map(issue => issue.code))
			.toContain('graphic-style-set-draft-discarded');
		expect(proposal.report.installedDraftRevision).toBe(4);

		// Another author saves a further draft edit after the report the confirmation is
		// bound to. Nothing else about the library moves.
		const installed = receiver.rows.get(SOURCE_ID)!;
		receiver.rows.set(SOURCE_ID, {
			...installed,
			draft: [BRAND, heading(150)],
			draftRevision: installed.draftRevision + 1,
		} as DbGraphicStyleSet);

		const raced = await installGraphicStyleSetPackage({
			archive: newer,
			resolution: 'preserve-identity',
			ports: receiver.ports,
			confirmedFingerprint: proposal.report.fingerprint,
			now: NOW,
		});

		// The draft revision is inside the fingerprint, so the edit made in the meantime
		// is a different proposal rather than one the earlier confirmation carries over
		// to — and the second author's work is still there.
		expect(raced.outcome).toBe('requires-confirmation');
		expect(raced.report.installedDraftRevision).toBe(5);
		expect(receiver.rows.get(SOURCE_ID)?.draft).toEqual([BRAND, heading(150)]);
		expect(receiver.rows.get(SOURCE_ID)?.revision).toBe(3);
	});

	it('writes nothing when a draft edit lands inside the install’s own preflight', async () => {
		const receiver = library([storedStyleSet({ draft: [BRAND, heading(120)] })]);
		const newer = await packageBytes(storedStyleSet({
			revision: 4,
			draft: [BRAND, heading(96)],
			published: [BRAND, heading(96)],
		}));

		const proposal = await installGraphicStyleSetPackage({
			archive: newer,
			resolution: 'preserve-identity',
			ports: receiver.ports,
			now: NOW,
		});
		expect(proposal.outcome).toBe('requires-confirmation');

		// The narrowest window there is: the edit lands after the install's own preflight
		// read the draft revision and before it writes. The report is identical to the one
		// confirmed, so the fingerprint still matches and only the compare-and-swap can
		// refuse this — which is exactly what a write taking its precondition from a fresh
		// read instead of from the report would fail to do.
		const racing: GraphicStyleSetPackageInstallPorts = {
			...receiver.ports,
			findLinkedTemplates: async (styleSetId, entries) => {
				const linked = await receiver.ports.findLinkedTemplates(styleSetId, entries);
				const installed = receiver.rows.get(SOURCE_ID)!;
				receiver.rows.set(SOURCE_ID, {
					...installed,
					draft: [BRAND, heading(150)],
					draftRevision: installed.draftRevision + 1,
				} as DbGraphicStyleSet);
				return linked;
			},
		};

		const raced = await installGraphicStyleSetPackage({
			archive: newer,
			resolution: 'preserve-identity',
			ports: racing,
			confirmedFingerprint: proposal.report.fingerprint,
			now: NOW,
		});

		expect(raced.outcome).toBe('conflict');
		expect(receiver.rows.get(SOURCE_ID)?.draft).toEqual([BRAND, heading(150)]);
		expect(receiver.rows.get(SOURCE_ID)?.revision).toBe(3);
	});

	it('writes nothing when the packaged identity is claimed between the report and the install', async () => {
		const receiver = library();
		// The identity is free when preflight reads it and held by the time the creation
		// runs — a concurrent install of the same package, or an author who happened to
		// create a Style Set. That is the same race an update guards against, so it is
		// answered the same way rather than as an unhandled constraint violation.
		const racing: GraphicStyleSetPackageInstallPorts = {
			...receiver.ports,
			findInstalled: async (styleSetId) => {
				const facts = await receiver.ports.findInstalled(styleSetId);
				receiver.rows.set(SOURCE_ID, storedStyleSet({ name: 'Claimed first' }));
				return facts;
			},
		};

		const outcome = await installGraphicStyleSetPackage({
			archive: sent,
			resolution: 'preserve-identity',
			ports: racing,
			now: NOW,
		});

		expect(outcome.outcome).toBe('conflict');
		expect(outcome.report.disposition).toBe('install-new');
		expect(receiver.rows.get(SOURCE_ID)?.name).toBe('Claimed first');
	});
});
