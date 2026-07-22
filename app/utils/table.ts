import type { TableColumn } from '@nuxt/ui';
import { sortByManaCost } from '~~/shared/utils/manaCostSort';
import { getCardTypeDisplayLabel } from '~~/shared/utils/metagame';
import { MtgManaColorDisplay, UButton } from '#components';

/**
 * Creates a sortable column header render function for use with UTable.
 *
 * UTable does not render sort affordances automatically — column headers must
 * explicitly wire `column.getToggleSortingHandler()` to a click handler and
 * reflect `column.getIsSorted()` as a visual indicator.
 *
 * Usage:
 *   { accessorKey: 'name', header: createSortableHeader('Name'), enableSorting: true }
 */
export function createSortableHeader(label: string) {
	return ({ column }: { column: any }) => {
		const sortDirection = column.getIsSorted();
		const trailingIcon = sortDirection === 'asc'
			? 'i-lucide-arrow-up'
			: sortDirection === 'desc'
				? 'i-lucide-arrow-down'
				: 'i-lucide-arrow-up-down';

		return h(UButton, {
			label,
			variant: 'ghost',
			color: 'neutral',
			trailingIcon,
			size: 'xs',
			onClick: column.getToggleSortingHandler(),
		});
	};
}

// ── Shared card column factories ─────────────────────────────────────────────
//
// Use these for columns that appear across multiple card tables to keep cell
// rendering consistent and avoid repeating slot templates.

/** Card/entity name column — renders in `font-medium`. Label defaults to 'Card'. */
export function createNameColumn<T extends { name: string }>(label = 'Card'): TableColumn<T> {
	return {
		accessorKey: 'name' as keyof T & string,
		header: createSortableHeader(label),
		enableSorting: true,
		cell: ({ row }: { row: { original: T } }) =>
			h('span', { class: 'font-medium' }, row.original.name),
	};
}

/** Mana cost column — renders `MtgManaColorDisplay` or an em dash for null. */
export function createManaCostColumn<T extends { manaCost: string | null; cmc?: number | null; colors?: string | null }>(): TableColumn<T> {
	return {
		accessorKey: 'manaCost' as keyof T & string,
		header: createSortableHeader('Cost'),
		enableSorting: true,
		sortingFn: (rowA, rowB) => sortByManaCost(
			rowA.original as { cmc?: number | null; colors?: string | null },
			rowB.original as { cmc?: number | null; colors?: string | null },
		),
		cell: ({ row }: { row: { original: T } }) => {
			const cost = row.original.manaCost;
			return cost
				? h(MtgManaColorDisplay, { manaCost: cost, size: 'xs' })
				: h('span', { class: 'text-muted' }, '—');
		},
	};
}

/** Card type column — renders in `text-sm text-muted`, falls back to '-'. */
export function createCardTypeColumn<T extends { cardType: string | null }>(): TableColumn<T> {
	return {
		accessorFn: row => getCardTypeDisplayLabel(row.cardType, { nonbasicLandLabel: true }),
		id: 'cardType',
		header: createSortableHeader('Type'),
		enableSorting: true,
		cell: ({ row }: { row: { original: T } }) =>
			h('span', { class: 'text-sm text-muted' }, getCardTypeDisplayLabel(row.original.cardType, { nonbasicLandLabel: true })),
	};
}

/** Deck count column — renders in `tabular-nums`. */
export function createDeckCountColumn<T extends { deckCount: number }>(): TableColumn<T> {
	return {
		accessorKey: 'deckCount' as keyof T & string,
		header: createSortableHeader('Decks'),
		enableSorting: true,
		cell: ({ row }: { row: { original: T } }) =>
			h('span', { class: 'tabular-nums' }, String(row.original.deckCount)),
	};
}
