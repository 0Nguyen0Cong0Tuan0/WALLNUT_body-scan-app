import { parseCsiFile, type CSIFrameRaw, type ParsedCSI } from "@/lib/csiProcessor";
import type { InferenceResult } from "@/lib/inferenceEngine";
import { InvalidCsiFileError, type ScanServiceError, toScanServiceError } from "@/lib/scanErrors";
import { getServerDb, parseJsonField, stringifyJson } from "@/lib/serverDb";
import { processScanInference, type ScanPipelineOptions } from "@/lib/scanPipeline";

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

type UploadJobRow = {
  job_id: string;
  stage: UploadJobStage;
  progress: number;
  created_at_ms: number;
  updated_at_ms: number;
  error_code: string | null;
  error_message: string | null;
  error_details_json: string | null;
  result_json: string | null;
};

function clamp(value: number, minValue: number, maxValue: number): number {
  return Math.min(maxValue, Math.max(minValue, value));
}

function toUploadJobState(row: UploadJobRow): UploadJobState {
  const errorDetails = parseJsonField<Record<string, unknown> | undefined>(row.error_details_json, undefined);
  const result = parseJsonField<InferenceResult | undefined>(row.result_json, undefined);
  return {
    jobId: row.job_id,
    stage: row.stage,
    progress: row.progress,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
    error:
      row.error_code && row.error_message
        ? {
            code: row.error_code,
            message: row.error_message,
            details: errorDetails,
          }
        : undefined,
    result,
  };
}

function readUploadJobRow(jobId: string): UploadJobRow | null {
  const db = getServerDb();
  const row = db
    .prepare(
      `SELECT
         job_id, stage, progress, created_at_ms, updated_at_ms,
         error_code, error_message, error_details_json, result_json
       FROM upload_jobs
       WHERE job_id = ?`
    )
    .get(jobId) as UploadJobRow | undefined;
  return row ?? null;
}

function writeUploadJobState(job: UploadJobState): void {
  const db = getServerDb();
  db.prepare(
    `INSERT INTO upload_jobs (
      job_id, stage, progress, created_at_ms, updated_at_ms,
      error_code, error_message, error_details_json, result_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(job_id) DO UPDATE SET
      stage = excluded.stage,
      progress = excluded.progress,
      updated_at_ms = excluded.updated_at_ms,
      error_code = excluded.error_code,
      error_message = excluded.error_message,
      error_details_json = excluded.error_details_json,
      result_json = excluded.result_json`
  ).run(
    job.jobId,
    job.stage,
    clamp(job.progress, 0, 100),
    job.createdAtMs,
    job.updatedAtMs,
    job.error?.code ?? null,
    job.error?.message ?? null,
    job.error?.details ? stringifyJson(job.error.details) : null,
    job.result ? stringifyJson(job.result) : null
  );
}

function setJob(jobId: string, patch: Partial<UploadJobState>): void {
  const current = getUploadJob(jobId);
  if (!current) return;
  writeUploadJobState({
    ...current,
    ...patch,
    updatedAtMs: Date.now(),
  });
}

function cleanupJobs(maxAgeMs = 30 * 60 * 1000): void {
  const db = getServerDb();
  const threshold = Date.now() - Math.max(60_000, Math.round(maxAgeMs));
  db.prepare(`DELETE FROM upload_jobs WHERE updated_at_ms < ?`).run(threshold);
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

async function processUploadJob(
  jobId: string,
  file: File,
  options?: ScanPipelineOptions
): Promise<void> {
  try {
    const { parsedCsi, inputSource } = await parseUploadedCsiFile(file, (stage, progress) => {
      setJob(jobId, { stage, progress: clamp(progress, 0, 100) });
    });

    setJob(jobId, { stage: "inference", progress: 76 });
    const result = await processScanInference(parsedCsi, inputSource, options);
    setJob(jobId, { stage: "completed", progress: 100, result, error: undefined });
  } catch (error) {
    const scanError: ScanServiceError = toScanServiceError(error);
    setJob(jobId, {
      stage: "failed",
      progress: 100,
      result: undefined,
      error: {
        code: scanError.code,
        message: scanError.message,
        details: scanError.details,
      },
    });
  }
}

export function startUploadJob(file: File, options?: ScanPipelineOptions): UploadJobState {
  cleanupJobs();
  const now = Date.now();
  const state: UploadJobState = {
    jobId: crypto.randomUUID(),
    stage: "queued",
    progress: 0,
    createdAtMs: now,
    updatedAtMs: now,
  };
  writeUploadJobState(state);
  void processUploadJob(state.jobId, file, options);
  return state;
}

export function getUploadJob(jobId: string): UploadJobState | null {
  const row = readUploadJobRow(jobId);
  if (!row) return null;
  return toUploadJobState(row);
}

