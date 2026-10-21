import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import { describe, expect, it } from 'vitest';
import { templatePackagePayloads } from '~~/server/modules/template-package-payload';
import { readInstalledBroadcastGraphicDocument } from '~~/server/modules/template-package-payload/broadcastGraphic';
import { readInstalledFeatureMatchLayoutDocument } from '~~/server/modules/template-package-payload/featureMatchLayout';
import { GRAPHIC_ITEM_KINDS } from '~~/shared/modules/graphics/itemDefinitions';
import { TEMPLATE_PACKAGE_KINDS } from '~~/shared/types/templatePackage';
import { testGraphicAssetReference } from '~~/test/helpers/graphicsAssetIdentities';
import { maximalBroadcastGraphicDocument } from '../../../helpers/broadcastGraphicDocument';
import { maximalFeatureMatchLayoutDocument } from '../../../helpers/featureMatchLayoutDocument';

const asset = testGraphicAssetReference('asset-1', 'revision-1');

function skgraphic() {
	return templatePackagePayloads('skgraphic');
}

function read(document: unknown) {
	return skgraphic().readInstallableDocument(document);
}

function rejectionCodes(document: unknown) {
	const outcome = read(document);
	if (outcome.outcome !== 'rejected')
		throw new Error('Expected the document to be refused');
	return [...new Set(outcome.issues.map(issue => issue.code))];
}

describe('the Template Package payload registry', () => {
	/**
	 * The envelope carries several artifacts and each one's payload decides what its
	 * document has to be. A kind added to the envelope without an entry here would be
	 * carried as unread data — a package installing a Template nothing can use, with
	 * nothing anywhere reporting a problem.
	 */
	it('answers for every Template Package kind the envelope carries', () => {
		for (const kind of TEMPLATE_PACKAGE_KINDS) {
			const payload = templatePackagePayloads(kind);
			expect(payload.packageKind).toBe(kind);
			expect(typeof payload.readInstallableDocument).toBe('function');
		}
	});
});

describe('the `.skgraphic` payload', () => {
	it('reads a Broadcast Graphic and reports the capabilities it requires', () => {
		const outcome = read(maximalBroadcastGraphicDocument({ asset }));

		expect(outcome.outcome).toBe('read');
		if (outcome.outcome !== 'read')
			return;
		// Every Graphic Item Definition the document uses is named, a Graphic Group's
		// children included: a receiver that never learned a child's Definition could
		// accept a package holding a kind it cannot render.
		//
		// Compared against the shared vocabulary rather than a written list, so it also
		// pins that the fixture still uses every kind. A Definition added to
		// `GRAPHIC_ITEM_KINDS` and never placed in the fixture is a branch of the
		// transfer nobody is holding to anything, and this is where that shows up.
		const definitions = [...new Set(outcome.capabilities
			.filter(requirement => requirement.capability === 'graphic-item-definition')
			.map(requirement => requirement.identity))]
			.sort();
		expect(definitions).toEqual([...GRAPHIC_ITEM_KINDS].sort());
		expect(outcome.capabilities.some(requirement =>
			requirement.capability === 'host-vocabulary'
			&& requirement.identity === 'social-profile-projection',
		)).toBe(true);
		// And the application fonts, which travel as identifiers rather than bytes.
		expect(outcome.capabilities.some(requirement =>
			requirement.capability === 'application-font' && requirement.identity === 'inter',
		)).toBe(true);
	});

	/**
	 * The point of reading the document at all. A package whose Template is
	 * well-formed JSON but not a Broadcast Graphic would otherwise install as a
	 * Template that nothing can place, render, or repair.
	 */
	it('refuses a document that is not a Broadcast Graphic', () => {
		expect(rejectionCodes({ backdrop: asset })).toEqual(['invalid-template-document']);
		expect(rejectionCodes('a lower third')).toEqual(['invalid-template-document']);
		expect(rejectionCodes(null)).toEqual(['invalid-template-document']);
	});

	/**
	 * Placing a template rewrites its Graphic Item ids and rewrites every stagger
	 * that names one, resolving an old id through one flat map across the top level
	 * and every Graphic Group's children. A document with a colliding id makes that
	 * map ambiguous, so a placement would rewrite one container's stagger onto
	 * another container's item. The Screen's own write path refuses such a document;
	 * this is the same refusal applied to one arriving from another installation.
	 */
	it('refuses a document whose Graphic Item ids collide across a Graphic Group', () => {
		const document = maximalBroadcastGraphicDocument({ asset });
		const group = document.items.find(item => item.type === 'group');
		if (group?.type !== 'group')
			throw new Error('expected a Graphic Group');
		group.children[0]!.id = 'headline';

		expect(rejectionCodes(document)).toEqual(['invalid-template-document']);
	});

	it('refuses a document declaring a Graphic Item kind this installation does not implement', () => {
		const document = maximalBroadcastGraphicDocument({ asset }) as BroadcastGraphicConfig & {
			items: { type: string }[];
		};
		(document.items[0] as { type: string }).type = 'particle-emitter';

		expect(rejectionCodes(document)).toEqual(['invalid-template-document']);
	});

	/**
	 * A rejection names the field rather than only the document, because an author
	 * correcting a design on the *sending* installation has to know where to look.
	 */
	it('names the field responsible for a refusal', () => {
		const document = maximalBroadcastGraphicDocument({ asset });
		document.name = '';

		const outcome = read(document);
		if (outcome.outcome !== 'rejected')
			throw new Error('Expected the document to be refused');
		expect(outcome.issues.some(issue => issue.subject === 'name')).toBe(true);
	});
});

/**
 * A v1 package exported before ADR-0020 carries `videoCompatibility` on its media.
 * Both payloads read documents through the strict screen schemas, so the key has to
 * be accepted there — refused, every such package would stop installing — and
 * dropped from the typed document an installed Template is read back as.
 */
describe('a v1 package exported before ADR-0020', () => {
	const layout = maximalFeatureMatchLayoutDocument({
		frameAsset: testGraphicAssetReference('frame-asset', 'frame-revision'),
		itemAsset: asset,
	});
	const graphic = maximalBroadcastGraphicDocument({ asset });

	it('carries the retired key in the fixtures this suite reads', () => {
		expect(JSON.stringify(graphic)).toContain('videoCompatibility');
		expect(JSON.stringify(layout)).toContain('videoCompatibility');
	});

	it('installs a `.skgraphic` whose media carries videoCompatibility, and reads it back without the key', () => {
		expect(templatePackagePayloads('skgraphic').readInstallableDocument(graphic).outcome).toBe('read');
		const installed = readInstalledBroadcastGraphicDocument(graphic);
		expect(installed).toBeDefined();
		expect(JSON.stringify(installed)).not.toContain('videoCompatibility');
	});

	it('installs a `.sklayout` whose media carries videoCompatibility, and reads it back without the key', () => {
		expect(templatePackagePayloads('sklayout').readInstallableDocument(layout).outcome).toBe('read');
		const installed = readInstalledFeatureMatchLayoutDocument(layout);
		expect(installed).toBeDefined();
		expect(JSON.stringify(installed)).not.toContain('videoCompatibility');
	});
});

/**
 * A `.sklayout` carries a root-relative Remote Media URL as data (ADR-0021), so it
 * resolves against the receiving installation. The receiver reads it through the
 * same schema as its own Screens, so a package naming one of the receiver's
 * application routes, rather than media it serves, is refused at install (#582).
 */
describe('a `.sklayout` whose Frame names a root-relative Remote Media URL', () => {
	function withFrameVideoUrl(url: string) {
		const layout = maximalFeatureMatchLayoutDocument({
			frameAsset: testGraphicAssetReference('frame-asset', 'frame-revision'),
			itemAsset: asset,
		});
		layout.frame.mediaBackground = { enabled: true, source: { kind: 'url', url }, fit: 'cover', opacity: 1, playbackRate: 1, loop: true };
		return layout;
	}

	it('installs one naming media the application serves', () => {
		expect(templatePackagePayloads('sklayout').readInstallableDocument(withFrameVideoUrl('/video/loop.mp4')).outcome).toBe('read');
	});

	it('refuses one naming an application route, and names the field', () => {
		const outcome = templatePackagePayloads('sklayout').readInstallableDocument(
			withFrameVideoUrl('/video/../api/graphics-assets/asset-1/revisions/revision-1/content'),
		);
		if (outcome.outcome !== 'rejected')
			throw new Error('Expected the document to be refused');

		expect(outcome.issues).toEqual([expect.objectContaining({
			code: 'invalid-template-document',
			subject: 'frame.mediaBackground.source.url',
			message: expect.stringContaining('/video/'),
		})]);
	});
});
