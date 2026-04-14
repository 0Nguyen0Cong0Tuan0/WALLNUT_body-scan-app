import { NextResponse } from "next/server";
import { getServerDb } from "@/lib/serverDb";

interface QuotaInfo {
  model: string;
  totalQuota: number;
  usedQuota: number;
  remainingQuota: number;
  unit: string;
  expiresAt: string | null;
}

function normalizeKey(key?: string | null): string | null {
  const trimmed = key?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/^["']|["']$/g, "");
}

function getQuotaFromEnv(): QuotaInfo[] | null {
  // Read exact quota from environment variables (set by user from dashboard)
  const turboRemaining = parseInt(process.env.QWEN_TURBO_REMAINING || "", 10);
  const plusRemaining = parseInt(process.env.QWEN_PLUS_REMAINING || "", 10);
  const maxRemaining = parseInt(process.env.QWEN_MAX_REMAINING || "", 10);
  
  // If none are set, return null to use fallback
  if (!turboRemaining && !plusRemaining && !maxRemaining) {
    return null;
  }
  
  const defaultTotal = 1000000;
  const quotas: QuotaInfo[] = [];
  
  if (turboRemaining) {
    quotas.push({
      model: "qwen-turbo",
      totalQuota: defaultTotal,
      usedQuota: defaultTotal - turboRemaining,
      remainingQuota: turboRemaining,
      unit: "tokens",
      expiresAt: null,
    });
  }
  
  if (plusRemaining) {
    quotas.push({
      model: "qwen-plus",
      totalQuota: defaultTotal,
      usedQuota: defaultTotal - plusRemaining,
      remainingQuota: plusRemaining,
      unit: "tokens",
      expiresAt: null,
    });
  }
  
  if (maxRemaining) {
    quotas.push({
      model: "qwen-max",
      totalQuota: defaultTotal,
      usedQuota: defaultTotal - maxRemaining,
      remainingQuota: maxRemaining,
      unit: "tokens",
      expiresAt: null,
    });
  }
  
  return quotas;
}

function getLocalUsage(): Record<string, number> {
  try {
    const db = getServerDb();
    const rows = db.prepare(
      `SELECT model_id, successful_calls FROM analysis_model_usage WHERE model_id IN ('qwen-turbo', 'qwen-plus', 'qwen-max')`
    ).all() as Array<{ model_id: string; successful_calls: number }>;
    
    const usage: Record<string, number> = {};
    for (const row of rows) {
      usage[row.model_id] = row.successful_calls;
    }
    return usage;
  } catch {
    return {};
  }
}

export async function GET() {
  try {
    // Try to get quota from environment variables (user copies from dashboard)
    const envQuotas = getQuotaFromEnv();
    
    if (envQuotas && envQuotas.length > 0) {
      return NextResponse.json({
        success: true,
        quotas: envQuotas,
        source: "from-dashboard",
      });
    }

    // Fallback: Track usage locally from database (populated by actual API calls)
    const localUsage = getLocalUsage();
    const defaultQuota = 1000000;
    
    const quotas: QuotaInfo[] = [
      {
        model: "qwen-turbo",
        totalQuota: defaultQuota,
        usedQuota: (localUsage["qwen-turbo"] || 0) * 1000,
        remainingQuota: defaultQuota - ((localUsage["qwen-turbo"] || 0) * 1000),
        unit: "tokens",
        expiresAt: null,
      },
      {
        model: "qwen-plus",
        totalQuota: defaultQuota,
        usedQuota: (localUsage["qwen-plus"] || 0) * 1000,
        remainingQuota: defaultQuota - ((localUsage["qwen-plus"] || 0) * 1000),
        unit: "tokens",
        expiresAt: null,
      },
      {
        model: "qwen-max",
        totalQuota: defaultQuota,
        usedQuota: (localUsage["qwen-max"] || 0) * 1000,
        remainingQuota: defaultQuota - ((localUsage["qwen-max"] || 0) * 1000),
        unit: "tokens",
        expiresAt: null,
      },
    ];

    return NextResponse.json({
      success: true,
      quotas,
      source: "local-estimate",
      note: "Set QWEN_TURBO_REMAINING, QWEN_PLUS_REMAINING, QWEN_MAX_REMAINING in .env.local for exact quota.",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[QUOTA API ERROR]", msg);
    return NextResponse.json(
      { error: msg },
      { status: 500 }
    );
  }
}
