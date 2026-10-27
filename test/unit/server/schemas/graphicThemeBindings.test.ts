import type { StoredThemeTokens } from '~~/shared/modules/theme';
import type { GraphicItemConfig } from '~~/shared/types/graphics';
import type { GraphicThemeSlot } from '~~/shared/types/graphicThemeBindings';
import { describe, expect, it } from 'vitest';
import { broadcastGraphicConfigSchema } from '~~/server/schemas/api/screen';
import {
	bindGraphicThemeOwner,
	graphicThemeOwnerSupportsSlot,
	graphicThemeSlotTokens,
	resolveGraphicThemeTokens,
} from '~~/shared/modules/graphics';
import { GRAPHIC_THEME_SLOT_VALUES } from '~~/shared/types/graphicThemeBindings';
import { gameWins, graphic, group, media, shape, socialIcon, text } from '~~/test/helpers/graphicsComposition';

// Cross-path parity: a composite token's write bounds (`composites.ts`) sit within the
// Screen schema's, so a binding never paints in a value a Screen write would refuse.

const corner = { treatment: 'rounded', size: 10_000 } as const;
const EXTREME: StoredThemeTokens = {
	'accent-fill': {
		type: 'linear-gradient',
		angle: -360,
		stops: [0, 0.3, 0.6, 1].map(position => ({ color: 'rgba(1, 2, 3, 0.5)', position, opacity: 0 })),
	},
	'panel': {
		fill: { type: 'solid', color: '#000' },
		fillOpacity: 0,
		outline: { color: '#fff', width: 500 },
		glow: { color: '#fff', size: 500, opacity: 1 },
	},
	'panel-shape': {
		topLeft: corner,
		topRight: corner,
		bottomRight: corner,
		bottomLeft: corner,
		leftSlant: -10_000,
		rightSlant: 10_000,
	},
	'motion-enter': {
		duration: 10_000,
		easing: 'back-in-out',
		delay: 10_000,
		fade: { opacity: 1 },
		slide: { direction: 'north-west', distanceMode: 'fixed', distance: 10_000 },
		scale: { factor: 2, origin: 'bottom-right' },
		reveal: { edge: 'bottom' },
	},
};

const OWNERS: GraphicItemConfig[] = [
	text('t'),
	shape('s'),
	group('g', []),
	gameWins('w'),
	media('m', { clipGeometry: shape('x').geometry }),
	socialIcon('i'),
];

const CASES = GRAPHIC_THEME_SLOT_VALUES.flatMap(slot => OWNERS
	.filter(owner => graphicThemeOwnerSupportsSlot(owner, slot))
	.flatMap(owner => graphicThemeSlotTokens(slot).map(token => ({ slot, kind: owner.type, owner, token }))));

describe('a Graphic Item bound to a Foundation Token', () => {
	it.each(CASES)('stays a valid Screen write with $slot of a $kind bound to $token at its bounds', ({ slot, owner, token }) => {
		const bound = bindGraphicThemeOwner(owner, slot as GraphicThemeSlot, token, resolveGraphicThemeTokens(EXTREME));

		expect(bound.themeBindings).toEqual({ [slot]: token });
		expect(broadcastGraphicConfigSchema.safeParse(graphic('lower-third', [bound])).error?.issues).toBeUndefined();
	});
});
