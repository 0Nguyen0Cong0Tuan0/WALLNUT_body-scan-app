"use client";

import { useEffect, useMemo, useState } from "react";
import type { TrendRecord, TrendSummary } from "@/features/scan/types";

interface TrendsResponse {
  success: boolean;
  summary?: TrendSummary;
  records?: TrendRecord[];
  error?: string;
}

function formatDelta(value: number | null, digits = 1): string {
  if (value === null) return "n/a";
  const rounded = Number(value.toFixed(digits));
  return `${rounded > 0 ? "+" : ""}${rounded}`;
}

function riskColor(level: TrendSummary["riskLevel"] | undefined): string {
  if (level === "high") return "#f87171";
  if (level === "moderate") return "#fbbf24";
  return "#34d399";
}

export function VitalsTrendsPanel() {
  const [windowDays, setWindowDays] = useState(30);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<TrendSummary | null>(null);
  const [records, setRecords] = useState<TrendRecord[]>([]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await fetch(`/api/v1/trends?windowDays=${windowDays}&limit=12`, {
          cache: "no-store",
        });
        const data = (await response.json()) as TrendsResponse;
        if (cancelled) return;
        if (!response.ok || !data.success || !data.summary) {
          throw new Error(data.error ?? "Failed to load trend analytics.");
        }
        setSummary(data.summary);
        setRecords(data.records ?? []);
      } catch (loadError) {
        if (cancelled) return;
        setSummary(null);
        setRecords([]);
        setError(loadError instanceof Error ? loadError.message : "Failed to load trends.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [windowDays]);

  const latest = summary?.latest ?? null;
  const sourceMix = useMemo(() => {
    if (!summary) return "n/a";
    const entries = Object.entries(summary.byInputSource);
    if (entries.length === 0) return "n/a";
    return entries.map(([name, count]) => `${name}: ${count}`).join(" · ");
  }, [summary]);

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div
        className="rounded-xl p-5 flex flex-col gap-4 md:flex-row md:items-center md:justify-between"
        style={{ background: "var(--color-surface-2)", border: "1px solid var(--color-border)" }}
      >
        <div>
          <p className="text-lg font-semibold" style={{ color: "var(--color-text-primary)" }}>
            Vitals trend analytics
          </p>
          <p className="text-sm mt-1" style={{ color: "var(--color-text-muted)" }}>
            Longitudinal signals from upload, live, and simulated scans.
          </p>
        </div>
        <div className="inline-flex rounded-lg p-1 gap-1" style={{ background: "var(--color-surface-1)" }}>
          {[7, 30, 90].map((days) => (
            <button
              key={days}
              onClick={() => setWindowDays(days)}
              className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                windowDays === days ? "bg-cyan-500/20 text-cyan-300" : "text-slate-400"
              }`}
            >
              {days}d
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div
          className="rounded-xl p-6 text-sm"
          style={{ background: "var(--color-surface-2)", border: "1px solid var(--color-border)", color: "var(--color-text-muted)" }}
        >
          Loading trend summary...
        </div>
      )}

      {error && (
        <div
          className="rounded-xl p-6 text-sm"
          style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.25)", color: "#f87171" }}
        >
          {error}
        </div>
      )}

      {!loading && !error && summary && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            <div className="rounded-xl p-4" style={{ background: "var(--color-surface-2)", border: "1px solid var(--color-border)" }}>
              <p className="text-xs uppercase tracking-wide" style={{ color: "var(--color-text-muted)" }}>
                Total scans
              </p>
              <p className="text-2xl font-semibold mt-2" style={{ color: "var(--color-text-primary)" }}>
                {summary.totalScans}
              </p>
            </div>
            <div className="rounded-xl p-4" style={{ background: "var(--color-surface-2)", border: "1px solid var(--color-border)" }}>
              <p className="text-xs uppercase tracking-wide" style={{ color: "var(--color-text-muted)" }}>
                Risk level
              </p>
              <p className="text-2xl font-semibold mt-2" style={{ color: riskColor(summary.riskLevel) }}>
                {summary.riskLevel}
              </p>
            </div>
            <div className="rounded-xl p-4" style={{ background: "var(--color-surface-2)", border: "1px solid var(--color-border)" }}>
              <p className="text-xs uppercase tracking-wide" style={{ color: "var(--color-text-muted)" }}>
                Δ body fat
              </p>
              <p className="text-2xl font-semibold mt-2" style={{ color: "var(--color-text-primary)" }}>
                {formatDelta(summary.deltas.bodyFatPercent)}%
              </p>
            </div>
            <div className="rounded-xl p-4" style={{ background: "var(--color-surface-2)", border: "1px solid var(--color-border)" }}>
              <p className="text-xs uppercase tracking-wide" style={{ color: "var(--color-text-muted)" }}>
                Δ HRV
              </p>
              <p className="text-2xl font-semibold mt-2" style={{ color: "var(--color-text-primary)" }}>
                {formatDelta(summary.deltas.hrv)} ms
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="rounded-xl p-5 space-y-3" style={{ background: "var(--color-surface-2)", border: "1px solid var(--color-border)" }}>
              <p className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
                Latest scan snapshot
              </p>
              {latest ? (
                <>
                  <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                    {new Date(latest.timestampMs).toLocaleString()} · {latest.inputSource}
                  </p>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <p style={{ color: "var(--color-text-secondary)" }}>HR: <span style={{ color: "var(--color-text-primary)" }}>{latest.heartRate} bpm</span></p>
                    <p style={{ color: "var(--color-text-secondary)" }}>Resp: <span style={{ color: "var(--color-text-primary)" }}>{latest.breathingRate} rpm</span></p>
                    <p style={{ color: "var(--color-text-secondary)" }}>HRV: <span style={{ color: "var(--color-text-primary)" }}>{latest.hrv} ms</span></p>
                    <p style={{ color: "var(--color-text-secondary)" }}>Quality: <span style={{ color: "var(--color-text-primary)" }}>{latest.qualityGrade} ({latest.qualityScore.toFixed(2)})</span></p>
                  </div>
                  <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                    Source mix: {sourceMix}
                  </p>
                </>
              ) : (
                <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
                  No scan history yet.
                </p>
              )}
            </div>

            <div className="rounded-xl p-5 space-y-3" style={{ background: "var(--color-surface-2)", border: "1px solid var(--color-border)" }}>
              <p className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
                Anomaly flags
              </p>
              {summary.anomalies.length > 0 ? (
                <div className="space-y-2">
                  {summary.anomalies.map((anomaly) => (
                    <p key={anomaly} className="text-sm" style={{ color: "#fbbf24" }}>
                      - {anomaly}
                    </p>
                  ))}
                </div>
              ) : (
                <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
                  No risk anomalies in this window.
                </p>
              )}
            </div>
          </div>

          {records.length > 0 && (
            <div className="rounded-xl p-5" style={{ background: "var(--color-surface-2)", border: "1px solid var(--color-border)" }}>
              <p className="text-sm font-semibold mb-3" style={{ color: "var(--color-text-primary)" }}>
                Recent records
              </p>
              <div className="space-y-2">
                {records.slice(0, 8).map((record) => (
                  <div
                    key={record.recordId}
                    className="flex flex-col gap-1 rounded-lg px-3 py-2 md:flex-row md:items-center md:justify-between"
                    style={{ background: "var(--color-surface-1)" }}
                  >
                    <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                      {new Date(record.timestampMs).toLocaleString()} · {record.inputSource}
                    </p>
                    <p className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
                      HR {record.heartRate} · Resp {record.breathingRate} · HRV {record.hrv} · Q {record.qualityGrade}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

