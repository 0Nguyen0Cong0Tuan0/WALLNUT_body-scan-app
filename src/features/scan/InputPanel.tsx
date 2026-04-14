"use client";

import React, { useState, useEffect } from "react";
import { Icon } from "@/components/ui/Icons";
import { FileDropZone } from "./FileDropZone";
import { AnalysisModelId, AnalysisModelOption, InputMode, ScanRequest } from "./types";

interface LiveStatusNode {
  nodeId: number;
  healthy: boolean;
  ageMs: number;
}

interface LiveStatusResponse {
  success: boolean;
  status?: {
    port: number;
    healthy: boolean;
    activeNodes: number;
    nodes: LiveStatusNode[];
  };
  error?: string;
}

interface AnalysisModelsResponse {
  success: boolean;
  models?: AnalysisModelOption[];
  error?: string;
}

// Clean model labels - no category badges needed

export function InputPanel({ onScan, error, uploadProgress }: {
  onScan: (request: ScanRequest) => void;
  error: string | null;
  uploadProgress: number | null;
}) {
  const [mode, setMode] = useState<InputMode>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [livePort, setLivePort] = useState("8080");
  const [liveStatus, setLiveStatus] = useState<LiveStatusResponse["status"] | null>(null);
  const [liveStatusLoading, setLiveStatusLoading] = useState(false);
  const [liveStatusError, setLiveStatusError] = useState<string | null>(null);
  const [modelOptions, setModelOptions] = useState<AnalysisModelOption[]>([
    {
      modelId: "none",
      label: "None",
      provider: "none",
      description: "Use deterministic rule engine only.",
      enabled: true,
      skipAnalysis: true,
      quota: {
        remainingCalls: null,
        limitCalls: null,
        usedCalls: 0,
        source: "none",
      },
    },
  ]);
  const [analysisModel, setAnalysisModel] = useState<AnalysisModelId>("none");
  const [modelLoading, setModelLoading] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== "live") return;

    const parsedPort = Number(livePort);
    if (!Number.isFinite(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
      setLiveStatus(null);
      setLiveStatusError("Live port must be between 1 and 65535.");
      return;
    }

    let cancelled = false;

    const pullStatus = async () => {
      try {
        setLiveStatusLoading(true);
        const response = await fetch(`/api/v1/status?port=${parsedPort}&timeoutMs=35`, { cache: "no-store" });
        const data = (await response.json()) as LiveStatusResponse;
        if (cancelled) return;
        if (!response.ok || !data.success) {
          setLiveStatus(null);
          setLiveStatusError(data.error ?? "Unable to read mesh status.");
          return;
        }
        setLiveStatus(data.status ?? null);
        setLiveStatusError(null);
      } catch (statusError) {
        if (cancelled) return;
        setLiveStatus(null);
        setLiveStatusError(statusError instanceof Error ? statusError.message : "Unable to read mesh status.");
      } finally {
        if (!cancelled) setLiveStatusLoading(false);
      }
    };

    void pullStatus();
    const intervalId = setInterval(() => {
      void pullStatus();
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [mode, livePort]);

  useEffect(() => {
    let cancelled = false;

    const loadModels = async () => {
      try {
        setModelLoading(true);
        const response = await fetch("/api/v1/analysis/models", { cache: "no-store" });
        const data = (await response.json()) as AnalysisModelsResponse;
        if (cancelled) return;
        if (!response.ok || !data.success || !Array.isArray(data.models)) {
          throw new Error(data.error ?? "Unable to load analysis models.");
        }
        setModelOptions(data.models);
        setModelError(null);
        setAnalysisModel((previous) => {
          const selected = data.models?.find((model) => model.modelId === previous);
          if (!selected || (!selected.enabled && !selected.skipAnalysis)) return "none";
          return previous;
        });
      } catch (loadError) {
        if (cancelled) return;
        setModelError(loadError instanceof Error ? loadError.message : "Unable to load analysis models.");
      } finally {
        if (!cancelled) setModelLoading(false);
      }
    };

    void loadModels();
    return () => {
      cancelled = true;
    };
  }, []);

  const tabClass = (m: InputMode) =>
    `flex-1 flex items-center justify-center gap-2 py-2 text-xs font-medium rounded-md transition-colors cursor-pointer ${
      mode === m
        ? "text-cyan-400 bg-cyan-500/10 border border-cyan-500/30"
        : "border border-transparent hover:border-[var(--color-border)]"
    }`;

  const parsedLivePort = Number(livePort);
  const validLivePort = Number.isFinite(parsedLivePort) && parsedLivePort >= 1 && parsedLivePort <= 65535;
  const selectedModel = modelOptions.find((item) => item.modelId === analysisModel);
  const modelSelectionInvalid = Boolean(
    selectedModel && !selectedModel.skipAnalysis && !selectedModel.enabled
  );
  const runDisabled =
    (mode === "upload" && !file) ||
    (mode === "live" && !validLivePort) ||
    modelSelectionInvalid;

  return (
    <div className="space-y-5">
      {/* Mode selector */}
      <div>
        <p className="label mb-2">Input Source</p>
        <div className="flex gap-1.5 p-1 rounded-lg" style={{ background: "var(--color-surface-2)", border: "1px solid var(--color-border)" }}>
          {(["upload","live","simulate"] as InputMode[]).map(m => (
            <button key={m} className={tabClass(m)} onClick={() => setMode(m)}>
              <span className="w-3.5 h-3.5">
                {m === "upload" ? <Icon.Upload /> : m === "live" ? <Icon.Wifi /> : <Icon.Dice />}
              </span>
              {m === "upload" ? "File Upload" : m === "live" ? "Live Device" : "Simulate"}
            </button>
          ))}
        </div>
      </div>

      {/* Mode content */}
      {mode === "upload" && <FileDropZone onFile={setFile} />}

      {mode === "live" && (
        <div className="space-y-3">
          <div className="rounded-lg px-3 py-2.5 text-sm" style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.2)", color: "var(--color-text-secondary)" }}>
            Requires active CSI UDP traffic from ESP32 nodes. Live scans are blocked when hardware traffic is absent.
          </div>
          <div>
            <label className="label block mb-1.5">CSI UDP Port</label>
            <input
              type="number"
              min={1}
              max={65535}
              value={livePort}
              onChange={e => setLivePort(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-sm font-mono outline-none focus:ring-1 focus:ring-cyan-500/50"
              style={{ background: "var(--color-surface-2)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }} />
          </div>

          <div className="rounded-lg px-3 py-2.5 text-xs space-y-1.5" style={{ background: "var(--color-surface-2)", border: "1px solid var(--color-border)" }}>
            <div className="flex items-center justify-between">
              <span style={{ color: "var(--color-text-muted)" }}>Mesh health</span>
              <span style={{ color: liveStatus?.healthy ? "#34d399" : "#f87171" }}>
                {liveStatusLoading
                  ? "Checking..."
                  : liveStatus?.healthy
                  ? "Healthy"
                  : "No active nodes"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span style={{ color: "var(--color-text-muted)" }}>Active nodes</span>
              <span style={{ color: "var(--color-text-primary)" }}>{liveStatus?.activeNodes ?? 0}</span>
            </div>
            {liveStatusError && (
              <p className="text-[11px]" style={{ color: "#f87171" }}>{liveStatusError}</p>
            )}
          </div>

          <ol className="text-xs space-y-1.5 list-decimal list-inside" style={{ color: "var(--color-text-muted)" }}>
            <li>Flash <code className="text-cyan-500">esp32-csi-node.bin</code> from RuView releases</li>
            <li>Start CSI UDP stream (RuView record or sensing service)</li>
            <li>Use the same UDP port here and run live scan</li>
          </ol>
        </div>
      )}

      {mode === "simulate" && (
        <div className="rounded-lg p-4 text-sm space-y-2" style={{ background: "var(--color-surface-2)", border: "1px solid var(--color-border)", color: "var(--color-text-secondary)" }}>
          <p className="font-medium" style={{ color: "var(--color-text-primary)" }}>Simulation Mode</p>
          <p>Runs the full DSP pipeline with mathematically generated CSI data. Identical Qwen analysis. Used when no recording is available.</p>
          <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>Tip: generate real sample files with <code className="text-cyan-500">python test_data/signal/generate_signals.py</code></p>
        </div>
      )}

      <div className="rounded-lg p-4 space-y-2.5" style={{ background: "var(--color-surface-2)", border: "1px solid var(--color-border)" }}>
        <p className="label">Model Analysis (Optional)</p>
        <select
          value={analysisModel}
          onChange={(event) => setAnalysisModel(event.target.value as AnalysisModelId)}
          className="w-full rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-cyan-500/50"
          style={{ background: "var(--color-surface-1)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
        >
          {modelOptions.map((model) => (
            <option
              key={model.modelId}
              value={model.modelId}
              disabled={!model.enabled && !model.skipAnalysis}
            >
              {model.label}
            </option>
          ))}
        </select>
        {modelLoading && (
          <p className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>
            Loading model availability...
          </p>
        )}
        {selectedModel && (
          <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
            {selectedModel.description}
          </p>
        )}
        {selectedModel?.disabledReason && !selectedModel.skipAnalysis && (
          <p className="text-[11px]" style={{ color: "#f87171" }}>
            {selectedModel.disabledReason}
          </p>
        )}
        {modelError && (
          <p className="text-[11px]" style={{ color: "#f87171" }}>
            {modelError}
          </p>
        )}
      </div>

      {/* Action */}
      <button
        id="run-scan-btn"
        onClick={() => {
          if (runDisabled) return;
          onScan({
            mode,
            file: mode === "upload" ? file ?? undefined : undefined,
            livePort: mode === "live" ? parsedLivePort : undefined,
            analysisModel,
          });
        }}
        disabled={runDisabled}
        className="btn-primary w-full"
      >
        <span className="w-4 h-4"><Icon.Play /></span>
        {mode === "upload" && file
          ? `Analyze "${file.name}"`
          : mode === "upload"
          ? "Select a file above"
          : mode === "live"
          ? "Validate Hardware & Scan"
          : "Run Simulated Scan"}
      </button>

      {mode === "upload" && typeof uploadProgress === "number" && (
        <div className="rounded-lg p-3" style={{ background: "var(--color-surface-2)", border: "1px solid var(--color-border)" }}>
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span style={{ color: "var(--color-text-muted)" }}>File processing progress</span>
            <span style={{ color: "var(--color-text-primary)" }}>{Math.round(uploadProgress)}%</span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--color-border)" }}>
            <div
              className="h-full rounded-full bg-cyan-500 transition-all duration-200"
              style={{ width: `${Math.max(0, Math.min(100, uploadProgress))}%` }}
            />
          </div>
        </div>
      )}

      {error && (
        <p className="text-xs text-center text-red-400 px-2 py-1.5 rounded" style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)" }}>{error}</p>
      )}
    </div>
  );
}
