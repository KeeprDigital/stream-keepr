import { vi } from 'vitest';

/**
 * A structural stand-in for the `three` module, so the Animation Effect bases
 * can be exercised in Node: what they do with three — build a renderer, map
 * params onto uniforms, dispose what they created — is observable without a
 * WebGL context, which no test environment here has.
 */

export class StubColor {
	value: string;
	set = vi.fn((next: string) => {
		this.value = next;
	});

	constructor(value: string) {
		this.value = value;
	}
}

export class StubVector2 {
	x = 0;
	y = 0;
	set(x: number, y: number) {
		this.x = x;
		this.y = y;
	}
}

export class StubScene {
	children: unknown[] = [];
	add = vi.fn((child: unknown) => {
		this.children.push(child);
	});

	traverse(visit: (object: unknown) => void) {
		visit(this);
		for (const child of this.children)
			visit(child);
	}
}

export class StubMaterial {
	static lastCreated: StubMaterial | undefined;

	uniforms: Record<string, { value: unknown }>;
	vertexShader?: string;
	fragmentShader?: string;
	dispose = vi.fn();

	constructor(parameters: { uniforms?: Record<string, { value: unknown }>; vertexShader?: string; fragmentShader?: string } = {}) {
		this.uniforms = parameters.uniforms ?? {};
		this.vertexShader = parameters.vertexShader;
		this.fragmentShader = parameters.fragmentShader;
		StubMaterial.lastCreated = this;
	}
}

export class StubGeometry {
	dispose = vi.fn();
}

export class StubMesh {
	constructor(public geometry: StubGeometry, public material: StubMaterial) {}
}

export class StubCamera {}

export class StubRenderTarget {
	texture = { isStubTexture: true };
	setSize = vi.fn();
	dispose = vi.fn();

	constructor(public width = 1, public height = 1) {}
}

export class StubRenderer {
	domElement = {
		style: {} as Record<string, string>,
		classList: { add: vi.fn() },
		remove: vi.fn(),
	};

	pixelRatio = 1;
	setPixelRatio = vi.fn((ratio: number) => {
		this.pixelRatio = ratio;
	});

	getPixelRatio = vi.fn(() => this.pixelRatio);
	setSize = vi.fn();

	/** The render target each render() call drew into, `null` being the canvas. */
	renderedTargets: (StubRenderTarget | null)[] = [];
	private currentRenderTarget: StubRenderTarget | null = null;
	setRenderTarget = vi.fn((target: StubRenderTarget | null) => {
		this.currentRenderTarget = target;
	});

	render = vi.fn(() => {
		this.renderedTargets.push(this.currentRenderTarget);
	});

	dispose = vi.fn();
	forceContextLoss = vi.fn();
}

export function createThreeStub() {
	const renderers: StubRenderer[] = [];
	const renderTargets: StubRenderTarget[] = [];
	const three = {
		WebGLRenderer: class extends StubRenderer {
			constructor() {
				super();
				renderers.push(this);
			}
		},
		WebGLRenderTarget: class extends StubRenderTarget {
			constructor(width?: number, height?: number) {
				super(width, height);
				renderTargets.push(this);
			}
		},
		LinearFilter: 'linear-filter',
		Scene: StubScene,
		ShaderMaterial: StubMaterial,
		MeshBasicMaterial: StubMaterial,
		PlaneGeometry: StubGeometry,
		Mesh: StubMesh,
		OrthographicCamera: StubCamera,
		PerspectiveCamera: StubCamera,
		Vector2: StubVector2,
		Color: StubColor,
	};
	return { three: three as unknown as typeof import('three'), renderers, renderTargets };
}

export function createHostStub(): HTMLElement {
	return {
		appendChild: vi.fn(),
		clientWidth: 640,
		clientHeight: 360,
	} as unknown as HTMLElement;
}
