import { ModelConfigError, ModelProviderError } from "@/lib/scanErrors";
import { fetch as undiciFetch, ProxyAgent } from "undici";
import { InferenceAnalysis } from "./inferenceEngine";

const DASHSCOPE_ENDPOINTS = [
  "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  "https://dashscope.aliyuncs.com/compatible-mode/v1",
];

function getProxyAgent(): ProxyAgent | undefined {
  const proxyUrl = process.env.HTTP_PROXY || process.env.HTTPS_PROXY;
  if (proxyUrl) {
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
      let response: Response;
      if (proxyAgent) {
        const undiciResponse = await undiciFetch(`${endpoint}/chat/completions`, {
          method: options.method,
          headers: options.headers as Record<string, string>,
          body: options.body as string,
          signal: options.signal as AbortSignal,
          dispatcher: proxyAgent,
        });
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
      return response;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastError || new Error("All endpoints failed");
}

function resolveDashScopeApiKey(): string | null {
  const key = process.env.QWEN_API_KEY ?? process.env.DASHSCOPE_API_KEY;
  if (!key) return null;
  const trimmed = key.trim();
  if (!trimmed) return null;
  return trimmed.replace(/^["']|["']$/g, "");
}

function classifyBodyFat(bodyFatPercent: number): { classification: string; color: string } {
  if (bodyFatPercent < 10) return { classification: "Underfat", color: "amber" };
  if (bodyFatPercent < 25) return { classification: "Healthy", color: "emerald" };
  if (bodyFatPercent < 32) return { classification: "Overfat", color: "orange" };
  return { classification: "Obese", color: "rose" };
}

function parseJsonObjectContent(content: string): Record<string, unknown> {
  const trimmed = content.trim();
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenced?.[1]) {
      return JSON.parse(fenced[1]) as Record<string, unknown>;
    }
    throw new ModelProviderError("Model response is not valid JSON.", {
      responsePreview: trimmed.slice(0, 320),
    });
  }
}

export function ruleBasedVisionAnalysis(heightCm: number, weightKg: number): InferenceAnalysis {
  // BMI calculation
  const heightM = heightCm / 100;
  const bmi = weightKg / (heightM * heightM);

  // Deurenberg Formula: BF% = (1.20 * BMI) + (0.23 * Age) - (10.8 * Gender) - 5.4
  // We don't have Age or Gender, so we will assume Age 30 and average gender factor:
  // Male gender = 1, Female = 0. We'll use 0.5 for an un-gendered fallback.
  // BF% = (1.20 * BMI) + (0.23 * 30) - (10.8 * 0.5) - 5.4 = 1.20 * BMI + 6.9 - 5.4 - 5.4
  // Let's use a simpler unisex approximation derived from Deurenberg:
  let bodyFatPercent = (1.20 * bmi) - 2.5; 
  bodyFatPercent = Math.max(5, Math.min(45, parseFloat(bodyFatPercent.toFixed(1))));

  const bodyFatClass = classifyBodyFat(bodyFatPercent);
  
  // Waist estimation - standard waist to height ratio
  // Healthy WtHR is ~0.45 to 0.5. As BF goes up, waist goes up.
  // Let's estimate waist = height * (0.42 + (bodyFatPercent - 15) * 0.005)
  const estimatedWaistCm = Math.round(Math.max(50, heightCm * (0.40 + (bodyFatPercent - 10) * 0.007)));

  return {
    bodyFatPercent,
    bodyFatClassification: bodyFatClass.classification,
    classColor: bodyFatClass.color,
    estimatedWaistCm,
    clinicalSummary: `Based on mathematical BMI interpretation (Height: ${heightCm}cm, Weight: ${weightKg}kg), estimated body fat is ${bodyFatPercent}% (${bodyFatClass.classification}). Please note this is a purely mathematical fallback and may not reflect muscularity accurately without physical image analysis.`,
    recommendations: [
      bodyFatPercent > 25
        ? "Incorporate 30 min moderate aerobic exercise 4–5 days per week."
        : "Maintain a consistent wellness routine and log weekly scans to track trends.",
      "Consider using the Vision Model with a clear assessment image for personalized insights.",
      "Stay hydrated and ensure adequate protein intake for muscle maintenance.",
    ],
    postureNotes: "No posture data available in fallback mathematical mode.",
    source: "rule-based",
  };
}

export async function runVisionEngine(
  imageBase64: string,
  heightCm: number,
  weightKg: number
): Promise<InferenceAnalysis> {
  const apiKey = resolveDashScopeApiKey();
  if (!apiKey) {
    // Graceful fallback when no config exists
    console.warn("No Qwen API Key found, using mathematical fallback algorithm.");
    return ruleBasedVisionAnalysis(heightCm, weightKg);
  }

  const prompt = `You are a clinical body composition analyst. Analyze the provided image of a person, factoring in their reported height of ${heightCm} cm and weight of ${weightKg} kg.

Assess muscle definition, visible body contours, regional adiposity (e.g. abdominal, limbs), and overall body shape.

Output requirements:
1. Return JSON only (no markdown or prose before/after).
2. "clinicalSummary" should be 2-3 short sentences evaluating their composition based on visual markers and statistical BMI.
3. "recommendations" must contain 3 concise health or fitness recommendations based on your observation.
4. "postureNotes" should mention any visible postural issues from the image (e.g., rounded shoulders, pelvic tilt), or say "Appears normal" if none.
5. "bodyFatClassification" must be one of: Underfat, Healthy, Overfat, Obese.

Return this exact schema:
{
  "bodyFatPercent": <number>,
  "bodyFatClassification": "<Underfat|Healthy|Overfat|Obese>",
  "estimatedWaistCm": <number>,
  "clinicalSummary": "<string>",
  "recommendations": ["<string>", "<string>", "<string>"],
  "postureNotes": "<string>"
}`;

  const requestBody = {
    model: "qwen-vl-max",
    messages: [
      {
        role: "user",
        // Using multimodal array content for Dashscope Qwen-VL OpenAI compatibility
        content: [
          { type: "image_url", image_url: { url: imageBase64 } },
          { type: "text", text: prompt }
        ]
      }
    ],
    temperature: 0.1, // we want highly deterministic structured output
    response_format: { type: "json_object" } 
  };

  try {
    const response = await tryFetchWithFallback(DASHSCOPE_ENDPOINTS, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    const payload = await response.json();
    if (!response.ok) {
      console.error("Qwen-VL Multimodal API Error:", payload);
      // Fallback on error
      return ruleBasedVisionAnalysis(heightCm, weightKg);
    }

    const contentStr = payload.choices?.[0]?.message?.content;
    if (!contentStr) {
      throw new Error("No content in model response");
    }

    const qwenResult = parseJsonObjectContent(contentStr);
    
    // Process and cast output to expected types safely
    const rawBodyFat = Number(qwenResult.bodyFatPercent);
    const safeBodyFat = Math.max(5, Math.min(45, Number.isFinite(rawBodyFat) ? rawBodyFat : 22));
    const rawClass = classifyBodyFat(safeBodyFat);
    
    const summary = String(qwenResult.clinicalSummary ?? "").trim();
    
    let safeRecommendations = ["Maintain your current wellness routine.", "Use weekly tracking.", "Seek clinician guidance if needed."];
    if (Array.isArray(qwenResult.recommendations) && qwenResult.recommendations.length > 0) {
      safeRecommendations = qwenResult.recommendations.map(s => String(s)).slice(0,3);
    }

    return {
      bodyFatPercent: parseFloat(safeBodyFat.toFixed(1)),
      bodyFatClassification: String(qwenResult.bodyFatClassification ?? rawClass.classification),
      classColor: rawClass.color,
      estimatedWaistCm: Math.round(Number(qwenResult.estimatedWaistCm) || (heightCm * 0.45)),
      clinicalSummary: summary.length > 0 ? summary : "Image analyzed by Qwen-VL Multimodal Vision.",
      recommendations: safeRecommendations,
      postureNotes: String(qwenResult.postureNotes ?? "Appears normal"),
      source: "qwen"
    };

  } catch (error) {
    console.error("Vision Engine Encountered Error:", error);
    return ruleBasedVisionAnalysis(heightCm, weightKg);
  }
}
