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
import { GRAPHIC_STYLE_SET_LINK_KEYS, withFormerItemStyleRefs, withFormerStyleSetLink } from '../../../helpers/formerGraphicStyleSetLinks';

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
	return [
		...new Set(outcome.issues.map(issue => issue.code)),
	];
}

describe('the Template Package payload registry', () => {
	// A kind without a reading payload would install its Template as unread data.
	it.each(TEMPLATE_PACKAGE_KINDS)('reads and refuses a %s document', (kind) => {
		const payload = templatePackagePayloads(kind);

		expect(payload.packageKind).toBe(kind);
		expect(payload.readInstallableDocument('not a document')).toMatchObject({
			outcome: 'rejected',
			issues: [
				expect.objectContaining({ code: 'invalid-template-document' }),
			],
		});
	});
});

describe('the `.skgraphic` payload', () => {
	it('reads a Broadcast Graphic and reports the capabilities it requires', () => {
		const outcome = read(maximalBroadcastGraphicDocument({ asset }));

		expect(outcome.outcome).toBe('read');
		if (outcome.outcome !== 'read')
			return;
		// Every Definition used is named, Graphic Group children included; compared with the
		// shared vocabulary so the fixture is also held to using every kind.
		const definitions = [
			...new Set(outcome.capabilities
				.filter(requirement => requirement.capability === 'graphic-item-definition')
				.map(requirement => requirement.identity)),
		]
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

	it('refuses a document that is not a Broadcast Graphic', () => {
		expect(rejectionCodes({ backdrop: asset })).toEqual(['invalid-template-document']);
		expect(rejectionCodes('a lower third')).toEqual(['invalid-template-document']);
		expect(rejectionCodes(null)).toEqual(['invalid-template-document']);
	});

	// Placement remaps ids through one flat map, so a collision would misdirect a stagger.
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

	it('names the field responsible for a refusal', () => {
		const document = maximalBroadcastGraphicDocument({ asset });
		document.name = '';

		const outcome = read(document);
		if (outcome.outcome !== 'rejected')
			throw new Error('Expected the document to be refused');
		expect(outcome.issues.some(issue => issue.subject === 'name')).toBe(true);
	});
});

/** A v1 package's `videoCompatibility` (pre ADR-0020) is accepted and dropped, not refused. */
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

/** A package exported while Graphic Style Sets existed installs, its values kept as literals. */
describe('a package exported before Graphic Style Sets were removed', () => {
	const graphic = withFormerStyleSetLink(maximalBroadcastGraphicDocument({ asset }));
	const layout = withFormerItemStyleRefs(maximalFeatureMatchLayoutDocument({
		frameAsset: testGraphicAssetReference('frame-asset', 'frame-revision'),
		itemAsset: asset,
	}));

	it.each([
		[
			'`.skgraphic`',
			'skgraphic' as const,
			graphic,
			readInstalledBroadcastGraphicDocument,
		],
		[
			'`.sklayout`',
			'sklayout' as const,
			layout,
			readInstalledFeatureMatchLayoutDocument,
		],
	])('installs a %s carrying Style Set links, and reads it back without them', (_, kind, document, readInstalled) => {
		expect(templatePackagePayloads(kind).readInstallableDocument(document).outcome).toBe('read');
		const installed = readInstalled(document);
		expect(installed).toBeDefined();
		expect(JSON.stringify(installed)).not.toMatch(GRAPHIC_STYLE_SET_LINK_KEYS);
	});
});

/** A root-relative Remote Media URL resolves on the receiver, so naming one of its routes is refused (ADR-0021, #582). */
describe('a `.sklayout` whose Frame names a root-relative Remote Media URL', () => {
	function withFrameVideoUrl(url: string) {
		const layout = maximalFeatureMatchLayoutDocument({
			frameAsset: testGraphicAssetReference('frame-asset', 'frame-revision'),
			itemAsset: asset,
		});
		layout.frame.mediaBackground = {
			enabled: true,
			source: { kind: 'url', url },
			fit: 'cover',
			opacity: 1,
			playbackRate: 1,
			loop: true,
		};
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

		expect(outcome.issues).toEqual([
			expect.objectContaining({
				code: 'invalid-template-document',
				subject: 'frame.mediaBackground.source.url',
				message: expect.stringContaining('/video/'),
			}),
		]);
	});
});

/** A Template Package carries Theme bindings, never a Theme (ADR-0049, #829). */
describe('theme bindings in a Template Package', () => {
	function boundGraphic(): BroadcastGraphicConfig {
		const document = maximalBroadcastGraphicDocument({ asset });
		return {
			...document,
			animation: {
				enter: {
					duration: 400,
					easing: 'ease-out',
					delay: 0,
					fade: { opacity: 0 },
				},
			},
			themeBindings: { 'animation.enter': 'motion-enter' },
		};
	}

	function boundLayout() {
		const layout = maximalFeatureMatchLayoutDocument({
			frameAsset: testGraphicAssetReference('frame-asset', 'frame-revision'),
			itemAsset: asset,
		});
		return {
			...layout,
			composition: {
				...layout.composition,
				themeBindings: { 'animation.exit': 'motion-exit' },
			},
		};
	}

	function bindingsOf(graphic: BroadcastGraphicConfig) {
		return [
			graphic.themeBindings,
			...graphic.items.flatMap(item => [
				item.themeBindings,
				...(item.type === 'group'
					? item.children.map(child => child.themeBindings)
					: []),
			]),
		];
	}

	it('reads and installs a `.skgraphic`, keeping every binding', () => {
		const document = boundGraphic();
		expect(bindingsOf(document).filter(Boolean).length).toBeGreaterThan(3);

		expect(read(document).outcome).toBe('read');
		expect(bindingsOf(readInstalledBroadcastGraphicDocument(document)!)).toEqual(bindingsOf(document));
	});

	it('reads and installs a `.sklayout`, keeping every binding', () => {
		const layout = boundLayout();

		expect(templatePackagePayloads('sklayout').readInstallableDocument(layout).outcome).toBe('read');
		expect(bindingsOf(readInstalledFeatureMatchLayoutDocument(layout)!.composition)).toEqual(bindingsOf(layout.composition));
	});

	it.each([
		['names a token of another type', 'heading'],
		['names no token', 'retired-accent'],
	])('refuses a binding that %s', (_case, token) => {
		const document = boundGraphic();
		document.items[0] = {
			...document.items[0]!,
			themeBindings: { geometry: token },
		};

		expect(rejectionCodes(document)).toEqual(['invalid-template-document']);
	});
});
