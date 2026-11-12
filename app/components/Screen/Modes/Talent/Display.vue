<script setup lang="ts">
import type { GraphicAssetReference } from '~~/shared/types/graphicsAsset';
import { SUPPORTED_SOCIAL_NETWORK_BY_KEY } from '~~/shared/socialProfiles';
import { foundationTokenVar, foundationTypographyStyle } from '~/modules/screen-mode';

const { config, error, ready, isEmpty, headerText, talents } = useTalentModeData(useScreenContext());

/** The photos the read answers, only while the Screen shows them, resolved through its capability (ADR-0070). */
const photos = computed<GraphicAssetReference[]>(() => talents.value.flatMap(talent => talent.photo
	? [talent.photo]
	: []));
const { contentUrl, contentUrlsSettled } = useScreenGraphicAssetContentUrls(() => photos.value);

const titleStyle = {
	...foundationTypographyStyle('heading'),
	color: foundationTokenVar('text-primary'),
};
const titleDividerStyle = {
	borderBottomColor: foundationTokenVar('divider'),
};
const cardStyle = {
	backgroundColor: foundationTokenVar('surface'),
	borderColor: foundationTokenVar('accent'),
};
const photoStyle = {
	borderColor: foundationTokenVar('accent'),
};
const nameStyle = {
	...foundationTypographyStyle('heading'),
	color: foundationTokenVar('text-primary'),
};
const roleStyle = {
	...foundationTypographyStyle('body'),
	color: foundationTokenVar('text-secondary'),
};
const profileStyle = {
	...foundationTypographyStyle('body'),
	color: foundationTokenVar('text-primary'),
};

/** A name's initials, shown where a Talent has no photo. */
function initials(name: string): string {
	return name.split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]!.toUpperCase()).join('');
}
</script>

<template>
	<ScreenModeBase
		:error="error"
		:ready="ready"
		:empty="isEmpty"
	>
		<div
			class="talent-display"
			:class="`talent-display--${config.layout}`"
			:data-talent-layout="config.layout"
			:data-render-pending="contentUrlsSettled ? undefined : ''"
		>
			<div v-if="config.showHeader" class="talent-header" :style="titleDividerStyle">
				<h2 :style="titleStyle">
					{{ headerText }}
				</h2>
			</div>

			<div class="talent-list">
				<div
					v-for="talent in talents"
					:key="talent.id"
					class="talent-card"
					:data-talent-id="talent.id"
					:style="cardStyle"
				>
					<div
						v-if="config.showPhoto"
						class="talent-photo"
						:data-talent-photo="talent.photo?.revisionId ?? 'none'"
						:style="photoStyle"
					>
						<img
							v-if="talent.photo && contentUrl(talent.photo)"
							:src="contentUrl(talent.photo)"
							:alt="talent.name"
						>
						<span v-else class="talent-initials" :style="nameStyle">{{ initials(talent.name) }}</span>
					</div>

					<div class="talent-details">
						<div class="talent-name" data-talent-name :style="nameStyle">
							{{ talent.name }}
						</div>
						<div
							v-if="config.showRole && talent.role"
							class="talent-role"
							data-talent-role
							:style="roleStyle"
						>
							{{ talent.role }}
						</div>
						<ul v-if="talent.shownProfiles.length > 0" class="talent-profiles">
							<li
								v-for="shown in talent.shownProfiles"
								:key="shown.network"
								class="talent-profile"
								:data-social-network="shown.network"
								:style="profileStyle"
							>
								<UIcon
									:name="SUPPORTED_SOCIAL_NETWORK_BY_KEY[shown.network].icon"
									class="talent-profile-icon"
									aria-hidden="true"
								/>
								<span>@{{ shown.handle }}</span>
							</li>
						</ul>
					</div>
				</div>
			</div>
		</div>
	</ScreenModeBase>
</template>

<style scoped>
.talent-display {
	display: flex;
	flex-direction: column;
	width: 100%;
	height: 100%;
}
.talent-display--lowerThird {
	justify-content: flex-end;
}
.talent-header {
	border-bottom-style: solid;
	border-bottom-width: 2px;
	padding-bottom: 0.75rem;
	margin-bottom: 1.5rem;
}
.talent-header h2 {
	font-size: clamp(1.75rem, 3.5cqw, 3rem);
}
.talent-list {
	display: flex;
	flex-wrap: wrap;
	gap: 1.5rem;
	min-width: 0;
}
.talent-display--fullPanel .talent-list {
	flex: 1;
	flex-wrap: wrap;
	align-content: center;
	justify-content: center;
	gap: 2.5rem;
}
.talent-card {
	display: flex;
	align-items: center;
	gap: 1.25rem;
	min-width: 0;
	padding: 1rem 1.5rem;
	border-left-style: solid;
	border-left-width: 6px;
}
.talent-display--fullPanel .talent-card {
	flex-direction: column;
	text-align: center;
	flex: 0 1 22rem;
	padding: 2rem 1.5rem;
	border-left-width: 0;
	border-top-style: solid;
	border-top-width: 6px;
}
.talent-photo {
	flex-shrink: 0;
	width: 6rem;
	height: 6rem;
	overflow: hidden;
	border-radius: 9999px;
	border-style: solid;
	border-width: 3px;
	display: flex;
	align-items: center;
	justify-content: center;
}
.talent-display--fullPanel .talent-photo {
	width: 12rem;
	height: 12rem;
}
.talent-photo img {
	width: 100%;
	height: 100%;
	object-fit: cover;
}
.talent-initials {
	font-size: 2rem;
}
.talent-details {
	display: flex;
	flex-direction: column;
	gap: 0.35rem;
	min-width: 0;
}
.talent-name {
	font-size: clamp(1.5rem, 2.8cqw, 2.5rem);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.talent-role {
	font-size: clamp(1rem, 1.6cqw, 1.5rem);
}
.talent-profiles {
	display: flex;
	flex-wrap: wrap;
	gap: 0.35rem 1.25rem;
	list-style: none;
	margin: 0;
	padding: 0;
}
.talent-display--fullPanel .talent-profiles {
	flex-direction: column;
	align-items: center;
}
.talent-profile {
	display: inline-flex;
	align-items: center;
	gap: 0.5rem;
	font-size: clamp(1rem, 1.5cqw, 1.375rem);
}
.talent-profile-icon {
	flex-shrink: 0;
	width: 1.1em;
	height: 1.1em;
}
</style>
