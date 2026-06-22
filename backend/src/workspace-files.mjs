import {
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  stat,
  writeFile,
} from 'node:fs/promises';
import {
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import { randomUUID } from 'node:crypto';

const WORKSPACE_TREE_ENTRY_LIMIT = 500;
const WORKSPACE_UPLOAD_LIMIT_BYTES = 128 * 1024 * 1024;
const WORKSPACE_PREVIEW_TEXT_LIMIT = 1_500_000;
const WORKSPACE_PREVIEW_IMAGE_LIMIT = 12 * 1024 * 1024;
const WORKSPACE_PREVIEW_DOCUMENT_LIMIT = 64 * 1024 * 1024;
const WORKSPACE_UPLOAD_NAMESPACES = new Set([
  'uploads',
  'clipboard-images',
  'session-captures',
]);
const WORKSPACE_TREE_EXCLUDED_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  '.ultragamestudio',
  '.worktree',
  '.omc',
  'node_modules',
  'target',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.cache',
  'binaries',
  'deriveddatacache',
  'intermediate',
  'saved',
]);

export function workspaceTreeRelativeKey(relativePath) {
  return String(relativePath ?? '')
    .replace(/\\/g, '/')
    .trim()
    .replace(/^\/+|\/+$/g, '');
}

function workspaceTreeChildRelative(parent, name) {
  return parent ? `${parent}/${name}` : name;
}

function workspaceTreeEntryPath(rootPath, relativePath) {
  const root = String(rootPath ?? '').replace(/[\\/]+$/g, '');
  return root ? `${root}/${relativePath}` : relativePath;
}

function isPathInside(parent, child) {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function safeUploadNamespace(namespace) {
  const value = String(namespace ?? 'uploads').trim();
  return WORKSPACE_UPLOAD_NAMESPACES.has(value) ? value : 'uploads';
}

function safeUploadFileName(fileName, fallback = 'file') {
  const raw = String(fileName ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    ?.trim();
  const cleaned = (raw || fallback)
    .replace(/[\x00-\x1f<>:"/\\|?*]+/g, '-')
    .replace(/^\.+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
  return cleaned || fallback;
}

function uniqueUploadRelativePath(namespace, fileName, attempt = 0) {
  const safeNamespace = safeUploadNamespace(namespace);
  const safeName = safeUploadFileName(fileName);
  const ext = extname(safeName);
  const base = ext ? safeName.slice(0, -ext.length) : safeName;
  const suffix = attempt === 0 ? '' : `-${attempt}`;
  return `.ultragamestudio/${safeNamespace}/${base}-${Date.now()}-${randomUUID().slice(0, 8)}${suffix}${ext}`;
}

function bytesFromBase64(bytesBase64) {
  const text = String(bytesBase64 ?? '').trim();
  if (!text) throw new Error('bytesBase64 is required');
  const bytes = Buffer.from(text, 'base64');
  if (bytes.length > WORKSPACE_UPLOAD_LIMIT_BYTES) {
    throw new Error('上传文件超过大小限制。');
  }
  return bytes;
}

async function resolveWorkspaceDirectory(rootDir, relativePath) {
  const root = await realpath(rootDir);
  const target = relativePath ? resolve(root, relativePath.split('/').join(sep)) : root;
  const resolvedTarget = await realpath(target);
  if (!isPathInside(root, resolvedTarget)) {
    throw new Error('目录路径超出工作区。');
  }
  const info = await stat(resolvedTarget);
  if (!info.isDirectory()) throw new Error('目标不是文件夹。');
  return { root, target: resolvedTarget };
}

async function resolveWorkspaceFileForWrite(rootDir, relativePath) {
  const key = workspaceTreeRelativeKey(relativePath);
  if (!key) throw new Error('文件路径不能为空。');
  const root = await realpath(rootDir);
  const target = resolve(root, key.split('/').join(sep));
  if (!isPathInside(root, target)) {
    throw new Error('文件路径超出工作区。');
  }
  const parent = dirname(target);
  await mkdir(parent, { recursive: true });
  const resolvedParent = await realpath(parent);
  if (!isPathInside(root, resolvedParent)) {
    throw new Error('文件路径超出工作区。');
  }
  return { root, target, relativePath: key };
}

async function resolveWorkspaceFileForRead(rootDir, relativePath) {
  const key = workspaceTreeRelativeKey(relativePath);
  if (!key) throw new Error('文件路径不能为空。');
  const root = await realpath(rootDir);
  const target = resolve(root, key.split('/').join(sep));
  const resolvedTarget = await realpath(target);
  if (!isPathInside(root, resolvedTarget)) {
    throw new Error('文件路径超出工作区。');
  }
  const info = await stat(resolvedTarget);
  if (!info.isFile()) throw new Error('目标不是文件。');
  return { root, target: resolvedTarget, relativePath: key, info };
}

function mimeExtension(filePath) {
  return extname(filePath).replace(/^\./, '').toLowerCase();
}

function imageMimeForPath(filePath) {
  switch (mimeExtension(filePath)) {
    case 'png':
      return 'image/png';
    case 'apng':
      return 'image/apng';
    case 'jpg':
    case 'jpeg':
    case 'jpe':
    case 'jfif':
    case 'pjpeg':
    case 'pjp':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'bmp':
    case 'dib':
      return 'image/bmp';
    case 'ico':
    case 'cur':
      return 'image/x-icon';
    case 'svg':
      return 'image/svg+xml';
    case 'avif':
      return 'image/avif';
    default:
      return null;
  }
}

function documentMimeForPath(filePath) {
  switch (mimeExtension(filePath)) {
    case 'pdf':
      return 'application/pdf';
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'doc':
      return 'application/msword';
    case 'rtf':
      return 'application/rtf';
    case 'odt':
      return 'application/vnd.oasis.opendocument.text';
    case 'pptx':
      return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    case 'ppt':
      return 'application/vnd.ms-powerpoint';
    case 'xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case 'xls':
      return 'application/vnd.ms-excel';
    default:
      return null;
  }
}

function textMimeForPath(filePath) {
  switch (mimeExtension(filePath)) {
    case 'html':
    case 'htm':
    case 'xhtml':
    case 'xht':
    case 'shtml':
    case 'hta':
      return 'text/html';
    case 'md':
    case 'mdx':
    case 'markdown':
    case 'mkd':
    case 'mkdn':
    case 'mdown':
    case 'mdwn':
    case 'mdtxt':
    case 'mdtext':
    case 'rmd':
    case 'qmd':
      return 'text/markdown';
    case 'css':
    case 'scss':
    case 'sass':
    case 'less':
      return 'text/css';
    case 'csv':
      return 'text/csv';
    case 'tsv':
      return 'text/tab-separated-values';
    case 'json':
    case 'jsonc':
    case 'json5':
    case 'ndjson':
    case 'jsonl':
    case 'geojson':
    case 'topojson':
    case 'webmanifest':
    case 'ipynb':
    case 'har':
      return 'application/json';
    case 'xml':
    case 'xsd':
    case 'xsl':
    case 'xslt':
    case 'rss':
    case 'atom':
    case 'wsdl':
    case 'drawio':
    case 'dio':
      return 'application/xml';
    case 'js':
    case 'mjs':
    case 'cjs':
      return 'text/javascript';
    case 'ts':
    case 'tsx':
    case 'mts':
    case 'cts':
      return 'text/typescript';
    default:
      return 'text/plain';
  }
}

function hasUtf16Bom(bytes) {
  return (
    bytes.length >= 2 &&
    ((bytes[0] === 0xff && bytes[1] === 0xfe) ||
      (bytes[0] === 0xfe && bytes[1] === 0xff))
  );
}

function probablyBinary(bytes) {
  if (bytes.length === 0) return false;
  const sample = bytes.subarray(0, Math.min(bytes.length, 4096));
  if (sample.includes(0)) return true;
  let control = 0;
  for (const byte of sample) {
    if (byte < 0x08 || (byte > 0x0d && byte < 0x20)) control += 1;
  }
  return control * 100 > sample.length * 10;
}

function decodeUtf16Be(bytes) {
  const body = bytes.subarray(2);
  const swapped = Buffer.allocUnsafe(body.length - (body.length % 2));
  for (let i = 0; i + 1 < body.length; i += 2) {
    swapped[i] = body[i + 1];
    swapped[i + 1] = body[i];
  }
  return swapped.toString('utf16le');
}

function decodePreviewText(bytes) {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return bytes.subarray(2).toString('utf16le');
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return decodeUtf16Be(bytes);
  }
  return bytes.toString('utf8').replace(/^\ufeff/, '');
}

async function readFilePrefix(filePath, limit) {
  const handle = await open(filePath, 'r');
  try {
    const bytes = Buffer.allocUnsafe(limit + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    return bytes.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

export async function listWorkspaceDirectory({
  dir,
  rootPath,
  relativePath = '',
}) {
  const key = workspaceTreeRelativeKey(relativePath);
  const { target } = await resolveWorkspaceDirectory(dir, key);
  const entries = [];

  for (const dirent of await readdir(target, { withFileTypes: true })) {
    const name = dirent.name;
    if (!name) continue;
    const isDir = dirent.isDirectory();
    if (isDir && WORKSPACE_TREE_EXCLUDED_DIRS.has(name.toLowerCase())) continue;
    const childRelative = workspaceTreeChildRelative(key, name);
    const childPath = join(target, name);
    const metadata = await stat(childPath).catch(() => null);
    entries.push({
      name,
      path: workspaceTreeEntryPath(rootPath, childRelative),
      relativePath: childRelative,
      kind: isDir ? 'directory' : 'file',
      hidden: name.startsWith('.'),
      sizeBytes: metadata?.isFile() ? metadata.size : null,
      modifiedAtMs: metadata?.mtimeMs ? Math.max(0, Math.round(metadata.mtimeMs)) : null,
    });
  }

  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
    return (
      a.name.toLowerCase().localeCompare(b.name.toLowerCase()) ||
      a.name.localeCompare(b.name)
    );
  });

  const totalEntries = entries.length;
  const truncated = totalEntries > WORKSPACE_TREE_ENTRY_LIMIT;
  return {
    rootPath,
    relativePath: key,
    entries: entries.slice(0, WORKSPACE_TREE_ENTRY_LIMIT),
    truncated,
    totalEntries,
  };
}

export async function saveWorkspaceUpload({
  dir,
  rootPath,
  bytesBase64,
  mime = null,
  fileName = null,
  namespace = 'uploads',
}) {
  const bytes = bytesFromBase64(bytesBase64);
  const safeName = safeUploadFileName(fileName, 'upload.bin');
  let lastError = null;

  for (let attempt = 0; attempt < 16; attempt += 1) {
    const relativePath = uniqueUploadRelativePath(namespace, safeName, attempt);
    const { target } = await resolveWorkspaceFileForWrite(dir, relativePath);
    try {
      await writeFile(target, bytes, { flag: 'wx' });
      return {
        path: workspaceTreeEntryPath(rootPath, relativePath),
        relativePath,
        fileName: safeName,
        mime: typeof mime === 'string' && mime.trim() ? mime.trim() : null,
        sizeBytes: bytes.length,
      };
    } catch (err) {
      if (err?.code === 'EEXIST') {
        lastError = err;
        continue;
      }
      throw err;
    }
  }

  throw new Error(`创建上传文件失败：${lastError?.message ?? '文件名冲突'}`);
}

export async function previewWorkspaceFile({
  dir,
  rootPath,
  relativePath = '',
}) {
  const { target, relativePath: key, info } = await resolveWorkspaceFileForRead(
    dir,
    relativePath,
  );
  const sizeBytes = info.size;
  const fileName = target.split(/[\\/]/).pop() || 'file';
  const path = workspaceTreeEntryPath(rootPath, key);

  const imageMime = imageMimeForPath(target);
  if (imageMime) {
    if (sizeBytes > WORKSPACE_PREVIEW_IMAGE_LIMIT) {
      return {
        path,
        fileName,
        kind: 'binary',
        mime: imageMime,
        sizeBytes,
        truncated: false,
      };
    }
    return {
      path,
      fileName,
      kind: 'image',
      mime: imageMime,
      sizeBytes,
      truncated: false,
      base64: (await readFile(target)).toString('base64'),
    };
  }

  const documentMime = documentMimeForPath(target);
  if (documentMime) {
    if (sizeBytes > WORKSPACE_PREVIEW_DOCUMENT_LIMIT) {
      return {
        path,
        fileName,
        kind: 'binary',
        mime: documentMime,
        sizeBytes,
        truncated: false,
      };
    }
    return {
      path,
      fileName,
      kind: 'document',
      mime: documentMime,
      sizeBytes,
      truncated: false,
      base64: (await readFile(target)).toString('base64'),
    };
  }

  let bytes = await readFilePrefix(target, WORKSPACE_PREVIEW_TEXT_LIMIT);
  const truncated =
    bytes.length > WORKSPACE_PREVIEW_TEXT_LIMIT ||
    sizeBytes > WORKSPACE_PREVIEW_TEXT_LIMIT;
  if (bytes.length > WORKSPACE_PREVIEW_TEXT_LIMIT) {
    bytes = bytes.subarray(0, WORKSPACE_PREVIEW_TEXT_LIMIT);
  }

  if (!hasUtf16Bom(bytes) && probablyBinary(bytes)) {
    return {
      path,
      fileName,
      kind: 'binary',
      mime: null,
      sizeBytes,
      truncated: false,
    };
  }

  return {
    path,
    fileName,
    kind: 'text',
    mime: textMimeForPath(target),
    sizeBytes,
    truncated,
    text: decodePreviewText(bytes),
  };
}
