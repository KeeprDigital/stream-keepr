import type { Phase, Round } from '~/types';

export type RoundLabelStyle = 'short' | 'phase';

export function formatRoundLabel(
	round: Pick<Round, 'name' | 'phaseId'> | null | undefined,
	phase?: Pick<Phase, 'name'> | null,
	options: { style?: RoundLabelStyle; separator?: string } = {},
): string {
	if (!round)
		return 'No round selected';

	const style = options.style ?? 'short';
	if (style === 'phase' && phase?.name) {
		return `${phase.name}${options.separator ?? ' - '}${round.name}`;
	}

	return round.name;
}

export function formatRoundOptionLabel(
	round: Pick<Round, 'name' | 'phaseId'>,
	phase?: Pick<Phase, 'name'> | null,
): string {
	return formatRoundLabel(round, phase, { style: 'short' });
}

/**
 * The Event's Rounds as a Round picker lists them (#911): in Round order (Phase
 * sort order, round number, id), each named "Phase · Round" so Rounds sharing a
 * name across Phases stay apart. A Round whose Phase is unknown shows its own
 * name, last.
 */
export function roundPickerOptions(
	rounds: readonly Pick<Round, 'id' | 'name' | 'phaseId' | 'roundNumber'>[],
	phases: readonly Pick<Phase, 'id' | 'name' | 'sortOrder'>[],
): { label: string; value: number }[] {
	const phaseById = new Map(phases.map(phase => [phase.id, phase]));
	const phaseOrder = (round: Pick<Round, 'phaseId'>) => phaseById.get(round.phaseId)?.sortOrder ?? Infinity;
	return rounds
		.toSorted((a, b) => phaseOrder(a) - phaseOrder(b) || a.roundNumber - b.roundNumber || a.id - b.id)
		.map(round => ({
			label: formatRoundLabel(round, phaseById.get(round.phaseId), { style: 'phase', separator: ' · ' }),
			value: round.id,
		}));
}
