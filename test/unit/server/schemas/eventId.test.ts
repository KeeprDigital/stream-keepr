import { describe, expect, it } from 'vitest';
import { archetypeParamsSchema } from '~~/server/schemas/api/archetype';
import { broadcastDeckListParamsSchema } from '~~/server/schemas/api/broadcastDeckList';
import { eventParamsSchema } from '~~/server/schemas/api/event';
import { eventIdParamSchema } from '~~/server/schemas/api/eventId';
import { featureMatchSessionParamsSchema, featureMatchSlotParamsSchema } from '~~/server/schemas/api/featureMatch';
import { featureMatchDeckListParamsSchema } from '~~/server/schemas/api/featureMatchDeckList';
import { matchParamsSchema } from '~~/server/schemas/api/match';
import {
	metagameArchetypeParamsSchema,
	metagameCardParamsSchema,
	metagameParamsSchema,
} from '~~/server/schemas/api/metagame';
import { opCardParamsSchema } from '~~/server/schemas/api/opCard';
import { phaseParamsSchema } from '~~/server/schemas/api/phase';
import { playerParamsSchema } from '~~/server/schemas/api/player';
import { playerListMemberParamsSchema, playerListParamsSchema } from '~~/server/schemas/api/playerList';
import { roundParamsSchema } from '~~/server/schemas/api/round';
import { modeConfigParamsSchema, screenParamsSchema } from '~~/server/schemas/api/screen';
import { talentParamsSchema } from '~~/server/schemas/api/talent';

// An Event id in a path is a strict positive decimal integer, the grammar the
// `event-exists` middleware checks existence for. A spelling `Number()` would
// coerce (`9e9`, `0x10`) must not name an Event to a handler.
describe('the Event id param', () => {
	it.each([
		['1', 1],
		['42', 42],
		['9007199254740991', Number.MAX_SAFE_INTEGER],
	])('reads %s as %d', (spelling, id) => {
		expect(eventIdParamSchema.parse(spelling)).toBe(id);
	});

	it.each([
		'9e9',
		'0x10',
		'0b11',
		'0',
		'01',
		'-1',
		'+1',
		'1.0',
		' 1',
		'1 ',
		'',
		'9007199254740993',
		'Infinity',
	])('refuses %j', (spelling) => {
		expect(eventIdParamSchema.safeParse(spelling).success).toBe(false);
	});

	// Cross-path parity: every params schema whose `id` is the Event's reads it
	// by this grammar.
	it.each([
		['eventParamsSchema', eventParamsSchema],
		['archetypeParamsSchema', archetypeParamsSchema],
		['broadcastDeckListParamsSchema', broadcastDeckListParamsSchema],
		['featureMatchSlotParamsSchema', featureMatchSlotParamsSchema],
		['featureMatchSessionParamsSchema', featureMatchSessionParamsSchema],
		['featureMatchDeckListParamsSchema', featureMatchDeckListParamsSchema],
		['matchParamsSchema', matchParamsSchema],
		['metagameParamsSchema', metagameParamsSchema],
		['metagameArchetypeParamsSchema', metagameArchetypeParamsSchema],
		['metagameCardParamsSchema', metagameCardParamsSchema],
		['opCardParamsSchema', opCardParamsSchema],
		['phaseParamsSchema', phaseParamsSchema],
		['playerParamsSchema', playerParamsSchema],
		['playerListParamsSchema', playerListParamsSchema],
		['playerListMemberParamsSchema', playerListMemberParamsSchema],
		['roundParamsSchema', roundParamsSchema],
		['screenParamsSchema', screenParamsSchema],
		['modeConfigParamsSchema', modeConfigParamsSchema],
		['talentParamsSchema', talentParamsSchema],
	])('%s admits "7" and refuses "9e9" as its Event', (_name, schema) => {
		expect(schema.shape.id.safeParse('7')).toMatchObject({ success: true, data: 7 });
		expect(schema.shape.id.safeParse('9e9').success).toBe(false);
	});
});
