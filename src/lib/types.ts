export type MemoCandidate = {
  id: string;
  text: string;
  source: "text" | "note";
  reason: string;
  excludedByDefault: boolean;
};

export type ManualMemoExclusion = {
  id: string;
  page: number;
  text: string;
  enabled: boolean;
};

export type SlideInfo = {
  page: number;
  sourceImageFile: string;
  textBlocks: string[];
  notes: string[];
  memoCandidates: MemoCandidate[];
};

export type GenerationResult = {
  page: number;
  version: number;
  promptFile: string;
  outputImageFile: string;
  responseJsonFile: string;
  status: "success" | "error";
  error?: string;
};

export type GenerationRun = {
  runId: string;
  type: "generate" | "regenerate";
  model: string;
  createdAt: string;
  results: GenerationResult[];
};

export type JobRecord = {
  jobId: string;
  sourcePptFile: string;
  createdAt: string;
  slideCount: number;
  slides: SlideInfo[];
  memoDecisions: Record<string, boolean>;
  designReferenceFiles?: string[];
  logoReferenceFiles?: string[];
  manualMemoExclusions?: ManualMemoExclusion[];
  runs: GenerationRun[];
};

export type SettingsRecord = {
  apiKeyEncrypted: string;
  updatedAt: string;
};

export type ExtractedSlide = {
  page: number;
  textBlocks: string[];
  notes: string[];
  textShapes?: Array<{
    text: string;
    left: number;
    top: number;
    width: number;
    height: number;
  }>;
};

export type ExtractedPptxPayload = {
  slideCount: number;
  slideWidth: number;
  slideHeight: number;
  slides: ExtractedSlide[];
};
