import type { ScreenOutput } from '~~/shared/types/screenConfig';
import { screenOutputPath } from '~~/shared/utils/screenOutput';

interface ScreenOutputAccessUrlOptions {
	eventId: number;
	screenId: number;
	screenSlug: string;
	/** Omitted hands out the Overlay Output, which is what a Screen's own URL means. */
	output?: ScreenOutput;
}

/**
 * The URL an operator is handed for a Screen Output, carrying the Screen Output
 * Asset Capability that output has no other route to.
 *
 * **Obtained at the moment it is handed out, never read from a value fetched
 * earlier.** A capability held in page state is absent for as long as its load is in
 * flight, stays absent forever if that load failed, and is stale the instant anyone
 * rotates it — and every one of those produces the *same* URL as a Screen with no
 * media: one that loads, renders, and silently omits every image and video. The
 * output cannot report the loss, because from its side there is nothing to report.
 * That is the failure #231 was found by.
 *
 * **Empty when the capability cannot be obtained**, rather than falling back to the
 * URL without it. Refusing costs an operator a retry and says so; the fallback costs
 * them their media on program and says nothing. A caller passes the empty string
 * straight to its copy or open control, both of which already report having nothing.
 */
export function useScreenOutputAccessUrl() {
	async function screenOutputAccessUrl(
		options: ScreenOutputAccessUrlOptions,
	): Promise<string> {
		try {
			const { assetCapability } = await $fetch<{ assetCapability: string }>(
				`/api/events/${options.eventId}/screens/${options.screenId}/asset-capability`,
			);
			return `${window.location.origin}${screenOutputPath({
				eventId: options.eventId,
				screenSlug: options.screenSlug,
				output: options.output,
				assetCapability,
			})}`;
		}
		catch {
			return '';
		}
	}

	/**
	 * Opens the tab first and points it afterwards, because the fetch above lands in
	 * a later task than the click that started it and a popup blocker refuses a
	 * window opened there.
	 */
	async function openScreenOutput(options: ScreenOutputAccessUrlOptions): Promise<void> {
		const outputWindow = window.open('', '_blank');
		if (outputWindow)
			outputWindow.opener = null;
		const url = await screenOutputAccessUrl(options);
		if (url && outputWindow)
			outputWindow.location.href = url;
		else
			outputWindow?.close();
	}

	return { screenOutputAccessUrl, openScreenOutput };
}
