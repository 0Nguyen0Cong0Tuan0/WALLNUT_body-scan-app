import { NextRequest, NextResponse } from "next/server";

// ─── Types ────────────────────────────────────────────────────────────────────
interface ScanMetrics {
  heartRateBpm: number;
  breathingRateBpm: number;
  hrv: number;
  bodyFatPercent: number;
  bodyFatClassification: string;
  estimatedHeightCm: number;
  shoulderWidthCm: number;
  hipWidthCm: number;
  activity: string;
  activityConfidence: number;
  clinicalSummary?: string;
}

interface ChatRequest {
  question: string;
  scanMetrics: ScanMetrics;
}

interface RagHit {
  text: string;
  wing: string;
  room: string;
  similarity: number;
}

interface RagSearchResult {
  results?: RagHit[];
  error?: string;
}

// ─── RAG: query MemPalace sidecar ─────────────────────────────────────────────
const RAG_SERVER_URL = process.env.RAG_SERVER_URL ?? "http://localhost:8787";

async function queryRagContext(question: string, n = 4): Promise<string> {
  try {
    const res = await fetch(`${RAG_SERVER_URL}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: question, n_results: n, wing: "wallnut_knowledge" }),
      // Short timeout — if sidecar isn't running, fall back gracefully
      signal: AbortSignal.timeout(3000),
    });

    if (!res.ok) return "";

    const data = (await res.json()) as RagSearchResult;
    const hits = data.results ?? [];
    if (hits.length === 0) return "";

    return hits
      .filter(h => h.similarity > 0.25)
      .slice(0, 4)
      .map((h, i) => `[Source ${i + 1} — ${h.room}]\n${h.text.trim()}`)
      .join("\n\n─────\n\n");
  } catch {
    // RAG sidecar not running — degrade gracefully
    return "";
  }
}

// ─── Prompt assembly ──────────────────────────────────────────────────────────
function buildSystemPrompt(ragContext: string, metrics: ScanMetrics): string {
  const biometrics = `
PATIENT SCAN RESULTS (from WiFi-CSI WALLNUT Body Scan):
• Heart Rate:         ${metrics.heartRateBpm} bpm
• Breathing Rate:     ${metrics.breathingRateBpm} breaths/min
• HRV (RMSSD):        ${metrics.hrv} ms
• Body Fat:           ${metrics.bodyFatPercent}% — ${metrics.bodyFatClassification}
• Height (estimated): ${metrics.estimatedHeightCm} cm
• Shoulder Width:     ${metrics.shoulderWidthCm} cm
• Hip Width:          ${metrics.hipWidthCm} cm
• Activity State:     ${metrics.activity} (confidence: ${Math.round(metrics.activityConfidence * 100)}%)
${metrics.clinicalSummary ? `• Clinical Summary:   ${metrics.clinicalSummary}` : ""}
`.trim();

  const ragSection = ragContext
    ? `\nMEDICAL / TECHNICAL KNOWLEDGE BASE (retrieved via RAG — MemPalace):\n${ragContext}\n`
    : "";

  return `You are WALLNUT's Health Assistant — an expert in RF sensing, digital signal processing, and clinical health informatics. You help patients understand their WiFi-CSI body scan results in a clear, trustworthy, and educational way.

SENSING TECHNOLOGY:
WALLNUT uses 802.11 WiFi Channel State Information (CSI) to non-invasively measure:
- Breathing rate: isolated via 2nd-order IIR bandpass filter [0.1–0.5 Hz]
- Heart rate: isolated via IIR bandpass [0.8–2.0 Hz], zero-crossing rate
- HRV (RMSSD): √(Σ(ΔRR)²/N) from peak-detected RR intervals of the cardiac-filtered signal
- Body morphometrics: SMPL-fit anthropometric regression using CAESAR/ANSUR-II depth ratios
- Activity state: sliding-window DFT → dominant motion frequency → deterministic classifier
${ragSection}
${biometrics}

RESPONSE RULES:
1. Always reference the patient's SPECIFIC numbers — not generic advice
2. Explain HOW the scan system measured each metric (briefly, accurately)
3. Use clinical terminology but explain it plainly in brackets, e.g. "RMSSD (a measure of heart rhythm variability)"
4. Be honest about measurement uncertainty — CSI has ~±5 bpm accuracy for HR, ~±3 bpm for breathing
5. Never diagnose. Always recommend consulting a clinician for medical decisions
6. Keep responses concise: 3–5 short paragraphs maximum
7. If RAG context is provided, cite insights from it naturally
8. Tone: warm, confident, scientifically rigorous`;
}

// ─── Qwen API call ─────────────────────────────────────────────────────────────
interface QwenMessage { role: "system" | "user" | "assistant"; content: string; }
interface QwenResponse {
  output?: { choices?: { message?: { content?: string } }[] };
  error?: { message?: string };
}

async function callQwen(systemPrompt: string, userQuestion: string): Promise<string> {
  const apiKey = process.env.DASHSCOPE_API_KEY ?? process.env.QWEN_API_KEY;

  if (!apiKey) {
    return buildRuleBasedAnswer(userQuestion);
  }

  const messages: QwenMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userQuestion },
  ];

  const res = await fetch("https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "qwen-plus",
      input: { messages },
      parameters: {
        max_tokens: 600,
        temperature: 0.5,
        top_p: 0.8,
        result_format: "message",
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Qwen API error ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = (await res.json()) as QwenResponse;
  const content = data?.output?.choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty response from Qwen API");
  return content;
}

// ─── Rule-based fallback (no API key) ────────────────────────────────────────
function buildRuleBasedAnswer(question: string): string {
  const q = question.toLowerCase();

  if (q.includes("hrv") || q.includes("heart rate variability") || q.includes("variability")) {
    return `HRV (Heart Rate Variability) — specifically RMSSD — measures the millisecond-level variation between consecutive heartbeats. It reflects your autonomic nervous system balance: higher HRV generally indicates stronger parasympathetic (rest-and-digest) activity and better cardiovascular health. WALLNUT calculates HRV by detecting peaks in the cardiac-filtered CSI signal (0.8–2.0 Hz bandpass), computing successive RR interval differences, then applying the RMSSD formula: √(Σ(ΔRR)²/N). Note: CSI-based HRV estimates have greater uncertainty than ECG-derived values — treat this as a screening indicator, not a clinical measurement.`;
  }
  if (q.includes("body fat") || q.includes("fat")) {
    return `Body fat percentage is estimated using an anthropometric regression model applied to your CSI-derived body dimensions. WALLNUT measures your shoulder width and hip width from the WiFi subcarrier energy profile, then applies a SMPL-fit model using Ramanujan ellipse circumference formulas with depth ratios from the CAESAR 3D body scan database. A body fat girth factor: fatF = 1.0 + (BF% − 22) / 80 scales segment circumferences. WHO thresholds: Healthy = 10–24% (males) / 17–30% (females). This is an estimation — clinical-grade measurement requires DEXA scan or hydrostatic weighing.`;
  }
  if (q.includes("wifi") || q.includes("csi") || q.includes("how") || q.includes("work")) {
    return `WALLNUT uses WiFi Channel State Information (CSI) — the amplitude and phase of 56 OFDM subcarrier frequencies in the 5 GHz band. When you stand near a WiFi access point, your body modulates these subcarriers through diffraction, attenuation, and Doppler shift. A 2nd-order IIR bandpass filter isolates the 0.1–0.5 Hz respiratory signal (chest expansion) and 0.8–2.0 Hz cardiac signal (ventricular micro-motion). Body dimensions are estimated from the time-averaged subcarrier energy profile. Everything runs locally — no camera, no contact.`;
  }

  return `That's a great question about your WALLNUT scan. The key metrics in your results are: heart rate (isolated from CSI at 0.8–2.0 Hz), breathing rate (0.1–0.5 Hz bandpass), HRV via RMSSD (peak detection of the cardiac signal), and body morphometrics via anthropometric SMPL-fit regression. For a deeper, personalised answer, please ensure the DASHSCOPE_API_KEY is configured in your .env.local file to enable Qwen AI responses.`;
}

// ─── Route handler ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<ChatRequest>;
    const question = (body.question ?? "").trim();
    const metrics = body.scanMetrics;

    if (!question) {
      return NextResponse.json({ error: "question is required" }, { status: 400 });
    }
    if (!metrics) {
      return NextResponse.json({ error: "scanMetrics is required" }, { status: 400 });
    }

    // 1. Retrieve RAG context (gracefully degrades if sidecar offline)
    const ragContext = await queryRagContext(question);
    const ragUsed = ragContext.length > 0;

    // 2. Assemble prompt
    const systemPrompt = buildSystemPrompt(ragContext, metrics);

    // 3. Call Qwen (or rule-based fallback)
    const answer = await callQwen(systemPrompt, question);

    return NextResponse.json({
      answer,
      ragUsed,
      sources: ragUsed ? ["MemPalace knowledge base"] : [],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[/api/chat]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
