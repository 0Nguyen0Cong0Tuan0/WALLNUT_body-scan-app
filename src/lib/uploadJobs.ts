import { parseCsiFile, type CSIFrameRaw, type ParsedCSI } from "@/lib/csiProcessor";
import { runInferenceEngine, type InferenceResult } from "@/lib/inferenceEngine";
import { InvalidCsiFileError, type ScanServiceError, toScanServiceError } from "@/lib/scanErrors";

export type UploadJobStage =
  | "queued"
  | "validating"
  | "decoding_binary"
  | "parsing"
  | "inference"
  | "completed"
  | "failed";

export interface UploadJobState {
  jobId: string;
  stage: UploadJobStage;
  progress: number;
  createdAtMs: number;
  updatedAtMs: number;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  result?: InferenceResult;
}

type JobStore = Map<string, UploadJobState>;

const globalWithJobs = globalThis as typeof globalThis & {
  __RUVIEW_UPLOAD_JOBS__?: JobStore;
};

const uploadJobs: JobStore = globalWithJobs.__RUVIEW_UPLOAD_JOBS__ ?? new Map<string, UploadJobState>();
if (!globalWithJobs.__RUVIEW_UPLOAD_JOBS__) {
  globalWithJobs.__RUVIEW_UPLOAD_JOBS__ = uploadJobs;
}

function clamp(value: number, minValue: number, maxValue: number): number {
  return Math.min(maxValue, Math.max(minValue, value));
}

function setJob(jobId: string, patch: Partial<UploadJobState>): void {
  const current = uploadJobs.get(jobId);
  if (!current) return;
  uploadJobs.set(jobId, {
    ...current,
    ...patch,
    updatedAtMs: Date.now(),
  });
}

function cleanupJobs(maxAgeMs = 30 * 60 * 1000): void {
  const now = Date.now();
  for (const [jobId, job] of uploadJobs.entries()) {
    if (now - job.updatedAtMs > maxAgeMs) {
      uploadJobs.delete(jobId);
    }
  }
}

function looksBinaryPayload(fileName: string, bytes: Uint8Array): boolean {
  if (fileName.toLowerCase().endsWith(".bin")) return true;
  const head = bytes.slice(0, Math.min(256, bytes.length));
  if (head.length === 0) return false;

  let printable = 0;
  for (const value of head) {
    if (value === 9 || value === 10 || value === 13 || (value >= 32 && value <= 126)) printable++;
  }
  const printableRatio = printable / head.length;
  if (printableRatio < 0.65) return true;

  const prefix = new TextDecoder().decode(head).trimStart();
  return !(prefix.startsWith("{") || prefix.startsWith("["));
}

function validateRuViewTextSpec(text: string): void {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new InvalidCsiFileError("Uploaded file is empty.");
  }

  if (trimmed.startsWith("{") && trimmed.includes("\"frames\"")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      throw new InvalidCsiFileError("Proof-bundle JSON is invalid.", {
        reason: error instanceof Error ? error.message : "parse_failed",
      });
    }

    const frame = (parsed as { frames?: unknown[] }).frames?.[0] as
      | { amplitude?: number[][]; phase?: number[][] }
      | undefined;
    if (!frame || !Array.isArray(frame.amplitude) || !Array.isArray(frame.phase)) {
      throw new InvalidCsiFileError("Proof-bundle must contain frames with amplitude and phase matrices.");
    }
    return;
  }

  const firstLine = trimmed
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) {
    throw new InvalidCsiFileError("JSONL payload has no frame lines.");
  }

  let head: unknown;
  try {
    head = JSON.parse(firstLine);
  } catch (error) {
    throw new InvalidCsiFileError("First JSONL frame is not valid JSON.", {
      reason: error instanceof Error ? error.message : "parse_failed",
    });
  }

  const frame = head as {
    type?: unknown;
    ts_ns?: unknown;
    timestamp?: unknown;
    node_id?: unknown;
    subcarriers?: unknown;
    amplitudes?: unknown;
    iq_hex?: unknown;
  };

  if (frame.type !== "raw_csi") {
    throw new InvalidCsiFileError("RuView JSONL requires frame.type = raw_csi.");
  }
  const hasTsNs = typeof frame.ts_ns === "number" && Number.isFinite(frame.ts_ns);
  const hasTimestamp =
    (typeof frame.timestamp === "number" && Number.isFinite(frame.timestamp)) ||
    typeof frame.timestamp === "string";
  if ((!hasTsNs && !hasTimestamp) || typeof frame.node_id !== "number") {
    throw new InvalidCsiFileError("RuView JSONL requires node_id plus ts_ns or timestamp.");
  }
  if (typeof frame.subcarriers !== "number" || frame.subcarriers <= 0) {
    throw new InvalidCsiFileError("RuView JSONL requires positive subcarriers.");
  }
  if (!Array.isArray(frame.amplitudes) && typeof frame.iq_hex !== "string") {
    throw new InvalidCsiFileError("RuView JSONL frame requires amplitudes[] or iq_hex.");
  }
}

function decodeBinaryFrameSet(bytes: Uint8Array): CSIFrameRaw[] {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const frames: CSIFrameRaw[] = [];
  let offset = 0;
  const startedNs = Date.now() * 1_000_000;

  while (offset + 8 <= buffer.length) {
    const magic = buffer.readUInt16LE(offset);
    const frameLen = buffer.readUInt16LE(offset + 2);
    if (frameLen < 8) {
      throw new InvalidCsiFileError("Binary CSI frame length is invalid.", {
        offset,
        frameLen,
      });
    }
    if (offset + frameLen > buffer.length) {
      throw new InvalidCsiFileError("Binary CSI frame is truncated.", {
        offset,
        frameLen,
        totalBytes: buffer.length,
      });
    }

    const nodeId = buffer.readUInt8(offset + 4);
    const rssi = buffer.readInt8(offset + 6);
    const channel = buffer.readUInt8(offset + 7);
    const iqBytes = buffer.subarray(offset + 8, offset + frameLen);

    const amplitudes: number[] = [];
    for (let i = 0; i + 1 < iqBytes.length; i += 2) {
      const iComp = iqBytes.readInt8(i);
      const qComp = iqBytes.readInt8(i + 1);
      amplitudes.push(Math.sqrt(iComp * iComp + qComp * qComp));
    }

    if (amplitudes.length === 0) {
      throw new InvalidCsiFileError("Binary CSI frame has empty IQ payload.", { offset, frameLen });
    }

    frames.push({
      type: "raw_csi",
      timestamp: new Date().toISOString(),
      ts_ns: startedNs + frames.length * 10_000_000,
      node_id: nodeId,
      rssi,
      channel,
      subcarriers: amplitudes.length,
      amplitudes,
      iq_hex: iqBytes.toString("hex"),
      magic: `0x${magic.toString(16).padStart(4, "0")}`,
      size: frameLen,
    } as CSIFrameRaw);

    offset += frameLen;
  }

  if (frames.length === 0) {
    throw new InvalidCsiFileError("No decodable CSI frames found in binary file.");
  }

  return frames;
}

async function parseUploadedCsiFile(
  file: File,
  onProgress: (stage: UploadJobStage, progress: number) => void
): Promise<{ parsedCsi: ParsedCSI; inputSource: string }> {
  onProgress("validating", 10);
  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  if (bytes.length < 8) {
    throw new InvalidCsiFileError("Uploaded CSI payload is too small.");
  }

  if (looksBinaryPayload(file.name, bytes)) {
    onProgress("decoding_binary", 35);
    const rawFrames = decodeBinaryFrameSet(bytes);
    onProgress("parsing", 58);
    const jsonl = rawFrames.map((frame) => JSON.stringify(frame)).join("\n");
    const parsedCsi = parseCsiFile(jsonl);
    return { parsedCsi, inputSource: "file:binary" };
  }

  const text = new TextDecoder().decode(bytes);
  validateRuViewTextSpec(text);
  onProgress("parsing", 52);
  const parsedCsi = parseCsiFile(text);
  return { parsedCsi, inputSource: `file:${parsedCsi.format}` };
}

async function processUploadJob(jobId: string, file: File): Promise<void> {
  try {
    const { parsedCsi, inputSource } = await parseUploadedCsiFile(file, (stage, progress) => {
      setJob(jobId, { stage, progress: clamp(progress, 0, 100) });
    });

    setJob(jobId, { stage: "inference", progress: 76 });
    const result = await runInferenceEngine(parsedCsi, inputSource);
    setJob(jobId, { stage: "completed", progress: 100, result });
  } catch (error) {
    const scanError: ScanServiceError = toScanServiceError(error);
    setJob(jobId, {
      stage: "failed",
      progress: 100,
      error: {
        code: scanError.code,
        message: scanError.message,
        details: scanError.details,
      },
    });
  }
}

export function startUploadJob(file: File): UploadJobState {
  cleanupJobs();
  const jobId = crypto.randomUUID();
  const now = Date.now();
  const state: UploadJobState = {
    jobId,
    stage: "queued",
    progress: 0,
    createdAtMs: now,
    updatedAtMs: now,
  };
  uploadJobs.set(jobId, state);
  void processUploadJob(jobId, file);
  return state;
}

export function getUploadJob(jobId: string): UploadJobState | null {
  return uploadJobs.get(jobId) ?? null;
}

