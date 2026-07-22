import type { DeckListStats, ManaCurve, ManaPipCounts } from '~~/shared/types/deckList';

const MANA_SYMBOL_RE = /\{[^}]+\}/g;

// ── Minimal structural types ─────────────────────────────────────────────────
// Satisfied by both DeckListCard and PlayerDeckCardEntry.

interface StatCard {
	compartment: string;
	cardType?: string | null;
	quantity: number;
}

interface PipCard {
	compartment: string;
	manaCost?: string | null;
	quantity: number;
}

interface CurveCard {
	compartment: string;
	cardType?: string | null;
	cmc?: number | null;
	quantity: number;
}

// ── Private helpers ──────────────────────────────────────────────────────────

function isNonMdfcLand(cardType?: string | null): boolean {
	const type = cardType?.toLowerCase() ?? '';
	return type.includes('land') && !type.includes('//');
}

function countPipsFromManaCost(manaCost: string): ManaPipCounts {
	const counts: ManaPipCounts = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
	const symbols = manaCost.match(MANA_SYMBOL_RE) ?? [];

	for (const symbol of symbols) {
		const inner = symbol.slice(1, -1); // remove braces

		if (inner.includes('/')) {
			// Hybrid (W/U, 2/W) or Phyrexian (W/P) — count each color part
			const parts = inner.split('/');
			for (const part of parts) {
				if (part in counts)
					counts[part as keyof ManaPipCounts]++;
			}
		}
		else if (inner in counts) {
			counts[inner as keyof ManaPipCounts]++;
		}
	}

	return counts;
}

// ── Exports ──────────────────────────────────────────────────────────────────

/**
 * Count mainboard cards by card type.
 * Usable on both DeckListCard[] and PlayerDeckCardEntry[].
 */
export function calculateDeckStats(cards: StatCard[]): DeckListStats {
	const stats: DeckListStats = {
		creatures: 0,
		instants: 0,
		sorceries: 0,
		enchantments: 0,
		artifacts: 0,
		planeswalkers: 0,
		lands: 0,
		other: 0,
	};

	for (const card of cards) {
		if (card.compartment !== 'mainboard')
			continue;

		const type = card.cardType?.toLowerCase() ?? '';
		const qty = card.quantity;

		if (type.includes('creature'))
			stats.creatures += qty;
		else if (type.includes('instant'))
			stats.instants += qty;
		else if (type.includes('sorcery'))
			stats.sorceries += qty;
		else if (type.includes('enchantment'))
			stats.enchantments += qty;
		else if (type.includes('artifact'))
			stats.artifacts += qty;
		else if (type.includes('planeswalker'))
			stats.planeswalkers += qty;
		else if (type.includes('land'))
			stats.lands += qty;
		else if (type)
			stats.other += qty;
	}

	return stats;
}

/**
 * Count mana pips (WUBRG + colorless) from mainboard card mana costs.
 * Reads manaCost directly from each card entry.
 * Usable on both DeckListCard[] and PlayerDeckCardEntry[] (once manaCost is populated).
 */
export function calculateDeckPips(cards: PipCard[]): ManaPipCounts {
	const totals: ManaPipCounts = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };

	for (const card of cards) {
		if (card.compartment !== 'mainboard' || !card.manaCost)
			continue;

		const cardPips = countPipsFromManaCost(card.manaCost);
		totals.W += cardPips.W * card.quantity;
		totals.U += cardPips.U * card.quantity;
		totals.B += cardPips.B * card.quantity;
		totals.R += cardPips.R * card.quantity;
		totals.G += cardPips.G * card.quantity;
		totals.C += cardPips.C * card.quantity;
	}

	return totals;
}

/** Cards with CMC >= this value are bucketed together under this key. */
export const CURVE_MAX_BUCKET = 9;

/**
 * Build a mana curve from mainboard cards.
 * Keys are CMC values; CMC >= CURVE_MAX_BUCKET is bucketed under that key.
 * Returns only buckets that have at least one card.
 */
export function calculateDeckCurve(cards: CurveCard[]): ManaCurve {
	const curve: ManaCurve = {};

	for (const card of cards) {
		if (card.compartment !== 'mainboard')
			continue;
		if (card.cmc == null)
			continue;
		if (isNonMdfcLand(card.cardType))
			continue;

		const bucket = Math.min(Math.floor(card.cmc), CURVE_MAX_BUCKET);
		curve[bucket] = (curve[bucket] ?? 0) + card.quantity;
	}

	return curve;
}

/**
 * Format DeckListStats as a display array, omitting zero-count categories.
 * Usable on both panel and modal contexts.
 */
export function formatStats(stats: DeckListStats | undefined): Array<{ type: string; count: number }> {
	if (!stats)
		return [];
	const result: Array<{ type: string; count: number }> = [];
	if (stats.creatures > 0)
		result.push({ type: 'Creatures', count: stats.creatures });
	if (stats.instants > 0)
		result.push({ type: 'Instants', count: stats.instants });
	if (stats.sorceries > 0)
		result.push({ type: 'Sorceries', count: stats.sorceries });
	if (stats.enchantments > 0)
		result.push({ type: 'Enchantments', count: stats.enchantments });
	if (stats.artifacts > 0)
		result.push({ type: 'Artifacts', count: stats.artifacts });
	if (stats.planeswalkers > 0)
		result.push({ type: 'Planeswalkers', count: stats.planeswalkers });
	if (stats.lands > 0)
		result.push({ type: 'Lands', count: stats.lands });
	if (stats.other > 0)
		result.push({ type: 'Other', count: stats.other });
	return result;
}

/**
 * Format ManaPipCounts as a display array, omitting zero-count colors.
 * Returned in WUBRG+C order.
 */
export function formatPips(pips: ManaPipCounts | undefined): Array<{ color: string; count: number }> {
	if (!pips)
		return [];
	const result: Array<{ color: string; count: number }> = [];
	if (pips.W > 0)
		result.push({ color: 'W', count: pips.W });
	if (pips.U > 0)
		result.push({ color: 'U', count: pips.U });
	if (pips.B > 0)
		result.push({ color: 'B', count: pips.B });
	if (pips.R > 0)
		result.push({ color: 'R', count: pips.R });
	if (pips.G > 0)
		result.push({ color: 'G', count: pips.G });
	if (pips.C > 0)
		result.push({ color: 'C', count: pips.C });
	return result;
}
