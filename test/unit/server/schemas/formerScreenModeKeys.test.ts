import { describe, expect, it } from 'vitest';
import { createScreenSchema, modeConfigParamsSchema, updateScreenSchema } from '~~/server/schemas/api/screen';

/**
 * Top Cut Bracket's Screen Mode key was `topCut` and is `top-cut` (#773, ADR-0043). A tab
 * or Screen Output still running a build from before the rename sends the former
 * key; a Screen write accepts it as the current one and never stores it.
 */
describe('a former Screen Mode key on a Screen write', () => {
	it('names the current mode in a mode configuration PATCH route', () => {
		expect(modeConfigParamsSchema.parse({ id: '1', screenId: '2', mode: 'topCut' }).mode).toBe('top-cut');
	});

	it('names the current mode as a full update\'s current mode and mode configuration key', () => {
		const input = updateScreenSchema.parse({
			stateVersion: 3,
			currentMode: 'topCut',
			modeConfigs: {
				topCut: { phaseId: 4 },
				standings: { rowsPerPage: 8 },
			},
		});

		expect(input.currentMode).toBe('top-cut');
		expect(input.modeConfigs).toEqual({
			'top-cut': { phaseId: 4 },
			'standings': { rowsPerPage: 8 },
		});
	});

	it('names the current mode on Screen create', () => {
		const input = createScreenSchema.parse({
			name: 'Bracket',
			slug: 'bracket',
			currentMode: 'topCut',
			modeConfigs: {
				topCut: { phaseId: 4 },
			},
		});

		expect(input.currentMode).toBe('top-cut');
		expect(input.modeConfigs).toEqual({
			'top-cut': { phaseId: 4 },
		});
	});

	it('keeps the current key\'s config when a write carries both keys', () => {
		const input = updateScreenSchema.parse({
			stateVersion: 3,
			modeConfigs: {
				'topCut': { phaseId: 4 },
				'top-cut': { phaseId: 5 },
			},
		});

		expect(input.modeConfigs).toEqual({
			'top-cut': { phaseId: 5 },
		});
	});

	it('still refuses a key that never named a Screen Mode', () => {
		expect(modeConfigParamsSchema.safeParse({ id: '1', screenId: '2', mode: 'topcut' }).success).toBe(false);
		expect(updateScreenSchema.safeParse({ stateVersion: 3, currentMode: 'TopCut' }).success).toBe(false);
		expect(updateScreenSchema.safeParse({
			stateVersion: 3,
			modeConfigs: { top_cut: {} },
		}).success).toBe(false);
	});
});
