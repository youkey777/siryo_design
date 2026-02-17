"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent } from "react";

type MemoCandidate = {
  id: string;
  text: string;
  source: "text" | "note";
  reason: string;
  excludedByDefault: boolean;
};

type Slide = {
  page: number;
  sourceImageFile: string;
  sourceImageUrl: string;
  textBlocks: string[];
  notes: string[];
  memoCandidates: MemoCandidate[];
};

type RunResult = {
  page: number;
  version: number;
  promptFile: string;
  outputImageFile: string;
  responseJsonFile: string;
  status: "success" | "error";
  error?: string;
  imageUrl?: string | null;
};

type Run = {
  runId: string;
  type: "generate" | "regenerate";
  model?: string;
  createdAt: string;
  results: RunResult[];
};

type JobResponse = {
  jobId: string;
  slideCount: number;
  slides: Slide[];
  memoDecisions: Record<string, boolean>;
  manualMemoExclusions?: Array<{
    id: string;
    page: number;
    text: string;
    enabled: boolean;
  }>;
  designReferenceFiles?: string[];
  designReferenceUrls?: Array<{
    file: string;
    url: string;
  }>;
  logoReferenceFiles?: string[];
  logoReferenceUrls?: Array<{
    file: string;
    url: string;
  }>;
  runs?: Run[];
};

type ReferenceUploadResponse = {
  ok: boolean;
  designReferenceFiles: string[];
  designReferenceUrls: Array<{
    file: string;
    url: string;
  }>;
};

type LogoUploadResponse = {
  ok: boolean;
  logoReferenceFiles: string[];
  logoReferenceUrls: Array<{
    file: string;
    url: string;
  }>;
};

type PreviewGeneratedResult = {
  page: number;
  status: "success" | "error";
  imageUrl: string | null;
  promptFile: string;
  outputImageFile: string;
  responseJsonFile: string;
  error?: string;
};

type DesignCheckResponse = {
  runId: string;
  results: PreviewGeneratedResult[];
};

type EditRow = {
  id: string;
  page: string;
  fixPrompt: string;
};

type ManualExclusionRow = {
  id: string;
  page: string;
  text: string;
  enabled: boolean;
  isNew?: boolean;
};

type DisplayResult = {
  id: string;
  page: number;
  status: "success" | "error";
  imageUrl: string | null;
  source: "preview" | "generate" | "regenerate";
  versionLabel?: string;
  runId?: string;
  outputImageFile?: string;
  error?: string;
};

type LoadingOperation =
  | "extract"
  | "reference-upload"
  | "logo-upload"
  | "design-check"
  | "generate"
  | "regenerate";

type PersistedUiState = {
  jobId?: string;
  designPrompt?: string;
  regenerateSelection?: string;
  memoDecisions?: Record<string, boolean>;
  editRows?: EditRow[];
  displayMode?: "preview" | "final" | null;
};

const DESIGN_REFERENCE_URL =
  "https://furoku.github.io/bananaX/projects/infographic-evaluation/index.html";
const UI_STATE_STORAGE_KEY = "nanobanana-slide-studio/ui-state/v2";
const PROMPT_ENGINE_LABEL = "Prompt: ローカルテンプレート生成（LLM呼び出しなし）";
const DEFAULT_IMAGE_MODEL_LABEL = "Image: gemini-3-pro-image-preview";
const FINAL_CURSOR_LATEST = Number.MAX_SAFE_INTEGER;
const OVERLAP_FIX_PRESET =
  "不要な多重四角形・過剰な重なりを抑え、視認性を優先してください。意図がない装飾の重なりは作らない。";

type FinalDeckSnapshot = {
  runId: string;
  createdAt: string;
  results: DisplayResult[];
};

type ExportFormat = "pdf" | "pptx";

type ExportResponse = {
  ok: boolean;
  format: ExportFormat;
  file: string;
  url: string;
};

function createEditRow(page = ""): EditRow {
  return {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    page,
    fixPrompt: "",
  };
}

function createManualExclusionRow(page = "", text = ""): ManualExclusionRow {
  return {
    id: `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    page,
    text,
    enabled: true,
    isNew: true,
  };
}

async function fetchJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? "リクエストに失敗しました。");
  }
  return payload;
}

function parsePageSelectionLocal(value: string, maxPage: number): number[] {
  const tokens = value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const set = new Set<number>();
  for (const token of tokens) {
    const m = token.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      const start = Number(m[1]);
      const end = Number(m[2]);
      if (Number.isNaN(start) || Number.isNaN(end) || start <= 0 || end <= 0) {
        continue;
      }
      const from = Math.min(start, end);
      const to = Math.max(start, end);
      for (let page = from; page <= to; page += 1) {
        if (page <= maxPage) {
          set.add(page);
        }
      }
      continue;
    }

    const page = Number(token);
    if (!Number.isNaN(page) && page > 0 && page <= maxPage) {
      set.add(page);
    }
  }

  return Array.from(set).sort((a, b) => a - b);
}

function normalizeJob(payload: JobResponse): JobResponse {
  return {
    ...payload,
    runs: Array.isArray(payload.runs) ? payload.runs : [],
    designReferenceFiles: Array.isArray(payload.designReferenceFiles) ? payload.designReferenceFiles : [],
    designReferenceUrls: Array.isArray(payload.designReferenceUrls) ? payload.designReferenceUrls : [],
    logoReferenceFiles: Array.isArray(payload.logoReferenceFiles) ? payload.logoReferenceFiles : [],
    logoReferenceUrls: Array.isArray(payload.logoReferenceUrls) ? payload.logoReferenceUrls : [],
    manualMemoExclusions: Array.isArray(payload.manualMemoExclusions)
      ? payload.manualMemoExclusions
      : [],
  };
}

function openDesignPopupWindow(): Window | null {
  return window.open(
    DESIGN_REFERENCE_URL,
    "design_catalog_popup",
    "popup=yes,width=1280,height=900,menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes",
  );
}

function buildFinalDeckSnapshots(runs: Run[]): FinalDeckSnapshot[] {
  const sortedRuns = [...runs].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const latestByPage = new Map<number, DisplayResult>();
  const snapshots: FinalDeckSnapshot[] = [];

  for (const run of sortedRuns) {
    run.results.forEach((result, index) => {
      const previous = latestByPage.get(result.page);
      if (result.status === "success" && result.imageUrl && result.outputImageFile) {
        latestByPage.set(result.page, {
          id: `${run.runId}_${result.page}_${index}`,
          page: result.page,
          status: "success",
          imageUrl: result.imageUrl,
          outputImageFile: result.outputImageFile,
          source: run.type,
          versionLabel: `v${result.version}`,
          runId: run.runId,
          error: undefined,
        });
        return;
      }

      if (!previous) {
        latestByPage.set(result.page, {
          id: `${run.runId}_${result.page}_${index}`,
          page: result.page,
          status: "error",
          imageUrl: null,
          source: run.type,
          versionLabel: `v${result.version}`,
          runId: run.runId,
          error: result.error,
        });
      }
    });

    const snapshotResults = Array.from(latestByPage.values())
      .sort((a, b) => a.page - b.page)
      .map((item) => ({ ...item }));

    snapshots.push({
      runId: run.runId,
      createdAt: run.createdAt,
      results: snapshotResults,
    });
  }

  return snapshots;
}

export default function HomePage() {
  const [fileName, setFileName] = useState("");
  const [queuedReferenceFiles, setQueuedReferenceFiles] = useState<File[]>([]);
  const [queuedLogoFiles, setQueuedLogoFiles] = useState<File[]>([]);
  const [job, setJob] = useState<JobResponse | null>(null);
  const [designPrompt, setDesignPrompt] = useState("");
  const [memoDecisions, setMemoDecisions] = useState<Record<string, boolean>>({});
  const [manualExclusionRows, setManualExclusionRows] = useState<ManualExclusionRow[]>([]);
  const [editRows, setEditRows] = useState<EditRow[]>([createEditRow()]);
  const [regenerateSelection, setRegenerateSelection] = useState("");
  const [previewResults, setPreviewResults] = useState<PreviewGeneratedResult[]>([]);
  const [displayMode, setDisplayMode] = useState<"preview" | "final" | null>(null);
  const [finalHistoryCursor, setFinalHistoryCursor] = useState<number | null>(null);
  const [selectedResultId, setSelectedResultId] = useState<string | null>(null);
  const [loadingOperation, setLoadingOperation] = useState<LoadingOperation | null>(null);
  const [exportingFormat, setExportingFormat] = useState<ExportFormat | null>(null);
  const [statusText, setStatusText] = useState("");
  const [errorText, setErrorText] = useState("");

  const loading = loadingOperation !== null || exportingFormat !== null;
  const isImageGenerationRunning =
    loadingOperation === "design-check" ||
    loadingOperation === "generate" ||
    loadingOperation === "regenerate";

  useEffect(() => {
    const raw = window.sessionStorage.getItem(UI_STATE_STORAGE_KEY);
    if (!raw) {
      return;
    }

    try {
      const parsed = JSON.parse(raw) as PersistedUiState;
      if (typeof parsed.designPrompt === "string") {
        setDesignPrompt(parsed.designPrompt);
      }
      if (typeof parsed.regenerateSelection === "string") {
        setRegenerateSelection(parsed.regenerateSelection);
      }
      if (parsed.memoDecisions && typeof parsed.memoDecisions === "object") {
        setMemoDecisions(parsed.memoDecisions);
      }
      if (Array.isArray(parsed.editRows) && parsed.editRows.length > 0) {
        setEditRows(parsed.editRows);
      }
      if (parsed.displayMode === "preview" || parsed.displayMode === "final" || parsed.displayMode === null) {
        setDisplayMode(parsed.displayMode);
      }

      if (parsed.jobId) {
        fetchJson<JobResponse>(`/api/jobs/${parsed.jobId}`)
          .then((payload) => {
            const normalized = normalizeJob(payload);
            setJob(normalized);
            setMemoDecisions((prev) => {
              if (Object.keys(prev).length > 0) {
                return prev;
              }
              return normalized.memoDecisions ?? {};
            });
            setManualExclusionRows(
              (normalized.manualMemoExclusions ?? []).map((row) => ({
                id: row.id,
                page: String(row.page),
                text: row.text,
                enabled: row.enabled,
                isNew: false,
              })),
            );
            setStatusText("前回の作業状態を復元しました。");
          })
          .catch(() => {
            window.sessionStorage.removeItem(UI_STATE_STORAGE_KEY);
          });
      }
    } catch {
      window.sessionStorage.removeItem(UI_STATE_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    const data: PersistedUiState = {
      jobId: job?.jobId,
      designPrompt,
      regenerateSelection,
      memoDecisions,
      editRows,
      displayMode,
    };
    window.sessionStorage.setItem(UI_STATE_STORAGE_KEY, JSON.stringify(data));
  }, [job?.jobId, designPrompt, regenerateSelection, memoDecisions, editRows, displayMode]);

  const runs = useMemo(() => (Array.isArray(job?.runs) ? job.runs : []), [job]);
  const runById = useMemo(() => new Map(runs.map((run) => [run.runId, run])), [runs]);
  const finalDeckSnapshots = useMemo(() => buildFinalDeckSnapshots(runs), [runs]);

  useEffect(() => {
    if (finalDeckSnapshots.length === 0) {
      setFinalHistoryCursor(null);
      return;
    }

    setFinalHistoryCursor((prev) => {
      if (prev === null) {
        return finalDeckSnapshots.length - 1;
      }
      return Math.max(0, Math.min(prev, finalDeckSnapshots.length - 1));
    });
  }, [finalDeckSnapshots.length]);

  const activeFinalSnapshot = useMemo(() => {
    if (finalDeckSnapshots.length === 0) {
      return null;
    }

    if (finalHistoryCursor === null || finalHistoryCursor === FINAL_CURSOR_LATEST) {
      return finalDeckSnapshots[finalDeckSnapshots.length - 1];
    }

    const clamped = Math.max(0, Math.min(finalHistoryCursor, finalDeckSnapshots.length - 1));
    return finalDeckSnapshots[clamped];
  }, [finalDeckSnapshots, finalHistoryCursor]);

  const finalSnapshotIndex = useMemo(() => {
    if (!activeFinalSnapshot) {
      return -1;
    }
    return finalDeckSnapshots.findIndex((snapshot) => snapshot.runId === activeFinalSnapshot.runId);
  }, [activeFinalSnapshot, finalDeckSnapshots]);

  const finalDisplayResults = useMemo<DisplayResult[]>(() => {
    return activeFinalSnapshot?.results ?? [];
  }, [activeFinalSnapshot]);

  const previewDisplayResults = useMemo<DisplayResult[]>(() => {
    return previewResults.map((result, index) => ({
      id: `preview_${result.page}_${index}`,
      page: result.page,
      status: result.status,
      imageUrl: result.imageUrl,
      source: "preview",
      error: result.error,
    }));
  }, [previewResults]);

  const rightResults = useMemo(() => {
    if (displayMode === "preview") {
      return previewDisplayResults;
    }
    if (displayMode === "final") {
      return finalDisplayResults;
    }
    return [] as DisplayResult[];
  }, [displayMode, previewDisplayResults, finalDisplayResults]);

  const selectedResult = useMemo(() => {
    if (rightResults.length === 0) {
      return null;
    }
    if (!selectedResultId) {
      return rightResults[0];
    }
    return rightResults.find((result) => result.id === selectedResultId) ?? rightResults[0];
  }, [rightResults, selectedResultId]);

  const hasGeneratedResults = finalDisplayResults.length > 0;
  const canUndoOneStep = displayMode === "final" && finalSnapshotIndex > 0;
  const historyLabel =
    finalSnapshotIndex >= 0 ? `${finalSnapshotIndex + 1}/${finalDeckSnapshots.length}` : "0/0";
  const activeImageModelName = activeFinalSnapshot
    ? runById.get(activeFinalSnapshot.runId)?.model
    : null;
  const imageModelLabel =
    displayMode === "final" && activeImageModelName
      ? `Image: ${activeImageModelName}`
      : DEFAULT_IMAGE_MODEL_LABEL;

  useEffect(() => {
    if (rightResults.length === 0) {
      setSelectedResultId(null);
      return;
    }
    const exists = selectedResultId
      ? rightResults.some((result) => result.id === selectedResultId)
      : false;
    if (!exists) {
      setSelectedResultId(rightResults[0].id);
    }
  }, [rightResults, selectedResultId]);

  const refreshJob = async (jobId: string) => {
    const payload = await fetchJson<JobResponse>(`/api/jobs/${jobId}`);
    const normalized = normalizeJob(payload);
    setJob(normalized);
    setMemoDecisions(normalized.memoDecisions ?? {});
    setManualExclusionRows(
      (normalized.manualMemoExclusions ?? []).map((row) => ({
        id: row.id,
        page: String(row.page),
        text: row.text,
        enabled: row.enabled,
        isNew: false,
      })),
    );
  };

  const uploadReferenceFiles = async (jobId: string, files: File[]) => {
    if (files.length === 0) {
      return;
    }

    setLoadingOperation("reference-upload");
    setErrorText("");
    setStatusText(`参考画像をアップロードしています... (${files.length}件)`);
    try {
      const formData = new FormData();
      formData.append("jobId", jobId);
      for (const file of files) {
        formData.append("files", file);
      }

      await fetchJson<ReferenceUploadResponse>("/api/design/references/upload", {
        method: "POST",
        body: formData,
      });

      await refreshJob(jobId);
      setStatusText(`参考画像を ${files.length} 件追加しました。`);
    } finally {
      setLoadingOperation(null);
    }
  };

  const uploadLogoFiles = async (jobId: string, files: File[]) => {
    if (files.length === 0) {
      return;
    }

    setLoadingOperation("logo-upload");
    setErrorText("");
    setStatusText(`ロゴ画像をアップロードしています... (${files.length}件)`);
    try {
      const formData = new FormData();
      formData.append("jobId", jobId);
      for (const file of files) {
        formData.append("files", file);
      }

      await fetchJson<LogoUploadResponse>("/api/logo/upload", {
        method: "POST",
        body: formData,
      });

      await refreshJob(jobId);
      setStatusText(`ロゴ画像を ${files.length} 件追加しました。`);
    } finally {
      setLoadingOperation(null);
    }
  };

  const extractFromFile = async (selectedFile: File) => {
    setLoadingOperation("extract");
    setErrorText("");
    setStatusText("PowerPointを読み込んでいます...");
    setPreviewResults([]);
    setDisplayMode(null);
    setFinalHistoryCursor(null);
    setSelectedResultId(null);

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      const payload = await fetchJson<JobResponse>("/api/slides/extract", {
        method: "POST",
        body: formData,
      });
      const normalized = normalizeJob(payload);

      setJob(normalized);
      setMemoDecisions(normalized.memoDecisions ?? {});
      setManualExclusionRows(
        (normalized.manualMemoExclusions ?? []).map((row) => ({
          id: row.id,
          page: String(row.page),
          text: row.text,
          enabled: row.enabled,
          isNew: false,
        })),
      );
      setEditRows([createEditRow()]);
      setRegenerateSelection("");
      setStatusText(`読み込み完了: ${normalized.slideCount}ページ`);
      if (queuedLogoFiles.length > 0) {
        const pendingLogos = [...queuedLogoFiles];
        setQueuedLogoFiles([]);
        try {
          await uploadLogoFiles(normalized.jobId, pendingLogos);
        } catch (error) {
          setErrorText(
            error instanceof Error ? error.message : "ロゴ画像アップロードに失敗しました。",
          );
        }
      }
      if (queuedReferenceFiles.length > 0) {
        const pending = [...queuedReferenceFiles];
        setQueuedReferenceFiles([]);
        try {
          await uploadReferenceFiles(normalized.jobId, pending);
        } catch (error) {
          setErrorText(
            error instanceof Error ? error.message : "参考画像アップロードに失敗しました。",
          );
        }
      }
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "PowerPoint読み込みに失敗しました。");
      setJob(null);
      setManualExclusionRows([]);
    } finally {
      setLoadingOperation(null);
    }
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0] ?? null;
    setFileName(selectedFile?.name ?? "");

    if (!selectedFile) {
      setJob(null);
      setPreviewResults([]);
      setDisplayMode(null);
      setFinalHistoryCursor(null);
      setManualExclusionRows([]);
      setQueuedLogoFiles([]);
      setQueuedReferenceFiles([]);
      setSelectedResultId(null);
      return;
    }

    await extractFromFile(selectedFile);
  };

  const handleLogoFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) {
      return;
    }

    if (job) {
      try {
        await uploadLogoFiles(job.jobId, files);
      } catch (error) {
        setErrorText(error instanceof Error ? error.message : "ロゴ画像アップロードに失敗しました。");
      }
      return;
    }

    setQueuedLogoFiles((prev) => [...prev, ...files]);
    setStatusText("ロゴ画像を一時保存しました。PowerPoint読込後に自動でアップロードされます。");
  };

  const handleReferenceFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) {
      return;
    }

    if (job) {
      try {
        await uploadReferenceFiles(job.jobId, files);
      } catch (error) {
        setErrorText(error instanceof Error ? error.message : "参考画像アップロードに失敗しました。");
      }
      return;
    }

    setQueuedReferenceFiles((prev) => [...prev, ...files]);
    setStatusText(
      "参考画像を一時保存しました。PowerPoint読込後に自動でアップロードされます。",
    );
  };

  const handleDesignCheck = async () => {
    if (!job) {
      setErrorText("先にPowerPointファイルを選択してください。");
      return;
    }
    if (!designPrompt.trim()) {
      setErrorText("全体デザインプロンプトを入力してください。");
      return;
    }

    setLoadingOperation("design-check");
    setErrorText("");
    setStatusText("デザイン確認用に2枚生成しています...");

    try {
      const payload = await fetchJson<DesignCheckResponse>("/api/design/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: job.jobId,
          designPrompt,
          memoDecisions,
        }),
      });

      setPreviewResults(payload.results);
      setDisplayMode("preview");
      setSelectedResultId(payload.results[0] ? `preview_${payload.results[0].page}_0` : null);
      setStatusText("デザイン確認用の2枚を生成しました。右側で確認してください。");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "デザイン確認の生成に失敗しました。");
    } finally {
      setLoadingOperation(null);
    }
  };

  const handleGenerate = async () => {
    if (!job) {
      setErrorText("先にPowerPointファイルを選択してください。");
      return;
    }
    if (!designPrompt.trim()) {
      setErrorText("全体デザインプロンプトを入力してください。");
      return;
    }

    setLoadingOperation("generate");
    setErrorText("");
    setStatusText("本生成しています...");

    try {
      const pageSelection = `1-${job.slideCount}`;
      await fetchJson<{ runId: string }>("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: job.jobId,
          pageSelection,
          designPrompt,
          memoDecisions,
        }),
      });

      await refreshJob(job.jobId);
      setDisplayMode("final");
      setFinalHistoryCursor(FINAL_CURSOR_LATEST);
      setStatusText("本生成が完了しました。右側の結果を更新しました。");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "本生成に失敗しました。");
    } finally {
      setLoadingOperation(null);
    }
  };

  const handleRegenerate = async () => {
    if (!job) {
      setErrorText("先にPowerPointファイルを選択してください。");
      return;
    }

    const edits = editRows
      .map((row) => ({
        page: Number(row.page),
        fixPrompt: row.fixPrompt.trim(),
      }))
      .filter((row) => row.page > 0 && row.fixPrompt.length > 0);

    if (edits.length === 0) {
      setErrorText("再生成するページ番号と修正指示を入力してください。");
      return;
    }

    setLoadingOperation("regenerate");
    setErrorText("");
    setStatusText("修正ページを再生成しています...");

    try {
      await fetchJson<{ runId: string }>("/api/regenerate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: job.jobId,
          designPrompt,
          memoDecisions,
          edits,
        }),
      });

      await refreshJob(job.jobId);
      setDisplayMode("final");
      setFinalHistoryCursor(FINAL_CURSOR_LATEST);
      setStatusText("再生成が完了しました。右側の結果を更新しました。");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "再生成に失敗しました。");
    } finally {
      setLoadingOperation(null);
    }
  };

  const handleSaveManualExclusion = async (row: ManualExclusionRow) => {
    if (!job) {
      setErrorText("先にPowerPointファイルを選択してください。");
      return;
    }
    const page = Number(row.page);
    if (!Number.isInteger(page) || page <= 0 || page > job.slideCount) {
      setErrorText(`ページ番号は1-${job.slideCount}の範囲で入力してください。`);
      return;
    }
    if (!row.text.trim()) {
      setErrorText("除外テキストを入力してください。");
      return;
    }

    setErrorText("");
    setStatusText(`手動除外を保存しています... (page ${page})`);
    try {
      await fetchJson<{ ok: boolean; manualMemoExclusions: Array<{ id: string; page: number; text: string; enabled: boolean }> }>(
        "/api/memo/manual",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jobId: job.jobId,
            item: {
              id: row.id.startsWith("tmp_") ? undefined : row.id,
              page,
              text: row.text.trim(),
              enabled: row.enabled,
            },
          }),
        },
      );
      await refreshJob(job.jobId);
      setStatusText(`手動除外を保存しました。 (page ${page})`);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "手動除外の保存に失敗しました。");
    }
  };

  const handleDeleteManualExclusion = async (row: ManualExclusionRow) => {
    if (!job) {
      return;
    }
    if (row.id.startsWith("tmp_")) {
      setManualExclusionRows((prev) => prev.filter((item) => item.id !== row.id));
      return;
    }

    setErrorText("");
    setStatusText("手動除外を削除しています...");
    try {
      await fetchJson<{ ok: boolean; manualMemoExclusions: Array<{ id: string; page: number; text: string; enabled: boolean }> }>(
        "/api/memo/manual/delete",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jobId: job.jobId,
            id: row.id,
          }),
        },
      );
      await refreshJob(job.jobId);
      setStatusText("手動除外を削除しました。");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "手動除外の削除に失敗しました。");
    }
  };

  const applyOverlapFixPreset = (rowId: string) => {
    setEditRows((prev) =>
      prev.map((row) => {
        if (row.id !== rowId) {
          return row;
        }
        const nextText = row.fixPrompt.trim()
          ? `${row.fixPrompt.trim()}\n${OVERLAP_FIX_PRESET}`
          : OVERLAP_FIX_PRESET;
        return { ...row, fixPrompt: nextText };
      }),
    );
  };

  const handleUndoOneStep = () => {
    if (!activeFinalSnapshot || finalSnapshotIndex <= 0) {
      return;
    }

    const nextIndex = finalSnapshotIndex - 1;
    setFinalHistoryCursor(nextIndex);
    setDisplayMode("final");
    setStatusText(`1つ前の生成状態に戻しました。（${nextIndex + 1}/${finalDeckSnapshots.length}）`);
    setErrorText("");
  };

  const handleExport = async (format: ExportFormat) => {
    if (!job) {
      setErrorText("先に本生成を実行してください。");
      return;
    }
    if (!activeFinalSnapshot || activeFinalSnapshot.results.length === 0) {
      setErrorText("出力対象の生成結果がありません。");
      return;
    }

    const failedPages = activeFinalSnapshot.results.filter(
      (result) => result.status !== "success" || !result.outputImageFile,
    );
    if (failedPages.length > 0) {
      setErrorText("失敗ページがあるため出力できません。再生成で修正してから実行してください。");
      return;
    }

    const slides = activeFinalSnapshot.results
      .map((result) => ({
        page: result.page,
        outputImageFile: result.outputImageFile ?? "",
      }))
      .sort((a, b) => a.page - b.page);

    setExportingFormat(format);
    setErrorText("");
    setStatusText(`${format.toUpperCase()}を出力しています...`);
    try {
      const payload = await fetchJson<ExportResponse>("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: job.jobId,
          format,
          slides,
        }),
      });

      setStatusText(`${payload.format.toUpperCase()}を出力しました。`);
      window.open(payload.url, "_blank", "noopener,noreferrer");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "エクスポートに失敗しました。");
    } finally {
      setExportingFormat(null);
    }
  };

  const updateMemoDecision = (candidateId: string, checked: boolean) => {
    setMemoDecisions((prev) => ({
      ...prev,
      [candidateId]: checked,
    }));
  };

  const handleAppendPagesFromSelection = () => {
    if (!job) {
      setErrorText("先に本生成を実行してください。");
      return;
    }

    const pages = parsePageSelectionLocal(regenerateSelection, job.slideCount);
    if (pages.length === 0) {
      setErrorText("再生成対象ページの指定が不正です。例: 1-3,7,9");
      return;
    }

    setEditRows((prev) => {
      const existingPages = new Set(prev.map((row) => Number(row.page)).filter((n) => n > 0));
      const appended = pages
        .filter((page) => !existingPages.has(page))
        .map((page) => createEditRow(String(page)));
      return [...prev, ...appended];
    });
    setStatusText(`修正行に ${pages.length} ページ候補を追加しました。`);
    setErrorText("");
  };

  return (
    <main className="shell">
      <header className="header">
        <div className="brand">Nanobanana Slide Studio</div>
        <Link href="/settings" className="navLink">
          設定
        </Link>
      </header>

      <div className="layoutGrid">
        <section className="card">
          <h2 className="sectionTitle">1. 入力</h2>

          <div className="row">
            <label className="fieldLabel" htmlFor="pptFile">
              PowerPointファイル
            </label>
            <input
              id="pptFile"
              className="input"
              type="file"
              accept=".ppt,.pptx"
              onChange={handleFileChange}
            />
            <p className="small">ファイルを選択すると自動で読み込みます。</p>
            {fileName ? <p className="small">選択中: {fileName}</p> : null}
          </div>

          <div className="row">
            <label className="fieldLabel" htmlFor="designPrompt">
              全体デザインプロンプト
            </label>
            <textarea
              id="designPrompt"
              className="textarea"
              value={designPrompt}
              onChange={(event) => setDesignPrompt(event.target.value)}
              placeholder="例: 親しみやすい、ポジティブ、フラットイラスト、#4285F4/#34A853"
            />
          </div>

          <div className="row">
            <label className="fieldLabel" htmlFor="logoReferenceFiles">
              ロゴマーク画像（任意・複数可）
            </label>
            <input
              id="logoReferenceFiles"
              className="input"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              onChange={handleLogoFileChange}
            />
            <p className="small">ここに添付したロゴは固定対象として扱います。生成後に同じロゴで強制上書きします。</p>

            {queuedLogoFiles.length > 0 ? (
              <p className="small">一時保存中: {queuedLogoFiles.map((f) => f.name).join(", ")}</p>
            ) : null}

            {(job?.logoReferenceUrls?.length ?? 0) > 0 ? (
              <div className="refList">
                {job?.logoReferenceUrls?.map((ref) => (
                  <a key={ref.file} className="refItem" href={ref.url} target="_blank" rel="noreferrer">
                    {ref.file.split("/").pop()}
                  </a>
                ))}
              </div>
            ) : null}
          </div>

          <div className="row">
            <label className="fieldLabel" htmlFor="designReferenceFiles">
              デザイン参考ファイル（任意）
            </label>
            <input
              id="designReferenceFiles"
              className="input"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              onChange={handleReferenceFileChange}
            />
            <p className="small">
              全体デザインプロンプトと一致する参考画像を任意で添付できます。相反する場合は要素をミックスして生成します。
            </p>

            {queuedReferenceFiles.length > 0 ? (
              <p className="small">
                一時保存中: {queuedReferenceFiles.map((f) => f.name).join(", ")}
              </p>
            ) : null}

            {(job?.designReferenceUrls?.length ?? 0) > 0 ? (
              <div className="refList">
                {job?.designReferenceUrls?.map((ref) => (
                  <a key={ref.file} className="refItem" href={ref.url} target="_blank" rel="noreferrer">
                    {ref.file.split("/").pop()}
                  </a>
                ))}
              </div>
            ) : null}
          </div>

          <div className="buttonRow">
            <button
              className="btn"
              onClick={() => {
                const popup = openDesignPopupWindow();
                if (!popup) {
                  setErrorText("ポップアップがブロックされています。ブラウザ設定で許可してください。");
                } else {
                  setErrorText("");
                  popup.focus();
                }
              }}
            >
              デザインを探す
            </button>
            <button className="btn btnPreview" onClick={handleDesignCheck} disabled={loading || !job}>
              デザインを確認する
            </button>
            <button className="btn btnPrimary" onClick={handleGenerate} disabled={loading || !job}>
              本生成する
            </button>
          </div>

          {isImageGenerationRunning ? (
            <div className="progressRow">
              <span className="spinner" aria-hidden="true" />
              <span className="small">画像を生成中です。完了までお待ちください。</span>
            </div>
          ) : null}

          {statusText ? <p className="ok">{statusText}</p> : null}
          {errorText ? <p className="error">{errorText}</p> : null}

          <h3 className="sectionTitle">2. メモ書き除外チェック</h3>
          <div className="memoList">
            {!job ? <p className="small">PowerPoint読み込み後に候補が表示されます。</p> : null}
            {job?.slides.map((slide) => (
              <div key={slide.page} className="memoItem">
                <div className="buttonRow" style={{ justifyContent: "space-between" }}>
                  <strong>ページ {slide.page}</strong>
                  <span className="pill">候補 {slide.memoCandidates.length}</span>
                </div>
                {slide.memoCandidates.length === 0 ? (
                  <p className="small">除外候補はありません。</p>
                ) : (
                  slide.memoCandidates.map((candidate) => {
                    const checked = memoDecisions[candidate.id] ?? candidate.excludedByDefault;
                    return (
                      <label key={candidate.id} style={{ display: "block", marginTop: 10 }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) => updateMemoDecision(candidate.id, event.target.checked)}
                        />
                        <span style={{ marginLeft: 8, fontWeight: 700 }}>除外する</span>
                        <div className="small">{candidate.reason}</div>
                        <div className="memoText">{candidate.text}</div>
                      </label>
                    );
                  })
                )}
              </div>
            ))}
          </div>

          <div className="row" style={{ marginTop: 10 }}>
            <div className="buttonRow" style={{ justifyContent: "space-between" }}>
              <h4 className="sectionTitle" style={{ marginBottom: 0 }}>
                手動除外（未検出メモ用）
              </h4>
              <button
                className="btn"
                onClick={() => setManualExclusionRows((prev) => [...prev, createManualExclusionRow()])}
                disabled={loading || !job}
              >
                手動除外を追加
              </button>
            </div>
            {manualExclusionRows.length === 0 ? (
              <p className="small">未検出のメモがある場合は、ここから除外ルールを追加してください。</p>
            ) : null}

            {manualExclusionRows.map((row) => (
              <div key={row.id} className="memoItem">
                <div className="row">
                  <label className="fieldLabel">ページ番号</label>
                  <input
                    className="input"
                    value={row.page}
                    onChange={(event) =>
                      setManualExclusionRows((prev) =>
                        prev.map((item) =>
                          item.id === row.id ? { ...item, page: event.target.value } : item,
                        ),
                      )
                    }
                    placeholder="例: 12"
                  />
                </div>
                <div className="row">
                  <label className="fieldLabel">除外テキスト（部分一致）</label>
                  <textarea
                    className="textarea"
                    value={row.text}
                    onChange={(event) =>
                      setManualExclusionRows((prev) =>
                        prev.map((item) =>
                          item.id === row.id ? { ...item, text: event.target.value } : item,
                        ),
                      )
                    }
                    placeholder="例: キャリアアドバイザーのやりがいを提示して..."
                  />
                </div>
                <label className="small" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={row.enabled}
                    onChange={(event) =>
                      setManualExclusionRows((prev) =>
                        prev.map((item) =>
                          item.id === row.id ? { ...item, enabled: event.target.checked } : item,
                        ),
                      )
                    }
                  />
                  この手動除外を有効にする
                </label>
                <div className="buttonRow" style={{ marginTop: 8 }}>
                  <button className="btn btnSecondary" onClick={() => handleSaveManualExclusion(row)} disabled={loading || !job}>
                    保存
                  </button>
                  <button className="btn btnDanger" onClick={() => handleDeleteManualExclusion(row)} disabled={loading || !job}>
                    削除
                  </button>
                </div>
              </div>
            ))}
          </div>

          {hasGeneratedResults ? (
            <>
              <h3 className="sectionTitle">3. 修正・再生成</h3>
              <div className="row">
                <label className="fieldLabel" htmlFor="regenerateSelection">
                  再生成対象ページ（範囲 + 個別）
                </label>
                <input
                  id="regenerateSelection"
                  className="input"
                  value={regenerateSelection}
                  onChange={(event) => setRegenerateSelection(event.target.value)}
                  placeholder="例: 1-3,7,9"
                />
                <div className="buttonRow">
                  <button className="btn" onClick={handleAppendPagesFromSelection} disabled={loading}>
                    修正行に追加
                  </button>
                </div>
              </div>

              <div className="buttonRow" style={{ marginBottom: 8 }}>
                <button
                  className="btn"
                  onClick={() => setEditRows((prev) => [...prev, createEditRow()])}
                  disabled={loading}
                >
                  修正ページを追加する
                </button>
                <button className="btn btnSecondary" onClick={handleRegenerate} disabled={loading || !job}>
                  再生成する
                </button>
              </div>

              {editRows.map((row) => (
                <div key={row.id} className="memoItem" style={{ marginBottom: 8 }}>
                  <div className="row">
                    <label className="fieldLabel">修正するページ番号</label>
                    <input
                      className="input"
                      value={row.page}
                      onChange={(event) =>
                        setEditRows((prev) =>
                          prev.map((item) =>
                            item.id === row.id ? { ...item, page: event.target.value } : item,
                          ),
                        )
                      }
                      placeholder="例: 2"
                    />
                  </div>
                  <div className="row">
                    <label className="fieldLabel">修正指示</label>
                    <textarea
                      className="textarea"
                      value={row.fixPrompt}
                      onChange={(event) =>
                        setEditRows((prev) =>
                          prev.map((item) =>
                            item.id === row.id ? { ...item, fixPrompt: event.target.value } : item,
                          ),
                        )
                      }
                      placeholder="例: タイトルを短くする。図を2段レイアウトに変更する。"
                    />
                  </div>
                  <div className="buttonRow">
                    <button className="btn" onClick={() => applyOverlapFixPreset(row.id)} disabled={loading}>
                      重なり抑制プリセット
                    </button>
                  </div>
                  <div className="buttonRow">
                    <button
                      className="btn btnDanger"
                      onClick={() => setEditRows((prev) => prev.filter((item) => item.id !== row.id))}
                      disabled={loading || editRows.length === 1}
                    >
                      この行を削除
                    </button>
                  </div>
                </div>
              ))}

              <h3 className="sectionTitle">4. 履歴・出力</h3>
              <p className="small">生成履歴: {historyLabel}（ウィンドウを閉じると履歴表示はリセットされます）</p>
              <div className="buttonRow">
                <button className="btn" onClick={handleUndoOneStep} disabled={loading || !canUndoOneStep}>
                  一つ戻る
                </button>
                <button
                  className="btn btnPreview"
                  onClick={() => handleExport("pdf")}
                  disabled={loading || !hasGeneratedResults}
                >
                  PDF出力
                </button>
                <button
                  className="btn btnPrimary"
                  onClick={() => handleExport("pptx")}
                  disabled={loading || !hasGeneratedResults}
                >
                  PowerPoint出力
                </button>
              </div>
            </>
          ) : null}
        </section>

        <aside className="card">
          <h2 className="sectionTitle">
            {displayMode === "preview"
              ? "デザイン確認結果（2枚）"
              : displayMode === "final"
                ? "生成結果"
                : "生成プレビュー"}
          </h2>

          <div className="modelInfoGrid">
            <span className="pill">{PROMPT_ENGINE_LABEL}</span>
            <span className="pill">{imageModelLabel}</span>
            {displayMode === "final" && hasGeneratedResults ? (
              <span className="pill">履歴 {historyLabel}</span>
            ) : null}
          </div>

          <div className="resultsWorkspace">
            <div className="thumbRail">
              {rightResults.length === 0 ? (
                <p className="small">左側で「デザインを確認する」または「本生成する」を実行すると、ここにサムネイルが並びます。</p>
              ) : (
                rightResults.map((result) => (
                  <button
                    key={result.id}
                    className={`thumbItem ${selectedResult?.id === result.id ? "isActive" : ""} ${
                      result.source === "regenerate" ? "isRegenerated" : ""
                    }`}
                    type="button"
                    onClick={() => setSelectedResultId(result.id)}
                  >
                    <div className="buttonRow" style={{ justifyContent: "space-between" }}>
                      <strong>page {result.page}</strong>
                      <div className="buttonRow">
                        <span className="pill">{result.source === "preview" ? "design-check" : result.source}</span>
                        {result.source === "regenerate" ? <span className="pill pillRegen">再生成</span> : null}
                      </div>
                    </div>
                    <div className="slideFrame slideFrameSmall">
                      {result.status === "success" && result.imageUrl ? (
                        <Image
                          src={result.imageUrl}
                          alt={`thumbnail page ${result.page}`}
                          fill
                          unoptimized
                          className="slideImage"
                        />
                      ) : (
                        <div className="slideFallback">生成失敗</div>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>

            <div className="previewPane">
              {selectedResult ? (
                <>
                  <div className="buttonRow" style={{ justifyContent: "space-between" }}>
                    <strong>
                      page {selectedResult.page}
                      {selectedResult.versionLabel ? ` / ${selectedResult.versionLabel}` : ""}
                    </strong>
                    <div className="buttonRow">
                      {selectedResult.source === "regenerate" ? <span className="pill pillRegen">再生成</span> : null}
                      {selectedResult.runId ? <span className="small">runId: {selectedResult.runId}</span> : null}
                    </div>
                  </div>

                  <div className="slideFrame slideFrameLarge">
                    {selectedResult.status === "success" && selectedResult.imageUrl ? (
                      <Image
                        src={selectedResult.imageUrl}
                        alt={`selected page ${selectedResult.page}`}
                        fill
                        unoptimized
                        className="slideImage"
                      />
                    ) : (
                      <div className="slideFallback">{selectedResult.error ?? "生成に失敗しました"}</div>
                    )}
                  </div>
                </>
              ) : (
                <p className="small">サムネイルを選択すると、ここに拡大表示されます。</p>
              )}

              {isImageGenerationRunning ? (
                <div className="generationPanel">
                  <span className="spinner" aria-hidden="true" />
                  <span>画像生成中です...</span>
                </div>
              ) : null}
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
