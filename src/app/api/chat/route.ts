import { NextRequest, NextResponse } from "next/server";
import { fetch as undiciFetch, ProxyAgent } from "undici";

interface ChatRequest {
  question: string;
  scanMetrics: {
    heartRateBpm: number;
    breathingRateBpm: number;
    hrv: number;
    bodyFatPercent: number;
    bodyFatClassification: string;
    estimatedHeightCm: number;
    shoulderWidthCm: number;
    hipWidthCm: number;
    clinicalSummary?: string;
  };
}

// Endpoints to try in order (international first, then US as fallback)
const DASHSCOPE_ENDPOINTS = [
  "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  "https://dashscope.aliyuncs.com/compatible-mode/v1",
];

// Create proxy agent if HTTP_PROXY is set
function getProxyAgent(): ProxyAgent | undefined {
  const proxyUrl = process.env.HTTP_PROXY || process.env.HTTPS_PROXY;
  if (proxyUrl) {
    console.log(`[CHAT API] Using proxy: ${proxyUrl}`);
    return new ProxyAgent(proxyUrl);
  }
  return undefined;
}

async function tryFetchWithFallback(
  endpoints: string[],
  options: RequestInit
): Promise<Response> {
  let lastError: Error | null = null;
  const proxyAgent = getProxyAgent();
  
  for (const endpoint of endpoints) {
    try {
      console.log(`[CHAT API] Trying endpoint: ${endpoint}`);
      
      // Use undici fetch with proxy support
      let response: Response;
      if (proxyAgent) {
        const undiciResponse = await undiciFetch(`${endpoint}/chat/completions`, {
          method: options.method,
          headers: options.headers as Record<string, string>,
          body: options.body as string,
          signal: options.signal as AbortSignal,
          dispatcher: proxyAgent,
        });
        // Convert undici Response to standard Response
        response = new Response(undiciResponse.body as ReadableStream, {
          status: undiciResponse.status,
          statusText: undiciResponse.statusText,
          headers: Object.fromEntries(undiciResponse.headers.entries()),
        });
      } else {
        response = await fetch(`${endpoint}/chat/completions`, {
          ...options,
          keepalive: true,
        });
      }
      console.log(`[CHAT API] Success with endpoint: ${endpoint}`);
      return response as Response;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.error(`[CHAT API] Failed with ${endpoint}:`, lastError.message);
      // Continue to next endpoint
    }
  }
  
  throw lastError || new Error("All endpoints failed");
}

function normalizeApiKey(key?: string | null): string | null {
  const trimmed = key?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/^["']|["']$/g, "");
}

function resolveDashScopeApiKey(): string | null {
  return normalizeApiKey(process.env.QWEN_API_KEY) ?? normalizeApiKey(process.env.DASHSCOPE_API_KEY);
}

// Validate if question is health/medical related by asking Qwen to evaluate
async function validateQuestionIsHealthRelated(
  question: string,
  apiKey: string
): Promise<{ isValid: boolean; reason?: string }> {
  const validationPrompt = `You are a strict content validator for a medical health assistant. Your ONLY job is to determine if the user question is directly related to health, medical, wellness, fitness, body metrics, vital signs, or medical technology.

STRICT RULES:
- Health-related: Questions about vital signs, body composition, cardiovascular health, fitness, exercise, nutrition, wellness, medical scans, health metrics
- NOT health-related: General knowledge, weather, news, entertainment, jokes, stories, math, coding, personal opinions, philosophy, history, geography

User question: "${question}"

Analyze carefully. Is this question asking about health/medical topics?

Respond with EXACTLY one of these two formats (nothing else):
VALID: [brief reason - e.g., "asks about heart rate and cardiovascular health"]
INVALID: [brief reason - e.g., "asks about weather, not health-related"]

Be EXTREMELY strict. If there's any doubt, mark as INVALID.`;

  const validationBody = {
    model: "qwen-plus",
    messages: [{ role: "user", content: validationPrompt }],
    temperature: 0.1, // Lower temperature for more consistent validation
    max_tokens: 150,
  };

  try {
    console.log("[CHAT API] Starting validation for question:", question);
    
    const response = await tryFetchWithFallback(DASHSCOPE_ENDPOINTS, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(validationBody),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      console.error("[CHAT API] Validation API error:", response.status);
      // Fail-closed: reject if validation API fails
      return { isValid: false, reason: "Validation service unavailable" };
    }

    const data = await response.json();
    const answer = data.choices?.[0]?.message?.content?.trim() || "";
    
    console.log("[CHAT API] Raw validation response:", answer);
    console.log("[CHAT API] Answer starts with VALID:", answer.toUpperCase().startsWith("VALID"));
    console.log("[CHAT API] Answer starts with INVALID:", answer.toUpperCase().startsWith("INVALID"));
    
    // Must explicitly start with VALID to be accepted
    if (answer.toUpperCase().startsWith("VALID")) {
      return { isValid: true, reason: answer.replace(/^VALID:\s*/i, "") };
    }
    
    // Anything else (including errors, empty, or unclear) is rejected
    return { isValid: false, reason: answer.replace(/^INVALID:\s*/i, "") || "Question not clearly health-related" };
  } catch (err) {
    // Fail-closed: reject on any error
    console.error("[CHAT API] Validation exception:", err);
    return { isValid: false, reason: "Validation failed" };
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ChatRequest;
    const { question, scanMetrics } = body;

    const apiKey = resolveDashScopeApiKey();
    
    // Debug logging
    console.log("[CHAT API] API Key check:", {
      hasKey: !!apiKey,
      keyPrefix: apiKey ? apiKey.substring(0, 10) + "..." : null,
      envQwen: !!process.env.QWEN_API_KEY,
      envDash: !!process.env.DASHSCOPE_API_KEY,
    });
    
    if (!apiKey) {
      return NextResponse.json(
        { error: "Qwen API key not configured. Please set QWEN_API_KEY in .env.local" },
        { status: 503 }
      );
    }

    // Skip validation for clinical summary generation requests
    const isClinicalSummaryRequest = question.toLowerCase().includes("generate") && question.toLowerCase().includes("clinical summary");
    
    // Validate question is health-related (skip for internal/clinical summary requests)
    if (!isClinicalSummaryRequest) {
      console.log("[CHAT API] Validating question...");
      const validation = await validateQuestionIsHealthRelated(question, apiKey);
      
      if (!validation.isValid) {
        console.log("[CHAT API] Question rejected:", validation.reason);
        return NextResponse.json({
          answer: "I do not allow to answer this kind of question. I am specialized in health and wellness topics related to your WiFi CSI body scan results. Please ask me about your vital signs, body composition, cardiovascular health, or wellness recommendations.",
          model: "qwen-plus",
          validation: "rejected",
        });
      }
      
      console.log("[CHAT API] Question validated as health-related");
    }
    
    let prompt: string;
    
    if (isClinicalSummaryRequest) {
      // Generate full clinical summary report
      prompt = `You are a clinical health analyst generating a professional WiFi CSI (Channel State Information) body scan report. Analyze the following biometric data and produce a structured, medically-informed assessment.

=== PATIENT BIOMETRIC DATA ===
VITAL SIGNS:
• Heart Rate: ${scanMetrics.heartRateBpm.toFixed(0)} bpm
• Breathing Rate: ${scanMetrics.breathingRateBpm.toFixed(0)} breaths/min
• Heart Rate Variability (HRV): ${scanMetrics.hrv.toFixed(0)} ms

BODY COMPOSITION:
• Body Fat Percentage: ${scanMetrics.bodyFatPercent.toFixed(1)}%
• Classification: ${scanMetrics.bodyFatClassification}
• Estimated Height: ${scanMetrics.estimatedHeightCm.toFixed(0)} cm
• Shoulder Width: ${scanMetrics.shoulderWidthCm.toFixed(1)} cm
• Hip Width: ${scanMetrics.hipWidthCm.toFixed(1)} cm

=== CLINICAL REFERENCE RANGES ===
Heart Rate: 60-100 bpm (normal), <60 (bradycardia), >100 (tachycardia)
Breathing Rate: 12-20 breaths/min (normal), <12 (bradypnea), >20 (tachypnea)
HRV: 20-50 ms (typical adult range, higher indicates better autonomic function)
Body Fat: <14% (athletic), 14-17% (fitness), 18-24% (acceptable), 25-31% (overweight), >31% (obese)

=== YOUR TASK ===
Generate a professional clinical summary with the following structure:

**1. VITAL SIGNS ASSESSMENT**
Evaluate each vital sign against reference ranges. State if each is normal, elevated, or reduced. Provide brief clinical significance.

**2. CARDIOVASCULAR HEALTH PROFILE**
Analyze the interplay between heart rate, breathing rate, and HRV. Assess autonomic nervous system balance and cardiovascular efficiency.

**3. BODY COMPOSITION ANALYSIS**
Interpret body fat percentage and classification. Calculate and mention waist-to-hip ratio (shoulder width as proxy). Assess metabolic health implications.

**4. OVERALL WELLNESS SUMMARY**
Synthesize findings into a concise paragraph providing holistic health assessment.

**5. PERSONALIZED RECOMMENDATIONS**
Provide 3-4 specific, actionable recommendations based on the data:
- Exercise guidance tailored to body composition
- Stress management if HRV suggests sympathetic dominance
- Breathing exercises if respiratory rate is elevated
- Lifestyle adjustments for body fat optimization

=== FORMATTING REQUIREMENTS ===
• Use professional medical terminology appropriate for patient education
• Bold key metrics when first mentioned (e.g., **Heart Rate: 72 bpm**)
• Use bullet points (•) for lists
• Include section headers exactly as shown above
• Keep total response under 400 words
• End with: "**Disclaimer**: This analysis is for educational purposes only and does not constitute medical advice. Consult a healthcare provider for personalized medical guidance."

Provide the complete structured clinical assessment above.`;
    } else {
      // Regular chat response
      prompt = `You are a helpful health and wellness assistant analyzing WiFi CSI (Channel State Information) body scan results.

Current scan metrics:
• Heart Rate: ${scanMetrics.heartRateBpm.toFixed(0)} bpm
• Breathing Rate: ${scanMetrics.breathingRateBpm.toFixed(0)} breaths/min
• HRV: ${scanMetrics.hrv.toFixed(0)} ms
• Body Fat: ${scanMetrics.bodyFatPercent.toFixed(1)}% (${scanMetrics.bodyFatClassification})
• Estimated Height: ${scanMetrics.estimatedHeightCm.toFixed(0)} cm
• Shoulder Width: ${scanMetrics.shoulderWidthCm.toFixed(1)} cm
• Hip Width: ${scanMetrics.hipWidthCm.toFixed(1)} cm

${scanMetrics.clinicalSummary ? `PREVIOUS CLINICAL SUMMARY: ${scanMetrics.clinicalSummary}` : ""}

User question: ${question}

Provide a helpful, educational response about their scan results. Keep responses concise but informative (3-6 sentences). If they ask about health risks, include a disclaimer that this is educational info, not medical advice. Use markdown formatting (**bold** for emphasis, • for bullet points if listing items).`;
    }

    console.log("[CHAT API] Sending request to DashScope...");
    
    const requestBody = {
      model: "qwen-plus",
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.5,
      max_tokens: 10000, 
    };
    
    console.log("[CHAT API] Request:", {
      endpoints: DASHSCOPE_ENDPOINTS,
      model: requestBody.model,
      messageCount: requestBody.messages.length,
    });
    
    const response = await tryFetchWithFallback(DASHSCOPE_ENDPOINTS, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error("[CHAT API] DashScope error:", {
        status: response.status,
        errorData,
      });
      return NextResponse.json(
        { error: errorData.message || `DashScope API error: ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    console.log("[CHAT API] DashScope response:", {
      hasChoices: !!data.choices,
      choicesLength: data.choices?.length,
      firstChoiceContent: data.choices?.[0]?.message?.content?.substring(0, 50),
    });
    const answer = data.choices?.[0]?.message?.content || "I'm sorry, I couldn't generate a response at this time.";

    return NextResponse.json({
      answer,
      model: "qwen-plus",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isTimeout = msg.includes("AbortError") || msg.includes("timeout");
    const isFetchError = msg.includes("fetch failed") || msg.includes("UND_ERR_CONNECT_TIMEOUT");
    
    // Get detailed error cause (Node.js 18+ fetch errors have a 'cause' property)
    const errorCause = err instanceof Error && 'cause' in err 
      ? (err as Error & { cause?: Error }).cause 
      : null;
    const causeMessage = errorCause?.message || null;
    const causeCode = errorCause && 'code' in errorCause 
      ? (errorCause as Error & { code?: string }).code 
      : null;
    
    // Log detailed error for debugging
    console.error("[CHAT API ERROR]", {
      message: msg,
      causeMessage,
      causeCode,
      errorType: err instanceof Error ? err.constructor.name : typeof err,
      causeType: errorCause?.constructor?.name,
      isTimeout,
      isFetchError,
      stack: err instanceof Error ? err.stack : null,
    });
    
    let userMessage = msg;
    if (isTimeout) {
      userMessage = "Request timed out. Please try again.";
    } else if (isFetchError) {
      userMessage = "Network error connecting to Qwen API. Please check your internet connection or try again later.";
    } else if (causeCode === "ENOTFOUND" || causeCode === "ECONNREFUSED") {
      userMessage = `Cannot connect to Qwen API (${causeCode}). This may be a DNS or firewall issue.`;
    } else if (causeCode?.includes("SSL") || causeCode?.includes("TLS")) {
      userMessage = "SSL/TLS error connecting to Qwen API. Please check your system certificates.";
    }
    
    return NextResponse.json(
      { 
        error: userMessage,
        debug: process.env.NODE_ENV === "development" ? { 
          message: msg,
          causeMessage,
          causeCode,
          stack: err instanceof Error ? err.stack : null,
          type: err instanceof Error ? err.constructor.name : typeof err,
        } : undefined,
      },
      { status: 502 }
    );
  }
}
