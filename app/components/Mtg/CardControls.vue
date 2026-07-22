<template>
	<div class="card-controls">
		<MtgCardControlsPreview class="preview" />
		<MtgCardControlsButtons class="buttons" />
		<MtgCardControlsActive class="active" />
	</div>
</template>

<style scoped>
.card-controls {
	height: 100%;
	display: grid;
	grid-template-rows: auto auto auto;
	align-content: start;
	padding: 0.5rem;
	gap: 0.5rem;

	&:has(.active) {
		align-content: normal;
		grid-template-rows: auto auto auto 1fr auto auto auto;
	}

	.preview {
		display: grid;
		grid-template-rows: subgrid;
		grid-row: span 2;
	}

	.active {
		display: grid;
		grid-template-rows: subgrid;
		grid-row: -4 / -1;
	}
}
</style>
