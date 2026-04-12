export type InputMode = "upload" | "live" | "simulate";
export type AnalysisModelId = "none" | "qwen-plus" | "qwen-turbo" | "qwen-max";

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

export interface ParsedFusionNode {
  nodeId: number;
  frameCount: number;
  meanRssi: number;
  weight: number;
}

export interface ParsedFusionMeta {
  enabled: boolean;
  strategy: "none" | "weighted_time_aligned";
  nodeCount: number;
  nodes: ParsedFusionNode[];
}

export interface ScanQualityComponents {
  frameCoverage: number;
  sampleRate: number;
  rssiStrength: number;
  temporalStability: number;
  motionConsistency: number;
  nodeCoverage: number;
}

export interface ScanDiagnostics {
  qualityScore: number;
  qualityGrade: "A" | "B" | "C" | "D";
  qualityGatePassed: boolean;
  qualityComponents: ScanQualityComponents;
  interferenceScore: number;
  multiPersonLikely: boolean;
  warnings: string[];
  fusion?: ParsedFusionMeta;
  calibration: {
    profileId?: string;
    baselineApplied: boolean;
    driftCompensationStrength: number;
  };
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
  dominantMotionHz: number;
  breathingHz: number;
  motionEnergy: number;
  phaseStability: number;
  fps: number;
  sequenceLength: number;
  durationSeconds: number;
}

export interface ScanFrame {
  timestamp: number;
  nodeId: string;
  channel: number;
  subcarriers: number;
  rssi: number;
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
    rightArmLengthCm: number;
    leftLegLengthCm: number;
    bmi_proxy: number;
  };
  keypoints: PoseKeypoint[];
  keypointSequence?: PoseSequenceFrame[];
  temporal?: TemporalMeta;
  csiMeta?: CsiMeta;
}

export interface ScanRequest {
  mode: InputMode;
  file?: File;
  livePort?: number;
  analysisModel?: AnalysisModelId;
  calibrationProfileId?: string;
  baselineId?: string;
  qualityGateMin?: number;
  driftCompensationStrength?: number;
}

export interface AnalysisModelOption {
  modelId: AnalysisModelId;
  label: string;
  provider: "none" | "dashscope-qwen";
  description: string;
  enabled: boolean;
  disabledReason?: string;
  skipAnalysis: boolean;
  quota: {
    remainingCalls: number | null;
    limitCalls: number | null;
    usedCalls: number;
    source: "tracked" | "unbounded" | "none";
  };
}

export interface TrendRecord {
  recordId: string;
  timestampMs: number;
  inputSource: string;
  bodyFatPercent: number;
  heartRate: number;
  breathingRate: number;
  hrv: number;
  dominantMotionHz: number;
  motionEnergy: number;
  phaseStability: number;
  qualityScore: number;
  qualityGrade: string;
  interferenceScore: number;
  multiPersonLikely: boolean;
  inferenceSource: string;
  flags: string[];
}

export interface TrendSummary {
  windowDays: number;
  totalScans: number;
  byInputSource: Record<string, number>;
  firstTimestampMs: number | null;
  lastTimestampMs: number | null;
  deltas: {
    bodyFatPercent: number | null;
    heartRate: number | null;
    breathingRate: number | null;
    hrv: number | null;
  };
  latest: TrendRecord | null;
  anomalies: string[];
  riskLevel: "low" | "moderate" | "high";
}
