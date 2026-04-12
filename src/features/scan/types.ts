import type { RuViewFrame } from "@/lib/ruviewSimulator";

export type InputMode = "upload" | "live" | "simulate";

export type ScanState = "idle" | "connecting" | "processing" | "analyzing" | "results" | "error";

export interface Analysis {
  bodyFatPercent: number; 
  bodyFatClassification: string; 
  classColor: string;
  estimatedWaistCm: number; 
  clinicalSummary: string; 
  recommendations: string[];
  postureNotes: string; 
  source: "qwen" | "rule-based";
}

export interface CsiMeta {
  format: string; 
  numFrames: number; 
  durationSeconds: number;
  sampleRateHz: number; 
  numAntennas: number; 
  numSubcarriers: number;
}

export interface PoseKeypoint {
  point: string;
  x: number;
  y: number;
  confidence: number;
  z?: number;
}

export interface PoseSequenceFrame {
  t: number;
  keypoints: PoseKeypoint[];
  confidence: number;
  motionScore: number;
}

export interface TemporalMeta {
  activity: string;
  activityConfidence: number;
  dominantMotionHz: number;
  breathingHz: number;
  motionEnergy: number;
  phaseStability: number;
  fps: number;
  sequenceLength: number;
  durationSeconds: number;
}

export type ScanFrame = Omit<RuViewFrame, "keypoints"> & {
  keypoints: PoseKeypoint[];
  keypointSequence?: PoseSequenceFrame[];
  temporal?: TemporalMeta;
  csiMeta?: CsiMeta;
};

export interface ScanRequest {
  mode: InputMode;
  file?: File;
  livePort?: number;
}
