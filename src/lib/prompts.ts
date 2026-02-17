import type { ManualMemoExclusion, SlideInfo } from "@/lib/types";

type ExclusionResult = {
  keptTextBlocks: string[];
  keptNotes: string[];
  autoExcludedCount: number;
  manualExcludedCount: number;
};

function resolveExclusions(params: {
  slide: SlideInfo;
  memoDecisions: Record<string, boolean>;
  manualMemoExclusions?: ManualMemoExclusion[];
}): ExclusionResult {
  const { slide, memoDecisions, manualMemoExclusions = [] } = params;
  const autoExcluded = new Set<string>();
  for (const candidate of slide.memoCandidates) {
    const decision = memoDecisions[candidate.id] ?? candidate.excludedByDefault;
    if (decision) {
      autoExcluded.add(candidate.text.trim());
    }
  }

  const manualRows = manualMemoExclusions.filter(
    (row) => row.enabled && row.page === slide.page && row.text.trim().length > 0,
  );

  const shouldExclude = (line: string): { auto: boolean; manual: boolean } => {
    const normalized = line.trim();
    if (!normalized) {
      return { auto: false, manual: false };
    }
    const auto = autoExcluded.has(normalized);
    const manual = manualRows.some((row) => normalized.includes(row.text.trim()));
    return { auto, manual };
  };

  let autoExcludedCount = 0;
  let manualExcludedCount = 0;

  const keptTextBlocks = slide.textBlocks.filter((line) => {
    const result = shouldExclude(line);
    if (result.auto) {
      autoExcludedCount += 1;
    }
    if (result.manual) {
      manualExcludedCount += 1;
    }
    return !(result.auto || result.manual);
  });

  const keptNotes = slide.notes.filter((line) => {
    const result = shouldExclude(line);
    if (result.auto) {
      autoExcludedCount += 1;
    }
    if (result.manual) {
      manualExcludedCount += 1;
    }
    return !(result.auto || result.manual);
  });

  return {
    keptTextBlocks,
    keptNotes,
    autoExcludedCount,
    manualExcludedCount,
  };
}

export function getPromptExclusionStats(params: {
  slide: SlideInfo;
  memoDecisions: Record<string, boolean>;
  manualMemoExclusions?: ManualMemoExclusion[];
}): { autoExcludedCount: number; manualExcludedCount: number } {
  const result = resolveExclusions(params);
  return {
    autoExcludedCount: result.autoExcludedCount,
    manualExcludedCount: result.manualExcludedCount,
  };
}

export function buildPromptForSlide(params: {
  slide: SlideInfo;
  designPrompt: string;
  memoDecisions: Record<string, boolean>;
  manualMemoExclusions?: ManualMemoExclusion[];
  extraFixPrompt?: string;
  logoReferenceCount?: number;
}): string {
  const {
    slide,
    designPrompt,
    memoDecisions,
    manualMemoExclusions,
    extraFixPrompt,
    logoReferenceCount = 0,
  } = params;
  const { keptTextBlocks, keptNotes } = resolveExclusions({
    slide,
    memoDecisions,
    manualMemoExclusions,
  });

  const contentText = keptTextBlocks.length > 0 ? keptTextBlocks.join("\n") : "(本文テキストなし)";
  const notesText = keptNotes.length > 0 ? keptNotes.join("\n") : "(ノートなし)";

  return [
    "あなたが行うべき作業:",
    "- 添付された元スライド1ページを読み取り、同じページ数のまま画像を1枚生成する。",
    "- 出力画像は必ず横長16:9（プレゼン資料比率）で作成する。",
    "- 元資料にロゴ/ブランドマークが含まれる場合、ロゴの形状・色・文字・比率を厳密に保持し、改変・再描画・置換を絶対に行わない。",
    logoReferenceCount > 0
      ? "- 添付されたロゴ画像は唯一の正解とし、ロゴ部分は添付ロゴと完全一致させる。"
      : "",
    "- 元資料の記載内容・構成・主張・数字は保持する。",
    "- 修正指示に明記された箇所以外は、レイアウト・文言・装飾・要素配置を絶対に変更しない。",
    "- 読みやすさ向上のための軽いリライトは許可。意味変更は不可。",
    "- スピーカーノート/メモ書き/制作指示は出力に含めない。",
    "- デザイン参考画像が添付されている場合はそのテイストを反映する。",
    "- もし全体デザインプロンプトと参考画像のテイストが相反する場合は、両方の要素をミックスして調和させる。",
    "- 不要な多重四角形や過剰な重なり表現は避け、意図がある場合のみ採用する。",
    "",
    "全体デザインプロンプト:",
    designPrompt,
    "",
    `対象ページ: ${slide.page}`,
    "このページの本文テキスト:",
    contentText,
    "",
    "このページのノート (参考のみ・通常は出力しない):",
    notesText,
    extraFixPrompt
      ? `\n追加の修正指示:\n${extraFixPrompt}\n\n重要: 上記修正指示に関係しない部分は一切変更しないこと。`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}
