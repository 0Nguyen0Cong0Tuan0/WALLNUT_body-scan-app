# WALLNUT Body Scan App

Privacy-first body scan platform built on Next.js + TypeScript.  
It processes WiFi CSI input (upload/live/simulated), extracts vitals and pose-derived biometrics, and renders a clinical-style report with optional Qwen-assisted narrative.

## Core capabilities

- **Three scan modes**: file upload, live CSI UDP stream, or deterministic simulation.
- **Signal pipeline**: CSI parsing → DSP vitals extraction → pose/temporal inference.
- **Clinical output**: body-fat estimate, anthropometric circumferences, recommendations, and posture notes.
- **Quality-aware diagnostics**: quality gating, interference/multi-person likelihood, fusion metadata.
- **Calibration + trends**: room-baseline drift compensation, calibration profiles, and longitudinal trend analytics.
- **History UX**: local browser-only scan history (export/clear/delete).
- **Methodology pages**: technical whitepaper and workflow/research/privacy explainers.

## Project structure

```text
src/
  app/
    page.tsx                      # main shell and page routing
    history/page.tsx              # local scan history UI
    methodology/page.tsx          # technical whitepaper
    api/
      _shared/scanResponses.ts    # shared API error/parse helpers
      chat/route.ts               # chat proxy to external RAG service
      scan/route.ts               # live + simulate scan endpoint
      scan/upload/route.ts        # upload job creation
      scan/upload/progress/route.ts
      v1/analysis/models/route.ts # model selection + tracked quota
      v1/calibration/route.ts     # calibration profile/baseline APIs
      v1/status/route.ts          # live mesh status
      v1/trends/route.ts          # trend summary + recent records
  features/
    scan/
      useScanController.ts        # scan orchestration hook
      InputPanel.tsx
      ProcessingView.tsx
      ResultsPanel.tsx
      FileDropZone.tsx
      types.ts
  lib/
    csiProcessor.ts               # parsing + DSP + temporal analysis
    inferenceEngine.ts            # Qwen/rule-based analysis layer
    liveCsi.ts                    # UDP capture + mesh telemetry
    uploadJobs.ts                 # sqlite-backed async upload jobs
    calibrationStore.ts           # calibration profile + room baseline management
    trendStore.ts                 # trend record persistence + summary analytics
    serverDb.ts                   # sqlite schema + settings helpers
    scanPipeline.ts               # baseline + calibration + inference orchestrator
    analysisModels.ts             # selectable model provider + quota tracking
    anthropometricModel.ts        # circumference estimation model
    scanHistory.ts                # localStorage persistence
```

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Quality checks

```bash
npm run lint
npm run build
```

## Environment variables

| Variable | Purpose | Default |
|---|---|---|
| `RAG_SERVER_URL` | Upstream RAG/chat service base URL used by `/api/chat` | `http://localhost:8787` |
| `QWEN_API_KEY` / `DASHSCOPE_API_KEY` | Qwen access key used by inference engine | unset |
| `LIVE_CSI_UDP_PORT` | UDP port for live CSI capture | `8080` |
| `LIVE_PRE_SCAN_TIMEOUT_MS` | packet probe timeout before live scan rejection | `45` |
| `LIVE_CAPTURE_MAX_PACKETS` | max packets collected per live capture | `96` |
| `WALLNUT_DB_PATH` | SQLite path for jobs/calibration/trends storage | `.data/wallnut.sqlite` |
| `SCAN_QUALITY_GATE_MIN` | minimum quality score gate (0-1) before inference acceptance | `0.38` |
| `QWEN_MODEL_QUOTA_LIMITS_JSON` | tracked call budgets per model (JSON) | `{"qwen-plus":400,"qwen-turbo":1200,"qwen-max":180}` |

## Extension points

- Add new scan sources by extending `ScanRequest` + `useScanController` and `src/app/api/scan/route.ts`.
- Add new clinical metrics in `lib/csiProcessor.ts` / `lib/inferenceEngine.ts` and render in `ResultsPanel.tsx`.
- Add new API response policies once in `app/api/_shared/scanResponses.ts` and reuse across routes.

## Notes

- Scan history is intentionally local-only (`localStorage`) unless you add a backend persistence layer.
- Upload jobs, calibration profiles, baselines, and trend records are persisted in SQLite.
- AI analysis is optional per scan: choose a Qwen model or skip to rule-engine-only mode.
