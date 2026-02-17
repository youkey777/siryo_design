const MEMO_PATTERNS: RegExp[] = [
  /前振り/,
  /このスライド/,
  /提示する/,
  /ここでは/,
  /狙い/,
  /訴求/,
  /説明用/,
  /メモ/,
  /補足/,
  /求職者に対し/,
  /冒頭/,
  /後半/,
];

export function looksLikeMemoText(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return false;
  }

  if (normalized.length >= 18 && /スライド/.test(normalized)) {
    return true;
  }

  return MEMO_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
