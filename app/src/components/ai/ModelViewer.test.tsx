import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ModelViewer from './ModelViewer';

const tauriMocks = vi.hoisted(() => ({
  fetchModelAssetDataUrl: vi.fn(),
  readModelAssetDataUrl: vi.fn(),
  openExternal: vi.fn(),
  openLocalPath: vi.fn(),
}));

const loaderState = vi.hoisted(() => ({
  urls: [] as string[],
  playCalls: [] as string[],
  gltfAnimations: [] as Array<{ name: string }>,
  hasSkinnedMesh: true,
}));

vi.mock('@/lib/tauri', () => ({
  fetchModelAssetDataUrl: tauriMocks.fetchModelAssetDataUrl,
  readModelAssetDataUrl: tauriMocks.readModelAssetDataUrl,
  openExternal: tauriMocks.openExternal,
  openLocalPath: tauriMocks.openLocalPath,
}));

class MockVector3 {
  x = 0;
  y = 0;
  z = 0;
  set(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }
  sub() {
    return this;
  }
}

class MockObject3D {
  position = new MockVector3();
  rotation = new MockVector3();
  children: MockObject3D[];
  isSkinnedMesh: boolean;

  constructor({
    children = [],
    isSkinnedMesh = false,
  }: { children?: MockObject3D[]; isSkinnedMesh?: boolean } = {}) {
    this.children = children;
    this.isSkinnedMesh = isSkinnedMesh;
  }

  traverse(callback: (object: MockObject3D) => void) {
    callback(this);
    for (const child of this.children) child.traverse(callback);
  }
}

class MockScene extends MockObject3D {
  add() {}
}

class MockPerspectiveCamera {
  position = new MockVector3();
  near = 0.01;
  far = 1000;
  aspect = 1;
  updateProjectionMatrix() {}
  lookAt() {}
}

class MockWebGLRenderer {
  domElement = document.createElement('canvas');
  outputColorSpace = '';
  toneMapping = '';
  setPixelRatio() {}
  setSize() {}
  render() {}
  dispose() {}
}

class MockClock {
  getDelta() {
    return 0.016;
  }
}

class MockAnimationAction {
  constructor(private readonly name: string) {}

  reset() {
    return this;
  }
  fadeIn() {
    return this;
  }
  fadeOut() {
    return this;
  }
  play() {
    loaderState.playCalls.push(this.name);
    return this;
  }
}

class MockAnimationMixer {
  constructor() {}
  clipAction(clip: { name?: string }) {
    return new MockAnimationAction(clip.name ?? '');
  }
  update() {}
  stopAllAction() {}
}

class MockLight {
  position = new MockVector3();
  constructor() {}
}

class MockGridHelper extends MockObject3D {
  material = { transparent: false, opacity: 1 };
  constructor() {
    super();
  }
}

class MockBox3 {
  setFromObject() {
    return this;
  }
  isEmpty() {
    return true;
  }
}

class MockMaterial {
  dispose() {}
}

class MockMesh extends MockObject3D {
  constructor(
    public geometry: unknown,
    public material: unknown,
  ) {
    super();
  }
}

vi.mock('three', () => ({
  Scene: MockScene,
  PerspectiveCamera: MockPerspectiveCamera,
  WebGLRenderer: MockWebGLRenderer,
  Clock: MockClock,
  AnimationMixer: MockAnimationMixer,
  HemisphereLight: MockLight,
  DirectionalLight: MockLight,
  GridHelper: MockGridHelper,
  Box3: MockBox3,
  Vector3: MockVector3,
  Mesh: MockMesh,
  MeshStandardMaterial: MockMaterial,
  SRGBColorSpace: 'srgb',
  ACESFilmicToneMapping: 'aces',
}));

vi.mock('three/addons/controls/OrbitControls.js', () => ({
  OrbitControls: class {
    target = new MockVector3();
    minDistance = 0;
    maxDistance = 0;
    constructor() {}
    update() {}
    dispose() {}
  },
}));

vi.mock('three/addons/loaders/GLTFLoader.js', () => ({
  GLTFLoader: class {
    load(
      url: string,
      onLoad: (value: {
        scene: MockObject3D;
        animations: Array<{ name: string }>;
      }) => void,
    ) {
      loaderState.urls.push(url);
      queueMicrotask(() =>
        onLoad({
          scene: new MockObject3D({
            children: loaderState.hasSkinnedMesh
              ? [new MockObject3D({ isSkinnedMesh: true })]
              : [],
          }),
          animations: loaderState.gltfAnimations,
        }),
      );
    }
  },
}));

const objectLoader = () =>
  class {
    load(url: string, onLoad: (value: MockObject3D) => void) {
      loaderState.urls.push(url);
      queueMicrotask(() => onLoad(new MockObject3D()));
    }
  };

vi.mock('three/addons/loaders/OBJLoader.js', () => ({ OBJLoader: objectLoader() }));
vi.mock('three/addons/loaders/FBXLoader.js', () => ({ FBXLoader: objectLoader() }));
vi.mock('three/addons/loaders/STLLoader.js', () => ({ STLLoader: objectLoader() }));
vi.mock('three/addons/loaders/PLYLoader.js', () => ({ PLYLoader: objectLoader() }));

async function flushAsyncWork(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });
}

describe('ModelViewer', () => {
  let originalRequestAnimationFrame: typeof window.requestAnimationFrame;
  let originalCancelAnimationFrame: typeof window.cancelAnimationFrame;

  beforeEach(() => {
    loaderState.urls = [];
    loaderState.playCalls = [];
    loaderState.gltfAnimations = [{ name: 'Idle' }, { name: 'Walk' }];
    loaderState.hasSkinnedMesh = true;
    tauriMocks.fetchModelAssetDataUrl.mockReset();
    tauriMocks.readModelAssetDataUrl.mockReset();
    tauriMocks.openExternal.mockReset();
    tauriMocks.openLocalPath.mockReset();
    tauriMocks.fetchModelAssetDataUrl.mockResolvedValue(
      'data:model/gltf-binary;base64,AAAA',
    );
    tauriMocks.readModelAssetDataUrl.mockResolvedValue(
      'data:model/gltf-binary;base64,BBBB',
    );

    originalRequestAnimationFrame = window.requestAnimationFrame;
    originalCancelAnimationFrame = window.cancelAnimationFrame;
    window.requestAnimationFrame = vi
      .fn()
      .mockImplementation(() => 1);
    window.cancelAnimationFrame = vi.fn();
  });

  afterEach(() => {
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it('routes remote model previews through the desktop asset proxy', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          createElement(ModelViewer, {
            src: 'https://assets.meshy.ai/tasks/refined/model.glb',
            label: '预览 3D 模型 1',
          }),
        );
      });
      await flushAsyncWork();

      expect(tauriMocks.fetchModelAssetDataUrl).toHaveBeenCalledWith(
        'https://assets.meshy.ai/tasks/refined/model.glb',
      );
      expect(loaderState.urls).toEqual(['data:model/gltf-binary;base64,AAAA']);
      expect(container.textContent).not.toContain('模型预览失败');
    } finally {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    }
  });

  it('routes local model previews through the desktop file reader', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          createElement(ModelViewer, {
            src: 'E:\\UltraGameStudio\\.ultragamestudio\\model-assets\\model.glb',
            label: '预览 3D 模型 1',
          }),
        );
      });
      await flushAsyncWork();

      expect(tauriMocks.readModelAssetDataUrl).toHaveBeenCalledWith(
        'E:\\UltraGameStudio\\.ultragamestudio\\model-assets\\model.glb',
        { cwd: undefined },
      );
      expect(loaderState.urls).toEqual(['data:model/gltf-binary;base64,BBBB']);
      expect(container.textContent).not.toContain('模型预览失败');
    } finally {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    }
  });

  it('plays embedded animations from clickable preview controls', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          createElement(ModelViewer, {
            src: 'https://assets.meshy.ai/tasks/refined/rigged.glb',
            label: '预览 3D 模型 1',
          }),
        );
      });
      await flushAsyncWork();

      const animationButtons = Array.from(
        container.querySelectorAll('button[aria-label^="播放动画 "]'),
      );
      expect(
        animationButtons.map((button) => button.textContent),
      ).toEqual(['Idle', 'Walk']);
      expect(loaderState.playCalls.at(-1)).toBe('Idle');

      const walkButton = container.querySelector(
        'button[aria-label="播放动画 Walk"]',
      ) as HTMLButtonElement | null;
      expect(walkButton).not.toBeNull();
      await act(async () => {
        walkButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      expect(loaderState.playCalls.at(-1)).toBe('Walk');
      expect(
        container
          .querySelector('button[aria-label="播放动画 Walk"]')
          ?.getAttribute('aria-pressed'),
      ).toBe('true');

      const callsBeforeReplay = loaderState.playCalls.length;
      await act(async () => {
        walkButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      expect(loaderState.playCalls.length).toBeGreaterThan(callsBeforeReplay);
      expect(loaderState.playCalls.at(-1)).toBe('Walk');
    } finally {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    }
  });

  it('disables requested animation controls when the model has no skeletal clips', async () => {
    loaderState.gltfAnimations = [];
    loaderState.hasSkinnedMesh = false;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          createElement(ModelViewer, {
            src: 'https://assets.meshy.ai/tasks/refined/no-clips.glb',
            label: '预览 3D 模型 1',
            defaultAnimations: ['Idle', 'Walk', 'Run'],
          }),
        );
      });
      await flushAsyncWork();

      const animationButtons = Array.from(
        container.querySelectorAll('button[aria-label^="播放动画 "]'),
      ) as HTMLButtonElement[];
      expect(
        animationButtons.map((button) => button.textContent),
      ).toEqual(['Idle', 'Walk', 'Run']);
      expect(animationButtons.every((button) => button.disabled)).toBe(true);
      expect(loaderState.playCalls).toEqual([]);
      expect(container.textContent).toContain(
        '模型未包含真实骨骼/动画，需要先生成动画版模型。',
      );
    } finally {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    }
  });
});
