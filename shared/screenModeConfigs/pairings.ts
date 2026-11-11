import type { ScreenModeConfigOf } from './contract';
import { z } from 'zod';
import { defineScreenModeConfigContract } from './contract';
import { editorField, withEditorMeta } from './fields';
import { DEFAULT_HEADER_CONFIG, DEFAULT_PAGE_ROTATION, headerConfigShape, pageRotationPageSize, pageRotationShape } from './subShapes';

/** The Pairings Screen Mode's config contract: its shape, type, and defaults. */
export const pairingsModeConfigContract = defineScreenModeConfigContract({
	/** The Round whose Matches are shown; an Event Reference (ADR-0038). */
	roundId: editorField(z.number().int().positive().optional(), {
		label: 'Round',
		card: 'source',
		reference: 'round',
		placeholder: 'Select a Round…',
		description: 'The Round whose pairings show.',
	}),
	...headerConfigShape({
		shows: 'Show the Round\'s name above the pairings.',
		auto: 'Empty shows the Round\'s name and "Pairings".',
	}),
	rowsPerPage: withEditorMeta(pageRotationPageSize, { description: 'Pairings on each page.' }),
	...pageRotationShape,
}, {
	roundId: undefined,
	...DEFAULT_HEADER_CONFIG,
	rowsPerPage: 10,
	...DEFAULT_PAGE_ROTATION,
}, {
	groups: {
		'result-badge': { title: 'Result badge', card: 'content' },
	},
});

export type PairingsModeConfig = ScreenModeConfigOf<typeof pairingsModeConfigContract>;
