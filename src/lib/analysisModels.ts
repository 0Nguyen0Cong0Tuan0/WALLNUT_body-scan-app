import { getServerDb, parseJsonField, stringifyJson } from "@/lib/serverDb";
import { ModelAuthError, ModelConfigError, ModelProviderError } from "@/lib/scanErrors";

export type AnalysisModelId = "none" | "qwen-plus" | "qwen-turbo" | "qwen-max";

export interface AnalysisModelQuota {
  remainingCalls: number | null;
  limitCalls: number | null;
  usedCalls: number;
  source: "tracked" | "unbounded" | "none";
}

export interface AnalysisModelOption {
  modelId: AnalysisModelId;
  label: string;
  provider: "none" | "dashscope-qwen";
  description: string;
  enabled: boolean;
  disabledReason?: string;
  skipAnalysis: boolean;
  quota: AnalysisModelQuota;
}

export interface AnalysisModelResponse {
  modelId: Exclude<AnalysisModelId, "none">;
  provider: "dashscope-qwen";
  content: Record<string, unknown>;
  usageTokens: number;
}

export interface AnalysisRuntimeContext {
  prompt: string;
  // Future-ready hook: when RAG is enabled, retrieved context can be injected here.
  ragContext?: string | null;
}

interface ModelUsageRow {
  model_id: string;
  successful_calls: number;
  estimated_tokens: number;
  last_error_json: string | null;
  updated_at_ms: number;
}

interface DashScopeErrorShape {
  code?: string;
  message?: string;
  type?: string;
}

const DASHSCOPE_API_BASE = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const DEFAULT_MODEL_LIMITS: Record<Exclude<AnalysisModelId, "none">, number> = {
  "qwen-plus": 400,
  "qwen-turbo": 1200,
  "qwen-max": 180,
};

const QWEN_MODELS: Array<{
  modelId: Exclude<AnalysisModelId, "none">;
  label: string;
  description: string;
}> = [
  {
    modelId: "qwen-plus",
    label: "Qwen Plus",
    description: "Balanced quality and cost for clinical-style interpretation.",
  },
  {
    modelId: "qwen-turbo",
    label: "Qwen Turbo",
    description: "Faster and cheaper for high-volume scans.",
  },
  {
    modelId: "qwen-max",
    label: "Qwen Max",
    description: "Highest quality, recommended for difficult cases.",
  },
];

function normalizeApiKey(key?: string | null): string | null {
  const trimmed = key?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/^["']|["']$/g, "");
}

export function normalizeAnalysisModelId(value?: string | null): AnalysisModelId {
  const candidate = (value ?? "").trim().toLowerCase() as AnalysisModelId;
  if (candidate === "none") return "none";
  if (candidate === "qwen-plus" || candidate === "qwen-turbo" || candidate === "qwen-max") {
    return candidate;
  }
  return "none";
}

function resolveDashScopeApiKey(): string | null {
  return normalizeApiKey(process.env.QWEN_API_KEY) ?? normalizeApiKey(process.env.DASHSCOPE_API_KEY);
}

function parseModelLimitsFromEnv(): Record<Exclude<AnalysisModelId, "none">, number> | null {
  const raw = process.env.QWEN_MODEL_QUOTA_LIMITS_JSON;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Record<Exclude<AnalysisModelId, "none">, unknown>>;
    return {
      "qwen-plus": Number.isFinite(Number(parsed["qwen-plus"])) ? Math.max(0, Math.round(Number(parsed["qwen-plus"]))) : DEFAULT_MODEL_LIMITS["qwen-plus"],
      "qwen-turbo": Number.isFinite(Number(parsed["qwen-turbo"])) ? Math.max(0, Math.round(Number(parsed["qwen-turbo"]))) : DEFAULT_MODEL_LIMITS["qwen-turbo"],
      "qwen-max": Number.isFinite(Number(parsed["qwen-max"])) ? Math.max(0, Math.round(Number(parsed["qwen-max"]))) : DEFAULT_MODEL_LIMITS["qwen-max"],
    };
  } catch {
    return null;
  }
}

function resolveModelLimits(): Record<Exclude<AnalysisModelId, "none">, number> {
  return parseModelLimitsFromEnv() ?? DEFAULT_MODEL_LIMITS;
}

function readModelUsage(modelId: Exclude<AnalysisModelId, "none">): ModelUsageRow | null {
  const db = getServerDb();
  const row = db
    .prepare(
      `SELECT model_id, successful_calls, estimated_tokens, last_error_json, updated_at_ms
       FROM analysis_model_usage
       WHERE model_id = ?`
    )
    .get(modelId) as ModelUsageRow | undefined;
  return row ?? null;
}

function estimateTokensFromText(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return Math.max(1, Math.round(trimmed.length / 4));
}

function recordModelSuccess(modelId: Exclude<AnalysisModelId, "none">, usageTokens: number): void {
  const db = getServerDb();
  const now = Date.now();
  const safeTokens = Math.max(0, Math.round(usageTokens));
  db.prepare(
    `INSERT INTO analysis_model_usage (model_id, successful_calls, estimated_tokens, last_error_json, updated_at_ms)
     VALUES (?, 1, ?, NULL, ?)
     ON CONFLICT(model_id) DO UPDATE SET
       successful_calls = successful_calls + 1,
       estimated_tokens = estimated_tokens + excluded.estimated_tokens,
       last_error_json = NULL,
       updated_at_ms = excluded.updated_at_ms`
  ).run(modelId, safeTokens, now);
}

function recordModelError(modelId: Exclude<AnalysisModelId, "none">, error: Record<string, unknown>): void {
  const db = getServerDb();
  const now = Date.now();
  db.prepare(
    `INSERT INTO analysis_model_usage (model_id, successful_calls, estimated_tokens, last_error_json, updated_at_ms)
     VALUES (?, 0, 0, ?, ?)
     ON CONFLICT(model_id) DO UPDATE SET
       last_error_json = excluded.last_error_json,
       updated_at_ms = excluded.updated_at_ms`
  ).run(modelId, stringifyJson(error), now);
}

function parseDashScopeError(payload: unknown): DashScopeErrorShape {
  if (!payload || typeof payload !== "object") return {};
  const err = (payload as { error?: unknown }).error;
  if (err && typeof err === "object") {
    return err as DashScopeErrorShape;
  }
  return payload as DashScopeErrorShape;
}

function parseJsonObjectContent(content: string): Record<string, unknown> {
  const trimmed = content.trim();
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenced?.[1]) {
      return JSON.parse(fenced[1]) as Record<string, unknown>;
    }
    throw new ModelProviderError("Model response is not valid JSON.", {
      responsePreview: trimmed.slice(0, 320),
    });
  }
}

function buildModelMessages(runtime: AnalysisRuntimeContext): Array<{ role: "user" | "system"; content: string }> {
  if (!runtime.ragContext || runtime.ragContext.trim().length === 0) {
    return [{ role: "user", content: runtime.prompt }];
  }
  return [
    {
      role: "system",
      content:
        "Retrieved knowledge is attached below. Prioritize it only when consistent with the provided scan metrics; otherwise rely on scan metrics.",
    },
    {
      role: "user",
      content: `${runtime.prompt}\n\n[RAG_CONTEXT]\n${runtime.ragContext.trim()}`,
    },
  ];
}

export function listAnalysisModelOptions(): AnalysisModelOption[] {
  const apiKeyConfigured = Boolean(resolveDashScopeApiKey());
  const modelLimits = resolveModelLimits();

  const options: AnalysisModelOption[] = [
    {
      modelId: "none",
      label: "Skip AI analysis",
      provider: "none",
      description: "Use deterministic rule engine only (no LLM call).",
      enabled: true,
      skipAnalysis: true,
      quota: {
        remainingCalls: null,
        limitCalls: null,
        usedCalls: 0,
        source: "none",
      },
    },
  ];

  for (const model of QWEN_MODELS) {
    const usage = readModelUsage(model.modelId);
    const usedCalls = usage?.successful_calls ?? 0;
    const limitCalls = modelLimits[model.modelId];
    const remainingCalls = Math.max(0, limitCalls - usedCalls);
    const lastError = parseJsonField<Record<string, unknown> | null>(usage?.last_error_json, null);
    options.push({
      modelId: model.modelId,
      label: model.label,
      provider: "dashscope-qwen",
      description: model.description,
      enabled: apiKeyConfigured,
      disabledReason: apiKeyConfigured
        ? undefined
        : "Missing QWEN_API_KEY or DASHSCOPE_API_KEY.",
      skipAnalysis: false,
      quota: {
        remainingCalls,
        limitCalls,
        usedCalls,
        source: "tracked",
      },
      ...(lastError?.message
        ? {
            disabledReason: apiKeyConfigured ? String(lastError.message) : "Missing QWEN_API_KEY or DASHSCOPE_API_KEY.",
          }
        : {}),
    });
  }

  return options;
}

export async function runAnalysisModel(
  modelId: AnalysisModelId,
  runtime: AnalysisRuntimeContext
): Promise<AnalysisModelResponse | null> {
  const selectedModel = normalizeAnalysisModelId(modelId);
  if (selectedModel === "none") return null;

  const apiKey = resolveDashScopeApiKey();
  if (!apiKey) {
    throw new ModelConfigError("No Qwen API key configured.", {
      requiredVariables: ["QWEN_API_KEY", "DASHSCOPE_API_KEY"],
      selectedModel,
    });
  }

  const requestBody = {
    model: selectedModel,
    messages: buildModelMessages(runtime),
    temperature: 0.2,
    response_format: { type: "json_object" as const },
  };

  let response: Response;
  try {
    response = await fetch(`${DASHSCOPE_API_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    recordModelError(selectedModel, { stage: "network", message: reason });
    throw new ModelProviderError("Unable to reach DashScope model endpoint.", {
      selectedModel,
      reason,
    });
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const parsedError = parseDashScopeError(payload);
    const details = {
      selectedModel,
      status: response.status,
      type: parsedError.type,
      code: parsedError.code,
      message: parsedError.message,
    };
    recordModelError(selectedModel, { stage: "http", ...details });
    if (response.status === 401 || response.status === 403) {
      throw new ModelAuthError(
        parsedError.message || "DashScope rejected the API key. Generate a valid Model Studio key.",
        details
      );
    }
    throw new ModelProviderError(parsedError.message || "DashScope model call failed.", details);
  }

  const content = (payload as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") {
    recordModelError(selectedModel, {
      stage: "response_shape",
      message: "Missing choices[0].message.content",
    });
    throw new ModelProviderError("Model response is missing content.", {
      selectedModel,
    });
  }

  const parsedContent = parseJsonObjectContent(content);
  const usageTokensRaw = Number(
    (payload as { usage?: { total_tokens?: number } }).usage?.total_tokens
  );
  const usageTokens = Number.isFinite(usageTokensRaw)
    ? Math.max(0, Math.round(usageTokensRaw))
    : estimateTokensFromText(runtime.prompt) + estimateTokensFromText(content);
  recordModelSuccess(selectedModel, usageTokens);

  return {
    modelId: selectedModel,
    provider: "dashscope-qwen",
    content: parsedContent,
    usageTokens,
  };
}

