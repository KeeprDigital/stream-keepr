import type { StubRenderer, StubScene } from './threeStub';
import type { SceneEffectDelegate } from '~/utils/animation-effects/sceneEffect';
import { describe, expect, it, vi } from 'vitest';
import { createSceneEffect } from '~/utils/animation-effects/sceneEffect';
import { createHostStub, createThreeStub, StubCamera, StubGeometry, StubMaterial, StubMesh } from './threeStub';

interface Params {
	shade: string;
	count: number;
}

function mountEffect(params: Params = { shade: '#123456', count: 3 }) {
	const { three, renderers } = createThreeStub();
	const host = createHostStub();
	const geometry = new StubGeometry();
	const material = new StubMaterial();
	const camera = new StubCamera() as unknown as import('three').Camera;
	const delegate = {
		createCamera: vi.fn(() => camera),
		build: vi.fn(({ scene }: { scene: StubScene }) => {
			scene.add(new StubMesh(geometry, material));
		}),
		applyParams: vi.fn(),
		update: vi.fn(),
	};
	const instance = createSceneEffect<Params>({
		three,
		host,
		delegate: delegate as unknown as SceneEffectDelegate<Params>,
	}, params);
	return { instance, delegate, camera, geometry, material, renderer: renderers[0] as StubRenderer, host };
}

describe('createSceneEffect', () => {
	it('builds the scene once with the starting params and mounts its canvas', () => {
		const { delegate, host, renderer } = mountEffect();
		expect(delegate.build).toHaveBeenCalledTimes(1);
		expect(delegate.build.mock.calls[0]![0]).toMatchObject({ params: { shade: '#123456', count: 3 } });
		expect(host.appendChild).toHaveBeenCalledWith(renderer.domElement);
	});

	it('hands param changes to the delegate rather than rebuilding', () => {
		const { instance, delegate } = mountEffect();
		instance.setParams({ shade: '#654321', count: 5 });
		expect(delegate.build).toHaveBeenCalledTimes(1);
		expect(delegate.applyParams).toHaveBeenCalledTimes(1);
		expect(delegate.applyParams.mock.calls[0]![0]).toMatchObject({ params: { shade: '#654321', count: 5 } });
	});

	it('updates the delegate with elapsed seconds before every render', () => {
		const { instance, delegate, renderer, camera } = mountEffect();
		instance.render(1.5);
		expect(delegate.update).toHaveBeenCalledTimes(1);
		expect(delegate.update.mock.calls[0]![0]).toMatchObject({ elapsedSeconds: 1.5 });
		expect(renderer.render).toHaveBeenCalledWith(expect.any(Object), camera);
	});

	it('resizes the renderer to the viewport', () => {
		const { instance, renderer } = mountEffect();
		instance.resize(800, 450);
		expect(renderer.setSize).toHaveBeenCalledWith(800, 450, false);
	});

	it('disposes the scene contents it was built with, and its renderer', () => {
		const { instance, geometry, material, renderer } = mountEffect();
		instance.dispose();
		expect(geometry.dispose).toHaveBeenCalled();
		expect(material.dispose).toHaveBeenCalled();
		expect(renderer.dispose).toHaveBeenCalled();
		expect(renderer.forceContextLoss).toHaveBeenCalled();
		expect(renderer.domElement.remove).toHaveBeenCalled();
	});
});
