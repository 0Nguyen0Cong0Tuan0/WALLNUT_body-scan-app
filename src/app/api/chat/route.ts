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

    const prompt = `You are a helpful health and wellness assistant analyzing WiFi CSI (Channel State Information) body scan results.

Current scan metrics:
- Heart Rate: ${scanMetrics.heartRateBpm.toFixed(0)} bpm
- Breathing Rate: ${scanMetrics.breathingRateBpm.toFixed(0)} bpm
- HRV: ${scanMetrics.hrv.toFixed(0)} ms
- Body Fat: ${scanMetrics.bodyFatPercent.toFixed(1)}% (${scanMetrics.bodyFatClassification})
- Estimated Height: ${scanMetrics.estimatedHeightCm.toFixed(0)} cm
- Shoulder Width: ${scanMetrics.shoulderWidthCm.toFixed(1)} cm
- Hip Width: ${scanMetrics.hipWidthCm.toFixed(1)} cm

User question: ${question}

Provide a helpful, educational response about their scan results. Keep responses concise (2-4 sentences). If they ask about health risks, include a disclaimer that this is educational info, not medical advice.`;

    console.log("[CHAT API] Sending request to DashScope...");
    
    const requestBody = {
      model: "qwen-plus",
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.7,
      max_tokens: 500,
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
