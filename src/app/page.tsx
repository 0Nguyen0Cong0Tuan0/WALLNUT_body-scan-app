"use client";

import { useState, useCallback } from "react";
import TrustNavigation from "@/components/TrustNavigation";
import HistoryPage from "@/app/history/page";
import { addScanRecord } from "@/lib/scanHistory";
import { Sidebar } from "@/components/layout/Sidebar";
import { InputPanel } from "@/features/scan/InputPanel";
import { ProcessingView } from "@/features/scan/ProcessingView";
import { ResultsPanel } from "@/features/scan/ResultsPanel";
import { ScanState, ScanFrame, Analysis, CsiMeta, ScanRequest } from "@/features/scan/types";

export default function Home() {
  const [scanState, setScanState] = useState<ScanState>("idle");
  const [frame, setFrame] = useState<ScanFrame | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [csiMeta, setCsiMeta] = useState<CsiMeta | undefined>(undefined);
  const [inputSource, setInputSource] = useState("simulated");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [activePage, setActivePage] = useState("scan");
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [activeMode, setActiveMode] = useState<"upload" | "live" | "simulate" | null>(null);

  const runScan = useCallback(async (request: ScanRequest) => {
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    setErrorMsg(null);
    setFrame(null);
    setAnalysis(null);
    setUploadProgress(null);
    setActiveMode(request.mode);
    setScanState(request.mode === "live" ? "connecting" : "processing");

    try {
      const applyResult = (data: { frame: ScanFrame; analysis: Analysis; inputSource: string }) => {
        setFrame(data.frame);
        setAnalysis(data.analysis);
        setCsiMeta(data.frame.csiMeta);
        setInputSource(data.inputSource);

        try {
          addScanRecord({
            inputSource: data.inputSource as "simulate" | "upload" | "live",
            vitals: {
              heartRate: data.frame.vitals.heartRate,
              breathingRate: data.frame.vitals.breathingRate,
              hrv: data.frame.vitals.hrv,
            },
            bodyMetrics: {
              estimatedHeightCm: data.frame.bodyMetrics.estimatedHeightCm,
              shoulderWidthCm:   data.frame.bodyMetrics.shoulderWidthCm,
              hipWidthCm:        data.frame.bodyMetrics.hipWidthCm,
              torsoLengthCm:     data.frame.bodyMetrics.torsoLengthCm,
              leftArmLengthCm:   data.frame.bodyMetrics.leftArmLengthCm,
              leftLegLengthCm:   data.frame.bodyMetrics.leftLegLengthCm,
            },
            bodyFatPercent:        data.analysis.bodyFatPercent,
            bodyFatClassification: data.analysis.bodyFatClassification,
            estimatedWaistCm:      data.analysis.estimatedWaistCm,
            activity:              data.frame.temporal?.activity ?? "unknown",
            activityConfidence:    data.frame.temporal?.activityConfidence ?? 0,
            dominantMotionHz:      data.frame.temporal?.dominantMotionHz ?? 0,
            clinicalSummary:       data.analysis.clinicalSummary,
            recommendations:       data.analysis.recommendations,
            postureNotes:          data.analysis.postureNotes,
            inferenceSource:       data.analysis.source,
          });
        } catch {
          // Non-critical
        }
      };

      if (request.mode === "upload") {
        if (!request.file) throw new Error("Please choose a CSI file before starting upload mode.");

        const form = new FormData();
        form.append("csiFile", request.file);
        const startResponse = await fetch("/api/scan/upload", { method: "POST", body: form });
        const startData = await startResponse.json();
        if (!startResponse.ok || !startData.success) throw new Error(startData.error ?? "Upload job failed to start.");

        const jobId = String(startData.jobId);
        for (let attempt = 0; attempt < 240; attempt++) {
          const progressResponse = await fetch(`/api/scan/upload/progress?jobId=${encodeURIComponent(jobId)}`, { cache: "no-store" });
          const progressData = await progressResponse.json();
          if (!progressResponse.ok || !progressData.success) throw new Error(progressData.error ?? "Unable to read upload progress.");

          const progressValue = Number(progressData.progress ?? 0);
          setUploadProgress(Number.isFinite(progressValue) ? progressValue : null);

          const stage = String(progressData.stage ?? "");
          if (stage === "validating" || stage === "decoding_binary" || stage === "parsing") {
            setScanState("processing");
          } else if (stage === "inference") {
            setScanState("analyzing");
          }

          if (stage === "completed" && progressData.result) {
            applyResult(progressData.result as { frame: ScanFrame; analysis: Analysis; inputSource: string });
            setScanState("results");
            setUploadProgress(100);
            return;
          }

          if (stage === "failed") throw new Error(progressData.error?.message ?? "Upload processing failed.");
          await sleep(250);
        }
        throw new Error("Upload processing timed out.");
      }

      setScanState(request.mode === "live" ? "connecting" : "processing");
      const response = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: request.mode, livePort: request.livePort }),
      });

      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error ?? "Scan failed.");

      setScanState("analyzing");
      applyResult(data as { frame: ScanFrame; analysis: Analysis; inputSource: string });
      setScanState("results");
    } catch (err) {
      setErrorMsg(String(err));
      setScanState("error");
      setUploadProgress(null);
    }
  }, []);

  const handleReset = () => { setScanState("idle"); setFrame(null); setAnalysis(null); setErrorMsg(null); setUploadProgress(null); };

  return (
    <div className="flex min-h-screen h-dvh flex-col overflow-hidden lg:flex-row w-full" style={{ fontFamily: "var(--font-sans)" }}>
      <Sidebar active={activePage} onSelect={setActivePage} />

      {/* Main area spans full width */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden w-full">
        <main className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 w-full">
          {activePage === "scan" && (
            <div className={`grid h-full min-h-0 grid-cols-1 ${scanState === "idle" || scanState === "error" || scanState === "results" ? "xl:grid-cols-[minmax(360px,400px)_minmax(0,1fr)]" : ""}`}>
              {/* Left panel — input (hidden during active processing for full Observatory view) */}
              {(scanState === "idle" || scanState === "error" || scanState === "results") && (
                <div className="overflow-y-auto p-5 xl:p-6 space-y-5 border-b xl:border-b-0 xl:border-r" style={{ borderColor: "var(--color-border)" }}>
                  <InputPanel onScan={runScan} error={errorMsg} uploadProgress={uploadProgress} />
                </div>
              )}

              {/* Right panel — results / states */}
              <div className={`overflow-y-auto p-5 xl:p-8 min-w-0 w-full ${scanState === "processing" || scanState === "analyzing" || scanState === "connecting" ? "col-span-full max-w-[1600px] mx-auto" : ""}`}>
                {scanState === "idle" && (
                  <div className="flex flex-col items-center justify-center h-full min-h-[400px] gap-5">
                    <div className="text-cyan-500/20">
                      <svg className="w-32 h-32" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={0.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 3.75H6A2.25 2.25 0 003.75 6v1.5M16.5 3.75H18A2.25 2.25 0 0120.25 6v1.5m0 9V18A2.25 2.25 0 0118 20.25h-1.5m-9 0H6A2.25 2.25 0 013.75 18v-1.5M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    </div>
                    <div className="text-center max-w-sm">
                      <p className="text-base font-medium mb-1.5" style={{ color: "var(--color-text-secondary)" }}>No scan data</p>
                      <p className="text-sm leading-relaxed" style={{ color: "var(--color-text-muted)" }}>
                        Select an input mode on the left, upload a CSI file or run a simulation, then click Analyze.
                      </p>
                    </div>
                  </div>
                )}
                {(scanState === "connecting" || scanState === "processing" || scanState === "analyzing") && (
                  <ProcessingView state={scanState} progress={uploadProgress} mode={activeMode} />
                )}
                {scanState === "error" && (
                  <div className="rounded-xl p-5 space-y-3 max-w-lg mt-10"
                    style={{ background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.2)" }}>
                    <p className="text-sm font-semibold text-red-400">Scan failed</p>
                    <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>{errorMsg}</p>
                    <button onClick={handleReset} className="btn-ghost text-xs mt-2">Dismiss</button>
                  </div>
                )}
                {scanState === "results" && frame && analysis && (
                  <ResultsPanel frame={frame} analysis={analysis} csiMeta={csiMeta} inputSource={inputSource} onRescan={handleReset} />
                )}
              </div>
            </div>
          )}

          {activePage === "vitals" && (
            <div className="p-8">
              <div className="rounded-xl p-10 text-center max-w-lg mx-auto"
                style={{ background: "var(--color-surface-2)", border: "1px solid var(--color-border)" }}>
                <p className="text-base" style={{ color: "var(--color-text-muted)" }}>Run a body scan first to view extracted vitals here.</p>
              </div>
            </div>
          )}

          {activePage === "history" && <HistoryPage />}

          {activePage === "workflow" && (
            <div className="p-8 w-full">
              <div className="max-w-7xl mx-auto space-y-6">
                <div className="rounded-xl px-6 py-5 shadow-sm" style={{ background: "var(--color-surface-2)", border: "1px solid var(--color-border)" }}>
                  <p className="text-lg font-semibold" style={{ color: "var(--color-text-primary)" }}>Methodology Hub</p>
                  <p className="text-sm mt-2 leading-relaxed" style={{ color: "var(--color-text-muted)", maxWidth: "800px" }}>
                    This is the single source for workflow, logic, clinical usage, research basis, and privacy boundaries.
                    It mirrors the current implementation in the scan API and CSI processing modules.
                  </p>
                  <a href="/methodology" target="_blank" rel="noopener" className="inline-flex items-center gap-2 mt-4 text-sm font-bold tracking-wide" style={{ color: "#22d3ee" }}>
                    Open full scientific whitepaper ↗
                  </a>
                </div>
                <TrustNavigation forceOpen="workflow" />
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
