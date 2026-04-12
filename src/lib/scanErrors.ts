export type ScanErrorCode =
  | "HARDWARE_NOT_FOUND"
  | "INVALID_CSI_FILE"
  | "MALFORMED_CSI_FRAME"
  | "SIGNAL_QUALITY_LOW"
  | "CALIBRATION_NOT_FOUND"
  | "MODEL_CONFIG_INVALID"
  | "MODEL_AUTH_FAILED"
  | "MODEL_PROVIDER_FAILED"
  | "INFERENCE_FAILED"
  | "UNSUPPORTED_SCAN_MODE"
  | "UPLOAD_JOB_NOT_FOUND"
  | "LIVE_STATUS_FAILED";

export class ScanServiceError extends Error {
  readonly code: ScanErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    code: ScanErrorCode,
    status: number,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "ScanServiceError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class HardwareNotFoundError extends ScanServiceError {
  constructor(message = "No active CSI UDP traffic detected for live scan.", details?: Record<string, unknown>) {
    super(message, "HARDWARE_NOT_FOUND", 503, details);
    this.name = "HardwareNotFoundError";
  }
}

export class InvalidCsiFileError extends ScanServiceError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "INVALID_CSI_FILE", 422, details);
    this.name = "InvalidCsiFileError";
  }
}

export class MalformedCsiFrameError extends ScanServiceError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "MALFORMED_CSI_FRAME", 422, details);
    this.name = "MalformedCsiFrameError";
  }
}

export class InferenceEngineError extends ScanServiceError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "INFERENCE_FAILED", 500, details);
    this.name = "InferenceEngineError";
  }
}

export class SignalQualityError extends ScanServiceError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "SIGNAL_QUALITY_LOW", 422, details);
    this.name = "SignalQualityError";
  }
}

export class CalibrationNotFoundError extends ScanServiceError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "CALIBRATION_NOT_FOUND", 404, details);
    this.name = "CalibrationNotFoundError";
  }
}

export class ModelConfigError extends ScanServiceError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "MODEL_CONFIG_INVALID", 400, details);
    this.name = "ModelConfigError";
  }
}

export class ModelAuthError extends ScanServiceError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "MODEL_AUTH_FAILED", 401, details);
    this.name = "ModelAuthError";
  }
}

export class ModelProviderError extends ScanServiceError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "MODEL_PROVIDER_FAILED", 502, details);
    this.name = "ModelProviderError";
  }
}

export class UnsupportedScanModeError extends ScanServiceError {
  constructor(mode: string) {
    super(`Unsupported scan mode: ${mode}`, "UNSUPPORTED_SCAN_MODE", 400, { mode });
    this.name = "UnsupportedScanModeError";
  }
}

export class UploadJobNotFoundError extends ScanServiceError {
  constructor(jobId: string) {
    super(`Upload job not found: ${jobId}`, "UPLOAD_JOB_NOT_FOUND", 404, { jobId });
    this.name = "UploadJobNotFoundError";
  }
}

export class LiveStatusError extends ScanServiceError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "LIVE_STATUS_FAILED", 500, details);
    this.name = "LiveStatusError";
  }
}

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Internal server error";
}

export function toScanServiceError(error: unknown): ScanServiceError {
  if (error instanceof ScanServiceError) return error;
  return new InferenceEngineError(messageFromUnknown(error));
}

