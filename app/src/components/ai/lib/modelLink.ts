const MODEL_URL_EXT_RE = /\.(?:glb|gltf|obj|stl|fbx|bvh|ply|usdz|zip)(?:[?#].*)?$/i;
const PREVIEWABLE_MODEL_URL_EXT_RE = /\.(?:glb|gltf|obj|stl|fbx|bvh|ply)(?:[?#].*)?$/i;
const UNSUPPORTED_MODEL_URL_EXT_RE = /\.(?:usdz|zip)(?:[?#].*)?$/i;
const LOCAL_MODEL_PATH_RE =
  /^(?:[A-Za-z]:[/\\]|[/\\]|\\\\|~[/\\]|\$\w+[/\\]|file:\/\/).*\.(?:glb|gltf|obj|stl|fbx|bvh|ply|usdz|zip)(?:[?#].*)?$/i;

export function isModelUrl(url: string): boolean {
  const value = url.trim();
  if (!value) return false;
  if (/^data:(?:model\/|application\/octet-stream|application\/zip|text\/plain)/i.test(value)) return true;
  if (/^https?:\/\//i.test(value)) return MODEL_URL_EXT_RE.test(value);
  return LOCAL_MODEL_PATH_RE.test(value);
}

export function canPreviewModelUrl(url: string): boolean {
  const value = url.trim();
  if (!value) return false;
  if (/^data:(?:model\/gltf-binary|model\/gltf\+json|application\/octet-stream|text\/plain)/i.test(value)) {
    return true;
  }
  if (/^data:application\/zip/i.test(value)) return false;
  if (UNSUPPORTED_MODEL_URL_EXT_RE.test(value)) return false;
  if (LOCAL_MODEL_PATH_RE.test(value)) return PREVIEWABLE_MODEL_URL_EXT_RE.test(value);
  if (!/^https?:\/\//i.test(value)) return false;
  return PREVIEWABLE_MODEL_URL_EXT_RE.test(value) || !MODEL_URL_EXT_RE.test(value);
}

export function modelExtension(url: string): string {
  const clean = url.trim().split(/[?#]/, 1)[0] ?? '';
  const dataMime = /^data:([^;,]+)/i.exec(clean)?.[1]?.toLowerCase();
  if (dataMime === 'model/gltf+json') return 'gltf';
  if (dataMime === 'model/gltf-binary' || dataMime === 'application/octet-stream') return 'glb';
  if (dataMime === 'text/plain') return 'bvh';
  if (dataMime === 'application/zip') return 'zip';
  return /\.(glb|gltf|obj|stl|fbx|bvh|ply|usdz|zip)$/i.exec(clean)?.[1]?.toLowerCase() ?? 'glb';
}
