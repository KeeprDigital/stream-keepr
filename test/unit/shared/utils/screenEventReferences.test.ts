import { describe, expect, it } from 'vitest';
import { screensNamingEventReference } from '~~/shared/utils/screenEventReferences';

const screen = (id: number, modeConfigs: Record<string, Record<string, unknown>>) => ({ id, modeConfigs });

describe('the Screens naming a record in an Event Reference', () => {
	const screens = [
		screen(1, {
			'archetype-spotlight': { archetypeId: 7 },
		}),
		screen(2, {
			'archetype-spotlight': { archetypeId: 8 },
		}),
		// A Round of the same id is another record.
		screen(3, {
			standings: { roundId: 7 },
		}),
		screen(4, {}),
	];

	it.each([
		[
			'an Archetype one Screen names',
			'archetype',
			7,
			[1],
		],
		[
			'a Round of the same id',
			'round',
			7,
			[3],
		],
		[
			'an Archetype no Screen names',
			'archetype',
			9,
			[],
		],
	] as const)('finds those naming %s', (_case, kind, id, screenIds) => {
		expect(screensNamingEventReference(screens, kind, id).map(found => found.id)).toEqual(screenIds);
	});
});
