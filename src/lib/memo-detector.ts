const STRONG_PATTERNS: RegExp[] = [
  /このスライド/,
  /スライドの目的/,
  /このページ/,
  /本欄/,
  /前振り/,
  /制作意図/,
  /意図/,
  /目的/,
  /提示する/,
  /提示して/,
  /補足/,
  /注釈/,
  /メモ/,
  /具体例のスライド/,
  /希望展開/,
];

const SOFT_PATTERNS: RegExp[] = [
  /求職者に対し/,
  /やりがいを提示/,
  /キャリアアドバイザーになるための実例/,
  /求職者の未来/,
  /現場からのスタート/,
  /ギャップを埋める/,
  /ここでは/,
  /担う可能性/,
  /アピール/,
];

export type MemoPositionContext = {
  topRatio?: number;
  leftRatio?: number;
  widthRatio?: number;
  heightRatio?: number;
};

export function looksLikeMemoText(text: string, context: MemoPositionContext = {}): boolean {
  const normalized = normalizeText(text);
  if (!normalized) {
    return false;
  }

  let score = 0;

  for (const pattern of STRONG_PATTERNS) {
    if (pattern.test(normalized)) {
      score += 3;
    }
  }
  for (const pattern of SOFT_PATTERNS) {
    if (pattern.test(normalized)) {
      score += 1;
    }
  }

  if (normalized.length >= 25 && /(する|ため|こと|として|について)/.test(normalized)) {
    score += 1;
  }
  if (normalized.includes("「") && normalized.includes("」") && /(目的|意図|前振り|提示)/.test(normalized)) {
    score += 1;
  }

  const topRatio = context.topRatio ?? 0;
  const leftRatio = context.leftRatio ?? 0;
  const widthRatio = context.widthRatio ?? 0;
  const heightRatio = context.heightRatio ?? 0;

  if (topRatio > 0 && topRatio < 0.28 && leftRatio > 0.48) {
    score += 2;
  }
  if (widthRatio > 0.24 && widthRatio < 0.65 && heightRatio > 0.08 && heightRatio < 0.32) {
    score += 1;
  }

  return score >= 3;
}

export function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
