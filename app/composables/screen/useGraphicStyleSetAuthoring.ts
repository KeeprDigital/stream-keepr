import type { MaybeRefOrGetter } from 'vue';
import type { GraphicStyleSetResolution } from '~~/shared/modules/graphic-style-sets';
import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import type { GraphicStyleSetEntry, GraphicStyleSetSummary } from '~~/shared/types/graphicStyleSet';
import { resolveGraphicStyleSet } from '~~/shared/modules/graphic-style-sets';

/**
 * The published Graphic Style Set a composition's property controls author against.
 *
 * Deliberately the *published* entries, never the working draft. An author editing a
 * palette must not have their draft leak into the compositions they are laying out —
 * a draft is referentially broken for most of its life, and every property control
 * that offered its entries would be offering things a publish has not yet proved.
 */
export interface GraphicStyleAuthoringContext {
	id: string;
	name: string;
	entries: GraphicStyleSetEntry[];
	resolution: GraphicStyleSetResolution;
}

/**
 * Loads the Graphic Style Set the selected Broadcast Graphic is linked to, and the
 * library listing an author picks a link from.
 *
 * One Style Set at a time, because a composition links to at most one. The listing is
 * loaded separately and is only names: linking is a choice between Style Sets, and
 * pulling every set's entries to render a list of names would grow with the size of
 * the styles rather than with their number.
 */
export function useGraphicStyleSetAuthoring(
	graphic: MaybeRefOrGetter<BroadcastGraphicConfig | null | undefined>,
) {
	const repository = useGraphicStyleSetRepository();

	const styleSets = ref<GraphicStyleSetSummary[]>([]);
	const context = ref<GraphicStyleAuthoringContext | null>(null);
	const loading = ref(false);
	const error = ref<string | null>(null);

	const linkedId = computed(() => toValue(graphic)?.styleSet?.styleSetId ?? null);

	async function refreshLibrary() {
		try {
			styleSets.value = await repository.list();
		}
		catch {
			// A library listing that will not load leaves linking unavailable rather than
			// failing the workspace: everything already authored keeps its own values.
			styleSets.value = [];
		}
	}

	/**
	 * Reload the linked Style Set.
	 *
	 * A Style Set that fails to load, or one with no published revision, leaves the
	 * context null — which the property controls read as "offer no pickers". That is
	 * the right failure: the composition's properties are already inline, so they
	 * render exactly as before, and no author is offered entries that might not be
	 * the ones their composition was authored against.
	 */
	async function refreshLinked() {
		const id = linkedId.value;
		if (!id) {
			context.value = null;
			return;
		}
		loading.value = true;
		try {
			const styleSet = await repository.get(id);
			context.value = styleSet.published
				? {
						id: styleSet.id,
						name: styleSet.name,
						entries: styleSet.published,
						resolution: resolveGraphicStyleSet(styleSet.published),
					}
				: null;
			error.value = null;
		}
		catch (caught) {
			context.value = null;
			error.value = caught instanceof Error ? caught.message : 'The Graphic Style Set could not be loaded';
		}
		finally {
			loading.value = false;
		}
	}

	watch(linkedId, () => void refreshLinked(), { immediate: true });

	onMounted(() => {
		void refreshLibrary();
	});

	return { styleSets, context, loading, error, refreshLibrary, refreshLinked };
}
