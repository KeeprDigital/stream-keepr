import type { TcgPlusImportAnswer, TcgPlusImportPreview } from '~~/shared/types/tcgPlusImport';
import { useEventDataFetch } from '~/modules/event-data/client';

/** The TCG+ Import (ADR-0074): an export previewed, then imported. */
export function useTcgPlusImportRepository() {
	const eventData = useEventDataFetch();

	/** What importing the export would change. Saves nothing. */
	const preview = async (eventId: number, csv: string) =>
		await eventData.command<TcgPlusImportPreview, { csv: string }>(
			{ eventId, resourcePath: 'tcgplus', suffix: 'preview' },
			{
				method: 'POST',
				body: { csv },
			},
		);

	const commit = async (eventId: number, csv: string) =>
		await eventData.command<TcgPlusImportAnswer, { csv: string }>(
			{ eventId, resourcePath: 'tcgplus', suffix: 'import' },
			{
				method: 'POST',
				body: { csv },
			},
		);

	return { preview, commit };
}
