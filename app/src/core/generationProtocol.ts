/**
 * CONTRACT: model-agnostic "generate an asset for me" protocol.
 *
 * Like the interaction / recall / memory protocols, a chat turn is a one-shot
 * call and the model cannot invoke the app's slash-command generation channels
 * (/image, /music, /video, ...) itself. To let the model DRIVE generation
 * end-to-end -- instead of only recommending a command for the user to click --
 * we impose one convention: it emits one or more delimited request blocks and
 * ends its turn:
 *
 *     <<UGS_GEN>>
 *     { "kind": "image", "prompt": "Film still, a lone person at dusk, ..." }
 *     <<UGS_GEN_END>>
 *
 * The chat run loop parses every block, runs the matching generation channel
 * for each (reusing the exact same generateXxxPrompt actions the input box
 * uses), feeds a compact result summary (saved paths / errors) back as a
 * continuation, and re-invokes the model in the same bounded loop used for
 * interaction and recall round-trips. This lets the model generate a whole
 * batch (e.g. 5 cover images) and then finalize by filling paths into a doc.
 *
 * SAFETY GATE: this protocol is only honored when the user has explicitly
 * entered the matching asset mode. Entering the mode IS the user's
 * authorization to let the model spend that channel's quota automatically;
 * outside the mode the block is ignored so a stray sentinel in ordinary chat
 * can never burn quota.
 *
 * This module is pure (no IO/React/store): sentinels, the request type, and the
 * tolerant parse/strip helpers plus the system-prompt instruction text.
 */

export type GenKind =
  | 'image'
  | 'music'
  | 'video'
  | 'sprite'
  | 'speech'
  | 'threeD'
  | 'animation';

export interface GenRequest {
  kind: GenKind;
  prompt: string;
}

export const GEN_OPEN = '<<UGS_GEN>>';
export const GEN_CLOSE = '<<UGS_GEN_END>>';

const GEN_OPEN_RE = /<<\s*UGS_GEN\s*>+/g;
const GEN_CLOSE_RE = /<<\s*UGS_GEN_END\s*>+/;

function normalizeKind(raw: unknown): GenKind | null {
  if (typeof raw !== 'string') return null;
  const k = raw.trim().toLowerCase();
  if (k === 'image' || k === 'img' || k === '图片' || k === '生图') return 'image';
  if (k === 'music' || k === 'bgm' || k === '音乐') return 'music';
  if (k === 'video' || k === '视频') return 'video';
  if (k === 'sprite' || k === 'spritesheet' || k === '精灵' || k === '精灵图')
    return 'sprite';
  if (k === 'speech' || k === 'tts' || k === '语音' || k === '配音') return 'speech';
  if (k === 'threed' || k === '3d' || k === 'mesh' || k === '建模' || k === '模型')
    return 'threeD';
  if (
    k === 'animation' ||
    k === 'anim' ||
    k === 'motion' ||
    k === '动画' ||
    k === '动作'
  )
    return 'animation';
  return null;
}

function firstJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function parseOneBlock(inner: string): GenRequest | null {
  const span = firstJsonObject(inner);
  if (!span) return null;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(span) as Record<string, unknown>;
  } catch {
    return null;
  }
  const kind = normalizeKind(raw.kind);
  if (!kind) return null;
  const prompt = typeof raw.prompt === 'string' ? raw.prompt.trim() : '';
  if (!prompt) return null;
  return { kind, prompt };
}

export function parseGenRequests(text: string): GenRequest[] {
  if (!text || !text.includes('UGS_GEN')) return [];
  const requests: GenRequest[] = [];
  GEN_OPEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = GEN_OPEN_RE.exec(text)) !== null) {
    const afterOpen = text.slice(match.index + match[0].length);
    const close = afterOpen.search(GEN_CLOSE_RE);
    if (close === -1) continue;
    const req = parseOneBlock(afterOpen.slice(0, close));
    if (req) requests.push(req);
  }
  return requests;
}

export function hasGenRequest(text: string): boolean {
  return parseGenRequests(text).length > 0;
}

export function stripGenRequests(text: string): string {
  if (!text || !text.includes('UGS_GEN')) return text;
  let result = '';
  let cursor = 0;
  for (;;) {
    const rest = text.slice(cursor);
    GEN_OPEN_RE.lastIndex = 0;
    const openMatch = GEN_OPEN_RE.exec(rest);
    if (!openMatch) {
      result += rest;
      break;
    }
    result += rest.slice(0, openMatch.index);
    const afterOpen = rest.slice(openMatch.index + openMatch[0].length);
    const closeMatch = GEN_CLOSE_RE.exec(afterOpen);
    if (!closeMatch) {
      break;
    }
    cursor +=
      openMatch.index +
      openMatch[0].length +
      closeMatch.index +
      closeMatch[0].length;
  }
  return result.trim();
}

const KIND_LABEL: Record<GenKind, string> = {
  image: '图片',
  music: '音乐',
  video: '视频',
  sprite: '精灵图',
  speech: '语音',
  threeD: '3D 模型',
  animation: '动画',
};

export function genKindLabel(kind: GenKind): string {
  return KIND_LABEL[kind];
}

/**
 * Detect asset-generation commands the user explicitly typed in THIS turn's
 * message, e.g. "帮我配图，用 /image ..." or a bare "/video ...". Entering a
 * sticky mode (/image-mode-start) is one way to authorize auto-generation, but
 * users also just write the one-shot command inline; when they do, that IS an
 * explicit request to generate, so we authorize the matching channel for the
 * turn even without the sticky mode. Matches the same command aliases the input
 * box recognizes. Order-preserving, de-duplicated.
 */
// A trailing (?![a-z0-9]) guards against alnum continuation (so /videofoo
// won't match) while still allowing CJK aliases like /生图 whose next char is
// a space or another CJK glyph — \b can't be used here because it is never a
// boundary right after a CJK code point.
const KIND_COMMAND_RE: Array<[GenKind, RegExp]> = [
  ['image', /\/(?:image|img|draw|生图|画图|绘图|出图)(?![a-z0-9])/iu],
  ['music', /\/(?:music|bgm|音乐|配乐)(?![a-z0-9])/iu],
  ['video', /\/(?:video|视频)(?![a-z0-9])/iu],
  ['sprite', /\/(?:sprite|spritesheet|精灵图?)(?![a-z0-9])/iu],
  ['speech', /\/(?:speech|tts|语音|配音|旁白)(?![a-z0-9])/iu],
  ['threeD', /\/(?:mesh|3d|threed|建模|模型)(?![a-z0-9])/iu],
  ['animation', /\/(?:anim|animation|motion|动画|动作)(?![a-z0-9])/iu],
];

export function detectRequestedGenKinds(text: string): GenKind[] {
  if (!text || !text.includes('/')) return [];
  const kinds: GenKind[] = [];
  for (const [kind, re] of KIND_COMMAND_RE) {
    if (re.test(text)) kinds.push(kind);
  }
  return kinds;
}

/** Union of two GenKind lists, order-preserving and de-duplicated. */
export function mergeGenKinds(a: GenKind[], b: GenKind[]): GenKind[] {
  const seen = new Set<GenKind>();
  const out: GenKind[] = [];
  for (const k of [...a, ...b]) {
    if (!seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}

export function genInstruction(kinds: GenKind[]): string {
  if (kinds.length === 0) return '';
  const list = kinds.map((k) => KIND_LABEL[k]).join('、');
  return (
    '\n\n【素材自动生成协议（重要）】用户已进入素材生成模式（当前已授权渠道：' +
    list +
    '），这等于授权你直接调用对应生成渠道，无需再让用户手动敲命令或点按钮。\n' +
    '当你需要生成上述素材时，在回复中输出一个或多个生成块，然后结束本回合（用户看不到这些块的原文）：\n' +
    GEN_OPEN +
    '\n' +
    '{"kind":"image","prompt":"可直接使用的完整生图提示词"}\n' +
    GEN_CLOSE +
    '\n' +
    '- kind 取值：image=图片、music=音乐、video=视频、sprite=精灵图、speech=语音、threeD=3D 模型、animation=动画；只能用当前已授权的渠道。\n' +
    '- 需要一次生成多张/多个时，连续输出多个生成块，系统会逐个执行。\n' +
    '- 系统执行完会把每个素材的保存路径或错误回传给你；你据此继续下一步（例如把路径回填到文档、或根据失败原因调整提示词重试）。\n' +
    '- 不要只是"建议用户去点 /image"，也不要假装已经生成——真正要出素材时就发生成块，由系统实际执行。'
  );
}
