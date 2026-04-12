"use client";

import { useState, useCallback } from "react";
import {
  getHistory,
  deleteScanRecord,
  clearHistory,
  exportHistoryJson,
  type ScanRecord,
} from "@/lib/scanHistory";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(ts: number) {
  return new Date(ts).toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function fmtRelative(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function bfColor(cls: string): string {
  const map: Record<string, string> = {
    Healthy: "#22c55e", Underfat: "#f59e0b",
    Overfat: "#f97316", Obese: "#ef4444",
  };
  return map[cls] ?? "#64748b";
}

// ─── Delete confirmation modal ────────────────────────────────────────────────
function ConfirmModal({
  message, onConfirm, onCancel,
}: { message: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(3px)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, padding: 16,
    }}>
      <div style={{
        background: "#0d1117", border: "1px solid #2d3748", borderRadius: "1rem",
        padding: "24px 28px", maxWidth: 360, width: "100%",
        boxShadow: "0 25px 50px rgba(0,0,0,0.6)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <span style={{ fontSize: "1.25rem" }}>🗑</span>
          <p style={{ fontSize: "0.9rem", fontWeight: 700, color: "#e2e8f0" }}>Confirm Delete</p>
        </div>
        <p style={{ fontSize: "0.8rem", color: "#8b95a3", lineHeight: 1.6, marginBottom: 20 }}>{message}</p>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onCancel} style={{
            padding: "7px 16px", borderRadius: "0.5rem",
            background: "#1e2a35", border: "1px solid #2d3748",
            color: "#c8d8e8", fontSize: "0.8rem", cursor: "pointer",
          }}>Cancel</button>
          <button onClick={onConfirm} style={{
            padding: "7px 16px", borderRadius: "0.5rem",
            background: "#7f1d1d", border: "1px solid #ef444440",
            color: "#fca5a5", fontSize: "0.8rem", cursor: "pointer", fontWeight: 600,
          }}>Delete permanently</button>
        </div>
      </div>
    </div>
  );
}

// ─── Single scan card ─────────────────────────────────────────────────────────
function ScanCard({
  record, onDelete, isDeleting,
}: { record: ScanRecord; onDelete: (id: string) => void; isDeleting: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const BFC = bfColor(record.bodyFatClassification);

  return (
    <div style={{
      borderRadius: "0.75rem", overflow: "hidden",
      border: "1px solid #1e2a35", background: "#0d1117",
      transition: "border-color 0.15s, opacity 0.3s",
      opacity: isDeleting ? 0.35 : 1,
      borderColor: isDeleting ? "#7f1d1d" : "#1e2a35",
    }}>
      {/* Header row */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "12px 16px", cursor: "pointer",
        background: "#0a1018",
      }} onClick={() => setExpanded(e => !e)}>

        {/* BF% color dot */}
        <div style={{
          width: 10, height: 10, borderRadius: "50%",
          background: BFC, flexShrink: 0, boxShadow: `0 0 6px ${BFC}60`,
        }} />

        {/* Date + source */}
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: "0.82rem", fontWeight: 600, color: "#e2e8f0" }}>
              {fmt(record.timestamp)}
            </span>
            <span style={{ fontSize: "0.65rem", color: "#4a8fa8" }}>
              {fmtRelative(record.timestamp)}
            </span>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 3, flexWrap: "wrap" }}>
            {/* Source badge */}
            <span style={{
              fontSize: "0.62rem", color: "#4a637a",
              background: "#111827", borderRadius: "99px", padding: "1px 7px",
            }}>
              {record.inputSource}
            </span>
            {/* Inference source */}
            <span style={{
              fontSize: "0.62rem",
              color: record.inferenceSource === "qwen" ? "#22d3ee" : "#4a8fa8",
              background: record.inferenceSource === "qwen" ? "#22d3ee10" : "#111827",
              borderRadius: "99px", padding: "1px 7px",
            }}>
              {record.inferenceSource === "qwen" ? "Qwen AI" : "Rule engine"}
            </span>
          </div>
        </div>

        {/* Key stats */}
        <div style={{ display: "flex", gap: 14, flexShrink: 0 }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "0.62rem", color: "#4a637a", marginBottom: 1 }}>HR</div>
            <div style={{ fontSize: "0.85rem", fontWeight: 700, color: "#e2e8f0", fontFamily: "monospace" }}>
              {record.vitals.heartRate}<span style={{ fontSize: "0.55rem", color: "#4a637a" }}>bpm</span>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "0.62rem", color: "#4a637a", marginBottom: 1 }}>BF%</div>
            <div style={{ fontSize: "0.85rem", fontWeight: 700, color: BFC, fontFamily: "monospace" }}>
              {record.bodyFatPercent.toFixed(1)}<span style={{ fontSize: "0.55rem", color: "#4a637a" }}>%</span>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "0.62rem", color: "#4a637a", marginBottom: 1 }}>HRV</div>
            <div style={{ fontSize: "0.85rem", fontWeight: 700, color: "#e2e8f0", fontFamily: "monospace" }}>
              {record.vitals.hrv.toFixed(0)}<span style={{ fontSize: "0.55rem", color: "#4a637a" }}>ms</span>
            </div>
          </div>
        </div>

        {/* Chevron + delete */}
        <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          <button
            onClick={e => { e.stopPropagation(); onDelete(record.id); }}
            disabled={isDeleting}
            title="Delete this scan"
            style={{
              width: 28, height: 28, borderRadius: "0.4rem",
              background: "#1e1010", border: "1px solid #7f1d1d30",
              color: "#ef4444", cursor: "pointer", fontSize: "0.75rem",
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "background 0.15s",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "#7f1d1d"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "#1e1010"; }}
          >✕</button>
          <span style={{
            color: "#4a8fa8", fontSize: "0.75rem",
            transform: expanded ? "rotate(90deg)" : "none",
            transition: "transform 0.2s", display: "inline-block",
          }}>›</span>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div style={{ padding: "14px 16px", borderTop: "1px solid #1e2a35", background: "#060a0d" }}>
          {/* Vitals row */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 12 }}>
            {[
              ["Heart Rate", `${record.vitals.heartRate.toFixed(0)} bpm`, "#f472b6"],
              ["Breathing", `${record.vitals.breathingRate.toFixed(0)} bpm`, "#a78bfa"],
              ["HRV (RMSSD)", `${record.vitals.hrv.toFixed(1)} ms`, "#34d399"],
            ].map(([label, value, color]) => (
              <div key={label} style={{
                padding: "8px 10px", borderRadius: "0.5rem",
                background: "#0d1117", border: "1px solid #1e2a35",
              }}>
                <div style={{ fontSize: "0.6rem", color: "#4a637a", marginBottom: 2 }}>{label}</div>
                <div style={{ fontSize: "0.85rem", fontWeight: 700, color, fontFamily: "monospace" }}>{value}</div>
              </div>
            ))}
          </div>

          {/* Body metrics row */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 12 }}>
            {[
              ["Height", `${record.bodyMetrics.estimatedHeightCm.toFixed(0)} cm`],
              ["Shoulder W", `${record.bodyMetrics.shoulderWidthCm.toFixed(1)} cm`],
              ["Hip W", `${record.bodyMetrics.hipWidthCm.toFixed(1)} cm`],
              ["Body Fat", `${record.bodyFatPercent.toFixed(1)}% (${record.bodyFatClassification})`],
              ["Est. Waist", `${record.estimatedWaistCm?.toFixed(0) ?? "—"} cm`],
              ["Dominant Motion", Number.isFinite(record.dominantMotionHz) ? `${record.dominantMotionHz.toFixed(2)} Hz` : "—"],
            ].map(([label, value]) => (
              <div key={label} style={{ padding: "7px 10px", borderRadius: "0.5rem", background: "#0d1117", border: "1px solid #1e2a35" }}>
                <div style={{ fontSize: "0.6rem", color: "#4a637a", marginBottom: 2 }}>{label}</div>
                <div style={{ fontSize: "0.75rem", color: "#c8d8e8", fontFamily: "monospace" }}>{value}</div>
              </div>
            ))}
          </div>

          {/* Clinical summary */}
          {record.clinicalSummary && (
            <div style={{
              padding: "10px 12px", borderRadius: "0.5rem",
              background: "#0d1117", borderLeft: "3px solid #22d3ee30",
              border: "1px solid #1e2a35", marginBottom: 10,
            }}>
              <div style={{ fontSize: "0.6rem", color: "#4a8fa8", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 5 }}>Clinical Summary</div>
              <p style={{ fontSize: "0.75rem", color: "#8fa8b8", lineHeight: 1.7, margin: 0 }}>{record.clinicalSummary}</p>
            </div>
          )}

          {/* Recommendations */}
          {record.recommendations?.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {record.recommendations.slice(0, 3).map((r, i) => (
                <div key={i} style={{ display: "flex", gap: 8, fontSize: "0.72rem", color: "#8fa8b8" }}>
                  <span style={{ color: "#22d3ee", flexShrink: 0 }}>→</span>
                  {r}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── History Page ─────────────────────────────────────────────────────────────
export default function HistoryPage() {
  const [records, setRecords] = useState<ScanRecord[]>(() => getHistory());
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [pendingClearAll, setPendingClearAll] = useState(false);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");

  // ── Delete single record ─────────────────────────────────────────────────
  const handleDeleteConfirm = useCallback(() => {
    if (!pendingDelete) return;
    setDeletingIds(s => new Set(s).add(pendingDelete));

    // Short animation delay before actual removal
    setTimeout(() => {
      const success = deleteScanRecord(pendingDelete);  // permanent localStorage delete
      if (success) {
        setRecords(r => r.filter(rec => rec.id !== pendingDelete));
      }
      setDeletingIds(s => { const n = new Set(s); n.delete(pendingDelete!); return n; });
      setPendingDelete(null);
    }, 350);
  }, [pendingDelete]);

  // ── Clear all ─────────────────────────────────────────────────────────────
  const handleClearAllConfirm = useCallback(() => {
    clearHistory();
    setRecords([]);
    setPendingClearAll(false);
  }, []);

  // ── Filtered view ─────────────────────────────────────────────────────────
  const filtered = records.filter(r => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      r.bodyFatClassification.toLowerCase().includes(q) ||
      r.inputSource.includes(q) ||
      new Date(r.timestamp).toLocaleDateString().includes(q)
    );
  });

  return (
    <>
      {/* Confirm modals */}
      {pendingDelete && (
        <ConfirmModal
          message="This scan record will be permanently deleted from your device. This cannot be undone."
          onConfirm={handleDeleteConfirm}
          onCancel={() => setPendingDelete(null)}
        />
      )}
      {pendingClearAll && (
        <ConfirmModal
          message={`This will permanently delete all ${records.length} scan record(s) from your device. There is no recovery once deleted.`}
          onConfirm={handleClearAllConfirm}
          onCancel={() => setPendingClearAll(false)}
        />
      )}

      <div style={{ padding: "24px 28px", maxWidth: 900, margin: "0 auto" }}>
        {/* Page header */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <h1 style={{ fontSize: "1.25rem", fontWeight: 800, color: "#e2e8f0", margin: 0 }}>
                Scan History
              </h1>
              <p style={{ fontSize: "0.75rem", color: "#4a8fa8", marginTop: 4 }}>
                {records.length} record{records.length !== 1 ? "s" : ""} stored locally on this device
              </p>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {records.length > 0 && (
                <>
                  <button onClick={exportHistoryJson} style={{
                    fontSize: "0.72rem", padding: "7px 12px", borderRadius: "0.5rem",
                    background: "#0a1018", border: "1px solid #1e2a35",
                    color: "#8b95a3", cursor: "pointer", fontWeight: 600,
                  }}>
                    ↓ Export JSON
                  </button>
                  <button onClick={() => setPendingClearAll(true)} style={{
                    fontSize: "0.72rem", padding: "7px 12px", borderRadius: "0.5rem",
                    background: "#1e1010", border: "1px solid #7f1d1d40",
                    color: "#ef4444", cursor: "pointer", fontWeight: 600,
                  }}>
                    Clear all
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Privacy note */}
          <div style={{
            marginTop: 12, padding: "8px 12px", borderRadius: "0.5rem",
            background: "#060a0d", border: "1px solid #1e2a35",
            fontSize: "0.65rem", color: "#4a637a",
          }}>
            🔒 All scan data is stored exclusively in this browser&apos;s localStorage. Nothing is sent to any server.
            Deleting a record is immediate and permanent on your device.
          </div>
        </div>

        {/* Search */}
        {records.length > 3 && (
          <div style={{ marginBottom: 16 }}>
            <input
              type="text"
              placeholder="Filter by body fat class, source, date…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{
                width: "100%", padding: "9px 12px", borderRadius: "0.5rem",
                background: "#0d1117", border: "1px solid #1e2a35",
                color: "#c8d8e8", fontSize: "0.8rem", outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>
        )}

        {/* Record list */}
        {filtered.length === 0 ? (
          <div style={{
            padding: "60px 20px", textAlign: "center",
            borderRadius: "1rem", border: "1px dashed #1e2a35",
          }}>
            <div style={{ fontSize: "2rem", marginBottom: 12 }}>📡</div>
            <p style={{ fontSize: "0.85rem", color: "#4a8fa8", fontWeight: 600 }}>
              {records.length === 0 ? "No scans recorded yet" : "No matching records"}
            </p>
            <p style={{ fontSize: "0.72rem", color: "#4a637a", marginTop: 6 }}>
              {records.length === 0
                ? "Run a body scan to start building your history."
                : "Try a different search term."}
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {filtered.map(r => (
              <ScanCard
                key={r.id}
                record={r}
                onDelete={id => setPendingDelete(id)}
                isDeleting={deletingIds.has(r.id)}
              />
            ))}
          </div>
        )}

        {/* Pagination note if many records */}
        {records.length >= 50 && (
          <p style={{ fontSize: "0.65rem", color: "#4a637a", textAlign: "center", marginTop: 16 }}>
            Showing the 50 most recent scans (maximum stored). Export to JSON to archive older records before they roll off.
          </p>
        )}
      </div>
    </>
  );
}
