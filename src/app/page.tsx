"use client";

import { useState } from "react";
import TrustNavigation from "@/components/TrustNavigation";
import HistoryPage from "@/app/history/page";
import { Sidebar } from "@/components/layout/Sidebar";
import { InputPanel } from "@/features/scan/InputPanel";
import { ProcessingView } from "@/features/scan/ProcessingView";
import { ResultsPanel } from "@/features/scan/ResultsPanel";
import { VitalsTrendsPanel } from "@/features/scan/VitalsTrendsPanel";
import { useScanController } from "@/features/scan/useScanController";

type AppPage = "scan" | "vitals" | "history" | "workflow";
const APP_PAGES: AppPage[] = ["scan", "vitals", "history", "workflow"];

export default function Home() {
  const {
    scanState,
    frame,
    analysis,
    csiMeta,
    diagnostics,
    inputSource,
    errorMsg,
    warningMsg,
    uploadProgress,
    activeMode,
    activeAnalysisModel,
    runScan,
    handleReset,
  } = useScanController();
  const [activePage, setActivePage] = useState<AppPage>("scan");

  const handlePageSelect = (value: string) => {
    if (APP_PAGES.includes(value as AppPage)) {
      setActivePage(value as AppPage);
    }
  };

  return (
    <div className="flex min-h-screen h-dvh flex-col overflow-hidden lg:flex-row w-full" style={{ fontFamily: "var(--font-sans)" }}>
      <Sidebar active={activePage} onSelect={handlePageSelect} />

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
                {warningMsg && (
                  <div className="rounded-lg px-3 py-2.5 mb-4 text-xs" style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.25)", color: "#fbbf24" }}>
                    {warningMsg}
                  </div>
                )}
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
                  <ProcessingView
                    state={scanState}
                    progress={uploadProgress}
                    mode={activeMode}
                    analysisModel={activeAnalysisModel}
                  />
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
                  <ResultsPanel
                    frame={frame}
                    analysis={analysis}
                    diagnostics={diagnostics ?? undefined}
                    csiMeta={csiMeta}
                    inputSource={inputSource}
                    onRescan={handleReset}
                  />
                )}
              </div>
            </div>
          )}

          {activePage === "vitals" && (
            <div className="p-8">
              <VitalsTrendsPanel />
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
