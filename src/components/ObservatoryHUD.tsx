"use client";

/**
 * ObservatoryHUD.tsx
 * ──────────────────
 * Ported & adapted from RuView/ui/components/dashboard-hud.js
 *
 * Original pattern: monolithic DOM-mutating class with hard-coded CSS injection
 * and imperative state diffing.
 *
 * Our adaptation:
 *  • Pure React functional component — no DOM refs, no innerHTML
 *  • Props-driven instead of class.updateState()
 *  • Corner-bracket decoration pattern preserved (CSS →  inline styles)
 *  • HUD mode badge (CSI / RSSI / Mock) color system preserved
 *  • FPS counter tracked via requestAnimationFrame inside a hook
 *  • Monospace font, deep-slate palette — same "command center" feel
 */

import { useEffect, useRef, useState } from "react";

// ─── Types ─────────────────────────────────────────────────────────────────────
export type ConnectionStatus = "connected" | "disconnected" | "connecting" | "error";
export type SensingMode = "CSI" | "RSSI" | "Mock" | "Simulate";

export interface HUDProps {
  connectionStatus?: ConnectionStatus;
  isRealData?: boolean;
  sensingMode?: SensingMode;
  confidence?: number;        // 0–1
  personCount?: number;
  latencyMs?: number;
  messageCount?: number;
  uptimeSeconds?: number;
  showFPS?: boolean;
  className?: string;
}

// ─── FPS Hook ─────────────────────────────────────────────────────────────────
function useFPS(enabled: boolean) {
  const [fps, setFps] = useState(0);
  const [frameMs, setFrameMs] = useState(0);
  const frames = useRef<number[]>([]);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (!enabled) return;

    const tick = (now: number) => {
      frames.current.push(now);
      // Keep only last 1 second
      while (frames.current.length > 0 && frames.current[0] < now - 1000) {
        frames.current.shift();
      }
      setFps(frames.current.length);
      if (frames.current.length > 1) {
        const span = frames.current[frames.current.length - 1] - frames.current[0];
        setFrameMs(span / Math.max(1, frames.current.length - 1));
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [enabled]);

  return { fps, frameMs };
}

// ─── Uptime formatter ─────────────────────────────────────────────────────────
function formatUptime(s: number): string {
  if (s < 60) return `${Math.floor(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${Math.floor(s % 60)}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

// ─── Sub-components ────────────────────────────────────────────────────────────
function StatusDot({ status }: { status: ConnectionStatus }) {
  const colors: Record<ConnectionStatus, string> = {
    connected:    "#22c55e",
    disconnected: "#475569",
    connecting:   "#f59e0b",
    error:        "#ef4444",
  };
  return (
    <span style={{
      display: "inline-block", width: 7, height: 7, borderRadius: "50%",
      background: colors[status],
      boxShadow: status !== "disconnected" ? `0 0 5px ${colors[status]}` : "none",
      animation: status === "connecting" ? "hud-blink 1s infinite" : "none",
      flexShrink: 0,
    }} />
  );
}

function ModeBadge({ mode }: { mode: SensingMode }) {
  const styles: Record<SensingMode, { bg: string; border: string; color: string }> = {
    CSI:      { bg: "rgba(0,100,200,0.7)",   border: "#0088ff", color: "#aaddff" },
    RSSI:     { bg: "rgba(100,0,200,0.7)",   border: "#8800ff", color: "#ddaaff" },
    Mock:     { bg: "rgba(120,80,0,0.7)",    border: "#ff8800", color: "#ffddaa" },
    Simulate: { bg: "rgba(0,100,120,0.7)",   border: "#00ccdd", color: "#aaffff" },
  };
  const s = styles[mode];
  return (
    <span style={{
      padding: "2px 9px", borderRadius: 4, fontSize: "0.68rem",
      fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
      background: s.bg, border: `1px solid ${s.border}`, color: s.color,
      fontFamily: "monospace",
    }}>{mode}</span>
  );
}

function ConfidenceBar({ value }: { value: number }) {
  const hue = Math.round(value * 120);
  return (
    <div style={{
      width: 116, height: 5, background: "rgba(20,30,50,0.9)",
      border: "1px solid #1e2a35", borderRadius: 3, overflow: "hidden", marginTop: 3,
    }}>
      <div style={{
        height: "100%", borderRadius: 3,
        width: `${value * 100}%`,
        background: `hsl(${hue},100%,42%)`,
        transition: "width 0.3s, background 0.4s",
      }} />
    </div>
  );
}

// ─── Corner bracket decoration ─────────────────────────────────────────────────
function Corners() {
  const base: React.CSSProperties = {
    position: "absolute", width: 16, height: 16,
    borderColor: "rgba(100,150,200,0.25)", borderStyle: "solid",
  };
  return (
    <>
      <div style={{ ...base, top: 28, left: 4, borderWidth: "1px 0 0 1px" }} />
      <div style={{ ...base, top: 28, right: 4, borderWidth: "1px 1px 0 0" }} />
      <div style={{ ...base, bottom: 4, left: 4, borderWidth: "0 0 1px 1px" }} />
      <div style={{ ...base, bottom: 4, right: 4, borderWidth: "0 1px 1px 0" }} />
    </>
  );
}

// ─── Main HUD ─────────────────────────────────────────────────────────────────
export default function ObservatoryHUD({
  connectionStatus = "disconnected",
  isRealData = false,
  sensingMode = "Simulate",
  confidence = 0,
  personCount = 0,
  latencyMs = 0,
  messageCount = 0,
  uptimeSeconds = 0,
  showFPS = true,
  className = "",
}: HUDProps) {
  const { fps, frameMs } = useFPS(showFPS);

  const fpsColor = fps >= 50 ? "#22c55e" : fps >= 25 ? "#f59e0b" : "#ef4444";
  const connLabel = { connected: "Connected", disconnected: "Disconnected", connecting: "Connecting…", error: "Connection Error" }[connectionStatus];

  const hudStyle: React.CSSProperties = {
    position: "absolute", inset: 0, pointerEvents: "none", zIndex: 10,
    fontFamily: "'Courier New', Consolas, monospace",
    color: "#88ccff", userSelect: "none",
  };

  const Row = ({ label, value }: { label: string; value: string }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.68rem", lineHeight: 1.5 }}>
      <span style={{ color: "#5588aa", textTransform: "uppercase", fontSize: "0.58rem", letterSpacing: "0.06em", minWidth: 64 }}>{label}</span>
      <span style={{ color: "#aaddff", fontWeight: 700 }}>{value}</span>
    </div>
  );

  return (
    <div style={hudStyle} className={className}>
      <style>{`@keyframes hud-blink{0%,100%{opacity:1}50%{opacity:0.25}}`}</style>

      {/* Corners */}
      <Corners />

      {/* Data source banner */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, textAlign: "center",
        padding: "4px 0", fontSize: "0.68rem", fontWeight: 700,
        letterSpacing: "0.18em", textTransform: "uppercase",
        background: isRealData
          ? "linear-gradient(90deg,rgba(0,110,55,0.9),rgba(0,150,75,0.9),rgba(0,110,55,0.9))"
          : "linear-gradient(90deg,rgba(160,90,0,0.9),rgba(190,110,0,0.9),rgba(160,90,0,0.9))",
        borderBottom: isRealData ? "1px solid #00ff66" : "1px solid #ff8800",
        color: "#fff",
        animation: isRealData ? "hud-blink 2.5s ease-in-out infinite" : "none",
      }}>
        {isRealData ? "● LIVE CSI STREAM" : "⚠ SIMULATED DATA — DEMO MODE"}
      </div>

      {/* Top-left: connection */}
      <div style={{ position: "absolute", top: 34, left: 10, display: "flex", flexDirection: "column", gap: 3 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.7rem" }}>
          <StatusDot status={connectionStatus} />
          <span style={{ color: "#aaddff", fontWeight: 700 }}>{connLabel}</span>
        </div>
        <Row label="Latency"  value={latencyMs > 0 ? `${latencyMs.toFixed(0)} ms` : "—"}   />
        <Row label="Messages" value={messageCount.toLocaleString()}                          />
        <Row label="Uptime"   value={formatUptime(uptimeSeconds)}                            />
      </div>

      {/* Top-right: FPS */}
      {showFPS && (
        <div style={{ position: "absolute", top: 34, right: 10, textAlign: "right" }}>
          <div style={{ fontSize: "1.35rem", fontWeight: 700, color: fpsColor, lineHeight: 1 }}>
            {fps} FPS
          </div>
          <div style={{ fontSize: "0.62rem", color: "#5588aa", marginTop: 2 }}>
            {frameMs.toFixed(1)} ms/frame
          </div>
        </div>
      )}

      {/* Bottom-left: detection */}
      <div style={{ position: "absolute", bottom: 10, left: 10 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 5, marginBottom: 3 }}>
          <span style={{ fontSize: "0.6rem", color: "#5588aa", textTransform: "uppercase", letterSpacing: "0.05em" }}>Persons</span>
          <span style={{ fontSize: "1.6rem", fontWeight: 800, color: personCount > 0 ? "#22c55e" : "#445566", lineHeight: 1 }}>
            {personCount}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: "0.67rem" }}>
          <span style={{ color: "#5588aa", textTransform: "uppercase", fontSize: "0.58rem", letterSpacing: "0.05em" }}>Confidence</span>
          <span style={{ color: "#aaddff", fontWeight: 700 }}>{(confidence * 100).toFixed(1)}%</span>
        </div>
        <ConfidenceBar value={confidence} />
      </div>

      {/* Bottom-right: mode badge */}
      <div style={{ position: "absolute", bottom: 10, right: 10, textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
        <ModeBadge mode={sensingMode} />
        <span style={{ fontSize: "0.58rem", color: "#445566", letterSpacing: "0.05em" }}>WiFi DensePose</span>
      </div>

      {/* Center-bottom: orbit hint */}
      <div style={{
        position: "absolute", bottom: 52, left: "50%", transform: "translateX(-50%)",
        fontSize: "0.6rem", color: "#334455", textAlign: "center", whiteSpace: "nowrap",
      }}>
        Drag to orbit · Scroll to zoom · Right-click to pan
      </div>
    </div>
  );
}
