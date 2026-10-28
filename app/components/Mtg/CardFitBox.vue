<!--
	Fits one card into whatever space its parent gives it: the card takes the
	largest width at which its image fits both ways, sitting at the box's foot so
	a label below it stays beside it. The card's badges, positioned on its own
	block in the slot, follow it.
-->
<template>
	<div class="card-fit-box" data-card-fit>
		<div class="card-fit-box__card">
			<slot />
		</div>
	</div>
</template>

<style scoped>
.card-fit-box {
	flex: 1 1 0%;
	min-width: 0;
	min-height: 0;
	container-type: size;
	display: flex;
	align-items: flex-end;
	justify-content: center;
}

/* 61 / 85 is the `mtg-card` aspect, as CARD_ASPECT in shared/utils/cardGrid.ts. */
.card-fit-box__card {
	width: min(100cqw, 100cqh * 61 / 85);
}
</style>
