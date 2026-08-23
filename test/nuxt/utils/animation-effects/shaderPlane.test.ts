import type { StubColor, StubRenderer } from './threeStub';
import { describe, expect, it } from 'vitest';
import { createShaderPlaneEffect } from '~/utils/animation-effects/shaderPlane';
import { createHostStub, createThreeStub, StubMaterial } from './threeStub';

interface Params {
	tint: string;
	strength: number;
	speed: number;
}

function mountEffect(params: Params = { tint: '#ff0000', strength: 2, speed: 0.5 }) {
	const { three, renderers } = createThreeStub();
	const host = createHostStub();
	const instance = createShaderPlaneEffect<Params>({
		three,
		host,
		fragmentShader: 'void main() {}',
		uniforms: current => ({ tint: current.tint, strength: current.strength }),
		timeScale: current => current.speed,
	}, params);
	const renderer = renderers[0] as StubRenderer;
	const material = StubMaterial.lastCreated!;
	return { instance, renderer, material, host };
}

describe('createShaderPlaneEffect', () => {
	it('maps hex params to colour uniforms and numbers to floats', () => {
		const { material } = mountEffect();
		expect((material.uniforms.tint!.value as StubColor).value).toBe('#ff0000');
		expect(material.uniforms.strength!.value).toBe(2);
		expect(material.uniforms.iTime!.value).toBe(0);
		expect(material.uniforms.iResolution).toBeDefined();
	});

	it('mounts its canvas into the host', () => {
		const { renderer, host } = mountEffect();
		expect(host.appendChild).toHaveBeenCalledWith(renderer.domElement);
	});

	it('advances iTime by elapsed seconds scaled by the effect speed', () => {
		const { instance, material, renderer } = mountEffect();
		instance.render(10);
		expect(material.uniforms.iTime!.value).toBe(5);
		expect(renderer.render).toHaveBeenCalledTimes(1);
	});

	it('applies new params to the live uniforms without rebuilding', () => {
		const { instance, material } = mountEffect();
		instance.setParams({ tint: '#00ff00', strength: 3, speed: 2 });
		expect((material.uniforms.tint!.value as StubColor).value).toBe('#00ff00');
		expect(material.uniforms.strength!.value).toBe(3);
		instance.render(10);
		expect(material.uniforms.iTime!.value).toBe(20);
	});

	it('sizes the drawing buffer and the resolution uniform together', () => {
		const { instance, material, renderer } = mountEffect();
		renderer.pixelRatio = 2;
		instance.resize(1920, 1080);
		expect(renderer.setSize).toHaveBeenCalledWith(1920, 1080, false);
		const resolution = material.uniforms.iResolution!.value as { x: number; y: number };
		expect(resolution.x).toBe(3840);
		expect(resolution.y).toBe(2160);
	});

	it('disposes everything it created and removes its canvas', () => {
		const { instance, material, renderer } = mountEffect();
		instance.dispose();
		expect(material.dispose).toHaveBeenCalled();
		expect(renderer.dispose).toHaveBeenCalled();
		expect(renderer.forceContextLoss).toHaveBeenCalled();
		expect(renderer.domElement.remove).toHaveBeenCalled();
	});
});
