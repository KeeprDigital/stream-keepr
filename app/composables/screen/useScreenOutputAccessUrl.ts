import type { ScreenOutput } from '~~/shared/types/screenConfig';
import { screenOutputPath } from '~~/shared/utils/screenOutput';

interface ScreenOutputAccessUrlOptions {
	eventId: number;
	screenId: number;
	screenSlug: string;
	/** Omitted hands out the Overlay Output, which is what a Screen's own URL means. */
	output?: ScreenOutput;
	/**
	 * Capture the output as a PNG from a temporary tab.
	 *
	 * A capture is a hand-out like any other, and one whose loss is even quieter: the
	 * PNG arrives, looks like a rendered output, and is missing every image, video and
	 * library font the Screen publishes.
	 */
	download?: boolean;
}

/**
 * What became of an attempt to open a Screen Output in a tab.
 *
 * Three outcomes rather than a boolean because each one is a different thing for the
 * operator to do: nothing, retry, or allow pop-ups for this site. Naming them here
 * rather than at each caller is what stops the two hand-out surfaces drifting into
 * two vocabularies for the same refusal.
 */
export type ScreenOutputOpenResult = 'opened' | 'access-refused' | 'window-blocked';

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
				download: options.download,
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
	 *
	 * Answers which of the three things happened, so a caller that promised the
	 * operator something — a download, most of all — can say that it is not coming
	 * and, as importantly, what to do about it. A single boolean could not: both read it as
	 * an asset access refusal, so a browser that blocked the tab told the operator to
	 * retry a hand-out that would be blocked identically next time, in words this
	 * function's own docstring already said were the wrong ones (#237, #250, #258).
	 *
	 * A blocked window is answered before the capability is asked for. There is
	 * nowhere to hand one to, and the operator's next move is in their browser rather
	 * than on this page either way.
	 */
	async function openScreenOutput(options: ScreenOutputAccessUrlOptions): Promise<ScreenOutputOpenResult> {
		const outputWindow = window.open('', '_blank');
		if (!outputWindow)
			return 'window-blocked';

		outputWindow.opener = null;
		const url = await screenOutputAccessUrl(options);
		if (!url) {
			outputWindow.close();
			return 'access-refused';
		}

		outputWindow.location.href = url;
		return 'opened';
	}

	return { screenOutputAccessUrl, openScreenOutput };
}
