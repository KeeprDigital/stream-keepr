<script lang="ts" setup>
const cardStore = useCardStore();

const { previewCard } = storeToRefs(cardStore);
</script>

<template>
	<div v-if="previewCard">
		<div class="info">
			<h1 class="name">
				{{ previewCard.name }}
			</h1>
		</div>
		<MtgCardImage
			:key="previewCard.id"
			:card="previewCard"
			:display="previewCard.displayData"
			display-mode="preview"
		/>
	</div>
</template>

<style scoped>
.info {
	.name {
		font-weight: 500;
		text-align: center;
	}
}
</style>
