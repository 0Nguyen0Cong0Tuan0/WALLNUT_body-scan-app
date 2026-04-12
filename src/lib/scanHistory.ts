/**
 * scanHistory.ts — Client-side scan history manager
 * ===================================================
 * Persists WALLNUT scan records to localStorage.
 * Privacy-first: data never leaves the device.
 * Delete is immediate and permanent — no server roundtrip.
 */

import { v4 as uuidv4 } from "uuid";

export interface ScanRecord {
  id: string;
  timestamp: number;       // Unix ms
  inputSource: "simulate" | "upload" | "live";

  vitals: {
    heartRate: number;
    breathingRate: number;
    hrv: number;
  };

  bodyMetrics: {
    estimatedHeightCm: number;
    shoulderWidthCm: number;
    hipWidthCm: number;
    torsoLengthCm: number;
    leftArmLengthCm: number;
    leftLegLengthCm: number;
  };

  bodyFatPercent: number;
  bodyFatClassification: string;  // "Healthy" | "Overfat" | "Obese" | "Underfat"
  estimatedWaistCm: number;

  dominantMotionHz: number;

  clinicalSummary: string;
  recommendations: string[];
  postureNotes: string;
  inferenceSource: "qwen" | "rule-based";
}

const STORAGE_KEY = "wallnut_scan_history_v1";
const MAX_RECORDS  = 50;  // cap to avoid LocalStorage bloat (~5 MB limit)

// ─── Read ─────────────────────────────────────────────────────────────────────
export function getHistory(): ScanRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ScanRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ─── Write ────────────────────────────────────────────────────────────────────
function writeHistory(records: ScanRecord[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

// ─── Add ──────────────────────────────────────────────────────────────────────
export function addScanRecord(data: Omit<ScanRecord, "id" | "timestamp">): ScanRecord {
  const record: ScanRecord = {
    id: uuidv4(),
    timestamp: Date.now(),
    ...data,
  };

  const existing = getHistory();
  // Most recent first; trim to cap
  const updated = [record, ...existing].slice(0, MAX_RECORDS);
  writeHistory(updated);
  return record;
}

// ─── Delete (single) ──────────────────────────────────────────────────────────
/**
 * Permanently removes a single scan record.
 * Flawless: verifies the ID exists before writing, returns success boolean.
 */
export function deleteScanRecord(id: string): boolean {
  const existing = getHistory();
  const filtered = existing.filter(r => r.id !== id);
  if (filtered.length === existing.length) return false;  // ID not found
  writeHistory(filtered);
  return true;
}

// ─── Delete (all) ─────────────────────────────────────────────────────────────
export function clearHistory(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}

// ─── Export to JSON ───────────────────────────────────────────────────────────
export function exportHistoryJson(): void {
  const records = getHistory();
  const blob = new Blob(
    [JSON.stringify(records, null, 2)],
    { type: "application/json" }
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `wallnut_scan_history_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Count ────────────────────────────────────────────────────────────────────
export function getHistoryCount(): number {
  return getHistory().length;
}
