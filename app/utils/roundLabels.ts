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
