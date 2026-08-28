/**
 * ASCII 艺术 / 制表字符识别，供信息流 markdown 渲染复用：
 *   - hasBoxDrawing：文本是否含框线/树形制表字符（用于等宽渲染与自动围栏）
 *   - isAsciiTableSep / isAsciiTableRow：识别 `+---+` 边框式 ASCII 表格
 */

const BOX_DRAWING_RE =
  /[─━│┃┌┍┎┏┐┑┒┓└┕┖┗┘┙┚┛├┝┞┟┠┡┢┣┤┥┦┧┨┩┪┫┬┭┮┯┰┱┲┳┴┵┶┷┸┹┺┻┼┽┾┿═║╔╗╚╝╠╣╦╩╬▶▼▲◀]/u;

const ASCII_TABLE_SEP_RE = /^\s*\+[-=]+(\+[-=]+)*\+\s*$/u;
const ASCII_TABLE_ROW_RE = /^\s*\|.*\|\s*$/u;

/** 文本（或单行）是否包含框线/树形制表字符。 */
export function hasBoxDrawing(text: string): boolean {
  return BOX_DRAWING_RE.test(text);
}

/** 是否为 `+---+` 形式的边框表分隔行。 */
export function isAsciiTableSep(line: string): boolean {
  return ASCII_TABLE_SEP_RE.test(line);
}

/** 是否为 `| ... |` 形式的边框表数据/表头行。 */
export function isAsciiTableRow(line: string): boolean {
  return ASCII_TABLE_ROW_RE.test(line);
}
