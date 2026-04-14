import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";

const globalWithDb = globalThis as typeof globalThis & {
  __WALLNUT_SERVER_DB__?: DatabaseSync;
};

function resolveDbPath(): string {
  const envPath = process.env.WALLNUT_DB_PATH;
  if (envPath && envPath.trim().length > 0) return path.resolve(envPath);
  // Use temp directory to avoid Turbopack file watching issues
  const tempDir = path.join(os.tmpdir(), "wallnut");
  return path.join(tempDir, "wallnut.sqlite");
}

function ensureDbDirectory(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function initializeSchema(db: DatabaseSync): void {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS upload_jobs (
      job_id TEXT PRIMARY KEY,
      stage TEXT NOT NULL,
      progress REAL NOT NULL,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      error_code TEXT,
      error_message TEXT,
      error_details_json TEXT,
      result_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_upload_jobs_updated ON upload_jobs(updated_at_ms);

    CREATE TABLE IF NOT EXISTS calibration_profiles (
      profile_id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      corrections_json TEXT NOT NULL,
      notes TEXT,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS room_baselines (
      baseline_id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      num_subcarriers INTEGER NOT NULL,
      sample_count INTEGER NOT NULL,
      mean_amplitude REAL NOT NULL,
      subcarrier_profile_json TEXT NOT NULL,
      captured_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS trend_records (
      record_id TEXT PRIMARY KEY,
      timestamp_ms INTEGER NOT NULL,
      input_source TEXT NOT NULL,
      body_fat_percent REAL NOT NULL,
      heart_rate REAL NOT NULL,
      breathing_rate REAL NOT NULL,
      hrv REAL NOT NULL,
      dominant_motion_hz REAL NOT NULL,
      motion_energy REAL NOT NULL,
      phase_stability REAL NOT NULL,
      quality_score REAL NOT NULL,
      quality_grade TEXT NOT NULL,
      interference_score REAL NOT NULL,
      multi_person_likely INTEGER NOT NULL,
      inference_source TEXT NOT NULL,
      flags_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_trend_records_ts ON trend_records(timestamp_ms);

    CREATE TABLE IF NOT EXISTS analysis_model_usage (
      model_id TEXT PRIMARY KEY,
      successful_calls INTEGER NOT NULL DEFAULT 0,
      estimated_tokens INTEGER NOT NULL DEFAULT 0,
      last_error_json TEXT,
      updated_at_ms INTEGER NOT NULL
    );
  `);
}

export function getServerDb(): DatabaseSync {
  if (globalWithDb.__WALLNUT_SERVER_DB__) return globalWithDb.__WALLNUT_SERVER_DB__;

  const dbPath = resolveDbPath();
  ensureDbDirectory(dbPath);
  const db = new DatabaseSync(dbPath);
  initializeSchema(db);
  globalWithDb.__WALLNUT_SERVER_DB__ = db;
  return db;
}

export function parseJsonField<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || value.length === 0) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function stringifyJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function setSetting<T>(key: string, value: T): void {
  const db = getServerDb();
  const now = Date.now();
  db.prepare(
    `INSERT INTO app_settings (key, value_json, updated_at_ms)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at_ms = excluded.updated_at_ms`
  ).run(key, stringifyJson(value), now);
}

export function getSetting<T>(key: string, fallback: T): T {
  const db = getServerDb();
  const row = db.prepare(`SELECT value_json FROM app_settings WHERE key = ?`).get(key) as
    | { value_json?: unknown }
    | undefined;
  return parseJsonField<T>(row?.value_json, fallback);
}

