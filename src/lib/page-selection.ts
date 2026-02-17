import { z } from "zod";

const RANGE_RE = /^(\d+)-(\d+)$/;
const NUM_RE = /^\d+$/;

export function parsePageSelection(input: string, maxPage: number): number[] {
  const schema = z.string().min(1);
  const value = schema.parse(input).replace(/\s+/g, "");

  const pages = new Set<number>();
  for (const chunk of value.split(",")) {
    if (!chunk) {
      continue;
    }

    const range = chunk.match(RANGE_RE);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (start < 1 || end < 1 || start > end) {
        throw new Error(`無効な範囲指定です: ${chunk}`);
      }
      for (let page = start; page <= end; page += 1) {
        if (page <= maxPage) {
          pages.add(page);
        }
      }
      continue;
    }

    if (!NUM_RE.test(chunk)) {
      throw new Error(`無効なページ指定です: ${chunk}`);
    }

    const page = Number(chunk);
    if (page >= 1 && page <= maxPage) {
      pages.add(page);
    }
  }

  const sorted = [...pages].sort((a, b) => a - b);
  if (sorted.length === 0) {
    throw new Error("対象ページが見つかりません。");
  }
  return sorted;
}
