import { describe, expect, it } from 'vitest';
import { broadcastGraphicsModeConfigSchema } from '~~/server/schemas/api/screen';
import { addGraphicGroupChild, addGraphicItem, parseGraphicTextTemplate } from '~~/shared/modules/graphics';
import { readGraphicsPreviewState } from '~/modules/graphics/previewMessages';

const SQUARE = { treatment: 'square' as const, size: 0 };
const GEOMETRY = {
	topLeft: SQUARE,
	topRight: SQUARE,
	bottomRight: SQUARE,
	bottomLeft: SQUARE,
	leftSlant: 0,
	rightSlant: 0,
};

function presentationGroup(id: string) {
	return {
		type: 'group' as const,
		id,
		label: id,
		visible: true,
		anchor: 'top-left' as const,
		x: 0,
		y: 0,
		width: 640,
		height: 120,
		arrangement: 'row' as const,
		padding: 0,
		gap: 16,
		align: 'center' as const,
		justify: 'start' as const,
		clip: false,
		geometry: GEOMETRY,
		children: [],
	};
}

function projectedGraphic() {
	return {
		id: 'lower-third',
		name: 'Talent lower third',
		items: [presentationGroup('profile-group')],
		sources: [{ key: 'talent', label: 'Talent', kind: 'talent' as const }],
		socialProfileProjections: [{
			key: 'profile',
			label: 'Profile',
			sourceKey: 'talent',
			presentationGroupId: 'profile-group',
			dwellMs: 8_000,
			transition: 'crossfade' as const,
			transitionDurationMs: 250,
		}],
	};
}

describe('social Profile Projection document validation', () => {
	it('derives representative Social Profile values for an authoring preview without persisting them', () => {
		const graphic = projectedGraphic();
		const state = readGraphicsPreviewState({
			graphics: [graphic],
			selectedTarget: { type: 'canvas' },
		});

		expect((state as typeof state & { socialProfileValues?: unknown }).socialProfileValues).toEqual({
			'lower-third': {
				profile: {
					network: 'twitch',
					networkLabel: 'Twitch',
					handle: 'example',
					profileUrl: 'https://www.twitch.tv/example',
				},
			},
		});
		expect(graphic).not.toHaveProperty('socialProfileValues');
	});

	it('parses projected text references as existing placeholder runs', () => {
		expect(parseGraphicTextTemplate(
			'On {profile.networkLabel} as {profile.handle}',
			new Set(['profile']),
		)).toEqual([
			{ text: 'On ' },
			{ text: '', inputKey: 'profile.networkLabel' },
			{ text: ' as ' },
			{ text: '', inputKey: 'profile.handle' },
		]);
	});

	it('preserves projection-shaped literal text in a document with no projections', () => {
		const graphic = addGraphicItem(
			{ id: 'plain', name: 'Plain', items: [] },
			{ kind: 'text', id: 'plain-text', canvasWidth: 1920, canvasHeight: 1080 },
		).graphic;
		const text = graphic.items[0];
		if (text?.type !== 'text')
			throw new Error('expected a Text Graphic Item');
		text.text = 'Literal {profile.handle}';

		expect(broadcastGraphicsModeConfigSchema.safeParse({ graphics: [graphic], channels: [] }).success).toBe(true);
	});

	it('accepts multiple named projections onto distinct Presentation Groups', () => {
		const result = broadcastGraphicsModeConfigSchema.safeParse({
			graphics: [{
				id: 'lower-thirds',
				name: 'Talent lower thirds',
				items: [presentationGroup('left-profile'), presentationGroup('right-profile')],
				sources: [
					{ key: 'left-talent', label: 'Left Talent', kind: 'talent' },
					{ key: 'right-talent', label: 'Right Talent', kind: 'talent' },
				],
				socialProfileProjections: [
					{
						key: 'left-profile',
						label: 'Left Profile',
						sourceKey: 'left-talent',
						presentationGroupId: 'left-profile',
						dwellMs: 8_000,
						transition: 'crossfade',
						transitionDurationMs: 250,
					},
					{
						key: 'right-profile',
						label: 'Right Profile',
						sourceKey: 'right-talent',
						presentationGroupId: 'right-profile',
						dwellMs: 12_000,
						transition: 'slide-left',
						transitionDurationMs: 400,
					},
				],
			}],
			channels: [],
		});

		expect(result.success).toBe(true);
	});

	it('requires unique stable projection keys', () => {
		const invalid = projectedGraphic();
		invalid.socialProfileProjections[0]!.key = 'profile.key';
		const duplicate = projectedGraphic();
		duplicate.socialProfileProjections.push({
			...duplicate.socialProfileProjections[0]!,
			presentationGroupId: 'other-group',
		});
		duplicate.items.push(presentationGroup('other-group'));

		expect(broadcastGraphicsModeConfigSchema.safeParse({ graphics: [invalid], channels: [] }).success).toBe(false);
		expect(broadcastGraphicsModeConfigSchema.safeParse({ graphics: [duplicate], channels: [] }).success).toBe(false);
	});

	it('refuses a projection whose source is missing, non-Talent, or a fixed Event Talent record', () => {
		const missing = projectedGraphic();
		missing.socialProfileProjections[0]!.sourceKey = 'missing';
		const nonTalent = projectedGraphic();
		nonTalent.sources[0]!.kind = 'player' as 'talent';
		const fixedTalent = {
			...projectedGraphic(),
			socialProfileProjections: [{
				...projectedGraphic().socialProfileProjections[0]!,
				talentId: 42,
			}],
		};

		expect(broadcastGraphicsModeConfigSchema.safeParse({ graphics: [missing], channels: [] }).success).toBe(false);
		expect(broadcastGraphicsModeConfigSchema.safeParse({ graphics: [nonTalent], channels: [] }).success).toBe(false);
		expect(broadcastGraphicsModeConfigSchema.safeParse({ graphics: [fixedTalent], channels: [] }).success).toBe(false);
	});

	it('requires a distinct ordinary Graphic Group for every projection', () => {
		const missing = projectedGraphic();
		missing.socialProfileProjections[0]!.presentationGroupId = 'missing';
		const nonGroup = projectedGraphic();
		nonGroup.items = [{
			...presentationGroup('profile-group'),
			type: 'shape' as 'group',
			children: undefined as never,
		}];
		const shared = projectedGraphic();
		shared.socialProfileProjections.push({
			...shared.socialProfileProjections[0]!,
			key: 'other-profile',
		});

		expect(broadcastGraphicsModeConfigSchema.safeParse({ graphics: [missing], channels: [] }).success).toBe(false);
		expect(broadcastGraphicsModeConfigSchema.safeParse({ graphics: [nonGroup], channels: [] }).success).toBe(false);
		expect(broadcastGraphicsModeConfigSchema.safeParse({ graphics: [shared], channels: [] }).success).toBe(false);
	});

	it('pins the projection timing bounds and stable transition vocabulary', () => {
		for (const [field, values] of [
			['dwellMs', [1_999, 60_001]],
			['transitionDurationMs', [99, 2_001]],
		] as const) {
			for (const value of values) {
				const graphic = projectedGraphic();
				graphic.socialProfileProjections[0]![field] = value;
				expect(broadcastGraphicsModeConfigSchema.safeParse({ graphics: [graphic], channels: [] }).success).toBe(false);
			}
		}
		const invalidTransition = projectedGraphic();
		invalidTransition.socialProfileProjections[0]!.transition = 'zoom' as 'crossfade';

		expect(broadcastGraphicsModeConfigSchema.safeParse({ graphics: [invalidTransition], channels: [] }).success).toBe(false);
	});

	it('accepts projected text references and a dynamic icon inside the Presentation Group', () => {
		let graphic = addGraphicGroupChild(projectedGraphic(), {
			kind: 'text',
			groupId: 'profile-group',
			id: 'profile-handle',
		}).graphic;
		graphic = addGraphicGroupChild(graphic, {
			kind: 'social-network-icon',
			groupId: 'profile-group',
			id: 'profile-icon',
		}).graphic;
		const group = graphic.items[0]!;
		if (group.type !== 'group')
			throw new Error('expected the Presentation Group');
		const text = group.children.find(child => child.type === 'text');
		if (text?.type !== 'text')
			throw new Error('expected projected text');
		text.text = '{profile.networkLabel} — {profile.handle} — {profile.profileUrl}';
		const icon = group.children.find(child => child.type === 'social-network-icon');
		if (icon?.type !== 'social-network-icon')
			throw new Error('expected projected icon');
		icon.network = { projectionKey: 'profile' } as never;

		expect(broadcastGraphicsModeConfigSchema.safeParse({ graphics: [graphic], channels: [] }).success).toBe(true);
	});

	it('rejects dangling, unsupported, or out-of-group projected text and icon references', () => {
		const danglingText = addGraphicGroupChild(projectedGraphic(), {
			kind: 'text',
			groupId: 'profile-group',
			id: 'profile-handle',
		}).graphic;
		const group = danglingText.items[0];
		if (group?.type !== 'group' || group.children[0]?.type !== 'text')
			throw new Error('expected projected text');
		group.children[0].text = '{missing.handle}';
		const unsupportedText = structuredClone(danglingText);
		const unsupportedGroup = unsupportedText.items[0];
		if (unsupportedGroup?.type !== 'group' || unsupportedGroup.children[0]?.type !== 'text')
			throw new Error('expected projected text');
		unsupportedGroup.children[0].text = '{profile.network}';
		const topLevelDangling = addGraphicItem(projectedGraphic(), {
			kind: 'text',
			id: 'outside-text',
			canvasWidth: 1920,
			canvasHeight: 1080,
		}).graphic;
		const outsideText = topLevelDangling.items.find(item => item.id === 'outside-text');
		if (outsideText?.type !== 'text')
			throw new Error('expected top-level projected text');
		outsideText.text = '{missing.handle}';

		const outOfGroup = addGraphicItem(projectedGraphic(), {
			kind: 'social-network-icon',
			id: 'outside-icon',
			canvasWidth: 1920,
			canvasHeight: 1080,
		}).graphic;
		const outsideIcon = outOfGroup.items.find(item => item.id === 'outside-icon');
		if (outsideIcon?.type !== 'social-network-icon')
			throw new Error('expected dynamic icon');
		outsideIcon.network = { projectionKey: 'profile' };

		expect(broadcastGraphicsModeConfigSchema.safeParse({ graphics: [danglingText], channels: [] }).success).toBe(false);
		expect(broadcastGraphicsModeConfigSchema.safeParse({ graphics: [unsupportedText], channels: [] }).success).toBe(false);
		expect(broadcastGraphicsModeConfigSchema.safeParse({ graphics: [topLevelDangling], channels: [] }).success).toBe(false);
		expect(broadcastGraphicsModeConfigSchema.safeParse({ graphics: [outOfGroup], channels: [] }).success).toBe(false);
	});

	it('bounds the total Social Profile Projections on one Broadcast Graphics Screen', () => {
		const graphics = Array.from({ length: 3 }, (_, graphicIndex) => ({
			id: `graphic-${graphicIndex}`,
			name: `Graphic ${graphicIndex}`,
			items: Array.from({ length: 24 }, (_, projectionIndex) =>
				presentationGroup(`group-${graphicIndex}-${projectionIndex}`)),
			sources: [{ key: 'talent', label: 'Talent', kind: 'talent' as const }],
			socialProfileProjections: Array.from({ length: 24 }, (_, projectionIndex) => ({
				key: `profile-${projectionIndex}`,
				label: `Profile ${projectionIndex}`,
				sourceKey: 'talent',
				presentationGroupId: `group-${graphicIndex}-${projectionIndex}`,
				dwellMs: 8_000,
				transition: 'crossfade' as const,
				transitionDurationMs: 250,
			})),
		}));

		expect(broadcastGraphicsModeConfigSchema.safeParse({ graphics, channels: [] }).success).toBe(false);
	});
});
