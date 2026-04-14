"use client";

import React, { useState, useEffect } from "react";
import { Icon } from "@/components/ui/Icons";

interface QuotaInfo {
  model: string;
  totalQuota: number;
  usedQuota: number;
  remainingQuota: number;
  unit: string;
  expiresAt: string | null;
}

interface QuotaResponse {
  success: boolean;
  quotas?: QuotaInfo[];
  error?: string;
  note?: string;
  source?: "dashscope-api" | "local-estimate";
}

function formatNumber(num: number): string {
  // Show full number with comma separators for clarity
  return num.toLocaleString("en-US");
}

function getModelDisplayName(modelId: string): string {
  const names: Record<string, string> = {
    "qwen-turbo": "Qwen Turbo",
    "qwen-plus": "Qwen Plus",
    "qwen-max": "Qwen Max",
  };
  return names[modelId] || modelId;
}

function ProgressBar({ used, total }: { used: number; total: number }) {
  const percentage = Math.min(100, Math.max(0, (used / total) * 100));
  const remainingPercentage = 100 - percentage;
  
  let colorClass = "bg-emerald-500";
  if (percentage > 50) colorClass = "bg-yellow-500";
  if (percentage > 80) colorClass = "bg-red-500";

  return (
    <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: "var(--color-surface-2)" }}>
      <div 
        className={`h-full ${colorClass} transition-all duration-500`}
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
}

export default function QuotaPage() {
  const [quotas, setQuotas] = useState<QuotaInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [source, setSource] = useState<"dashscope-api" | "local-estimate" | null>(null);

  const fetchQuota = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch("/api/v1/quota");
      const data: QuotaResponse = await response.json();
      
      if (data.success && data.quotas) {
        setQuotas(data.quotas);
        setNote(data.note || null);
        setSource(data.source || null);
      } else {
        setError(data.error || "Failed to fetch quota information");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQuota();
  }, []);

  const totalUsed = quotas.reduce((sum, q) => sum + q.usedQuota, 0);
  const totalAvailable = quotas.reduce((sum, q) => sum + q.totalQuota, 0);

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="mb-6">
        <h1 
          className="text-xl font-semibold flex items-center gap-2"
          style={{ color: "var(--color-text-primary)" }}
        >
          <span className="w-5 h-5"><Icon.Chart /></span>
          API Quota & Usage
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--color-text-muted)" }}>
          Monitor your Alibaba Cloud DashScope API usage and remaining quota
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div 
          className="rounded-lg p-4 border"
          style={{ background: "var(--color-surface-1)", borderColor: "var(--color-border)" }}
        >
          <p className="text-xs uppercase tracking-wide" style={{ color: "var(--color-text-muted)" }}>
            Total Available
          </p>
          <p className="text-2xl font-semibold mt-1" style={{ color: "var(--color-text-primary)" }}>
            {formatNumber(totalAvailable)}
          </p>
          <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>tokens</p>
        </div>
        
        <div 
          className="rounded-lg p-4 border"
          style={{ background: "var(--color-surface-1)", borderColor: "var(--color-border)" }}
        >
          <p className="text-xs uppercase tracking-wide" style={{ color: "var(--color-text-muted)" }}>
            Total Used
          </p>
          <p className="text-2xl font-semibold mt-1" style={{ color: "var(--color-text-primary)" }}>
            {formatNumber(totalUsed)}
          </p>
          <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>tokens</p>
        </div>
        
        <div 
          className="rounded-lg p-4 border"
          style={{ background: "var(--color-surface-1)", borderColor: "var(--color-border)" }}
        >
          <p className="text-xs uppercase tracking-wide" style={{ color: "var(--color-text-muted)" }}>
            Remaining
          </p>
          <p className="text-2xl font-semibold mt-1" style={{ color: "var(--color-text-primary)" }}>
            {formatNumber(totalAvailable - totalUsed)}
          </p>
          <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>tokens</p>
        </div>
      </div>

      {/* Refresh Button */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-medium" style={{ color: "var(--color-text-primary)" }}>
          Model Quota Details
        </h2>
        <button
          onClick={fetchQuota}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors hover:opacity-80 disabled:opacity-50"
          style={{ background: "var(--color-surface-2)", color: "var(--color-text-primary)" }}
        >
          <span className={`w-4 h-4 ${loading ? "animate-spin" : ""}`}><Icon.Refresh /></span>
          Refresh
        </button>
      </div>

      {/* Error State */}
      {error && (
        <div 
          className="rounded-lg p-4 mb-4 border"
          style={{ background: "rgba(248,113,113,0.1)", borderColor: "#f87171" }}
        >
          <p className="text-sm" style={{ color: "#f87171" }}>{error}</p>
        </div>
      )}


      {/* Quota List */}
      <div className="space-y-3">
        {loading ? (
          // Loading skeleton
          Array.from({ length: 4 }).map((_, i) => (
            <div 
              key={i}
              className="rounded-lg p-4 border animate-pulse"
              style={{ background: "var(--color-surface-1)", borderColor: "var(--color-border)" }}
            >
              <div className="h-4 w-32 rounded mb-2" style={{ background: "var(--color-surface-2)" }} />
              <div className="h-2 w-full rounded" style={{ background: "var(--color-surface-2)" }} />
            </div>
          ))
        ) : quotas.length === 0 ? (
          <div 
            className="rounded-lg p-6 text-center border"
            style={{ background: "var(--color-surface-1)", borderColor: "var(--color-border)" }}
          >
            <p style={{ color: "var(--color-text-muted)" }}>No quota information available</p>
          </div>
        ) : (
          quotas.map((quota) => (
            <div 
              key={quota.model}
              className="rounded-lg p-4 border"
              style={{ background: "var(--color-surface-1)", borderColor: "var(--color-border)" }}
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-medium text-sm" style={{ color: "var(--color-text-primary)" }}>
                    {getModelDisplayName(quota.model)}
                  </h3>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium" style={{ color: "var(--color-text-primary)" }}>
                    {formatNumber(quota.remainingQuota)} {quota.unit}
                  </p>
                  <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                    remaining
                  </p>
                </div>
              </div>
              
              <ProgressBar used={quota.usedQuota} total={quota.totalQuota} />
              
              <div className="flex justify-between mt-2 text-xs" style={{ color: "var(--color-text-muted)" }}>
                <span>{formatNumber(quota.usedQuota)} used</span>
                <span>{formatNumber(quota.totalQuota)} total</span>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Footer Info */}
      <div 
        className="mt-6 p-4 rounded-lg border text-xs"
        style={{ background: "var(--color-surface-1)", borderColor: "var(--color-border)", color: "var(--color-text-muted)" }}
      >
        <p className="font-medium mb-1" style={{ color: "var(--color-text-primary)" }}>
          About API Quota
        </p>
        <p>
          Alibaba Cloud provides 1 million free tokens for new accounts. 
          Quota is shared across all Qwen models. 
          For real-time quota tracking, configure your Alibaba Cloud AccessKey in environment variables.
        </p>
      </div>
    </div>
  );
}
