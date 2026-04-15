import { searchPubMedIds, fetchPubMedAbstracts } from '@/lib/pubmed';
import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const DASHSCOPE_ENDPOINTS = [
  "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  "https://dashscope.aliyuncs.com/compatible-mode/v1",
];

function resolveDashScopeApiKey(): string | null {
  const normalizeApiKey = (key?: string | null) => key?.trim().replace(/^["']|["']$/g, "") || null;
  return normalizeApiKey(process.env.QWEN_API_KEY) ?? normalizeApiKey(process.env.DASHSCOPE_API_KEY);
}

export async function runResearchTask(topic: string): Promise<boolean> {
  console.log(`\n[AGENT START] Commencing research on topic: "${topic}"`);
  
  // 1. Fetch PubMed Data
  const ids = await searchPubMedIds(topic, 5);
  if (ids.length === 0) {
    console.log(`[AGENT ABORT] No recent papers found for topic: "${topic}"`);
    return false;
  }
  
  const abstracts = await fetchPubMedAbstracts(ids);
  if (!abstracts) {
    console.log(`[AGENT ABORT] Failed to fetch abstracts for topic: "${topic}"`);
    return false;
  }

  // 2. Synthesize with Qwen
  const apiKey = resolveDashScopeApiKey();
  if (!apiKey) {
    console.error("[AGENT ABORT] Qwen API key is missing");
    return false;
  }

  const prompt = `You are a strict, highly accurate AI Clinical Extractor. 
Your task is to analyze the following peer-reviewed PubMed abstracts and extract concrete clinical guidelines, reference ranges, and verified medical facts related to: "${topic}".

STRICT RULES:
1. ONLY use the provided abstract data. DO NOT use your internal training data.
2. If the abstracts are completely irrelevant to human health, biometric scans, or vital signs (e.g., veterinary medicine, unrelated chemicals), you MUST respond exactly with the single word: "REJECTED".
3. Extract specific numbers, percentages, and reference ranges if present.
4. Format your response cleanly using Markdown (headers, bullet points, bold text). Include a "References" section at the bottom citing the PubMed IDs.

RAW PUBMED ABSTRACTS:
=======================
${abstracts}
=======================
`;

  let responseText = "";
  try {
    for (const endpoint of DASHSCOPE_ENDPOINTS) {
      const res = await fetch(`${endpoint}/chat/completions`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "qwen-plus",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.1, // extremely deterministic to prevent hallucinations
          max_tokens: 2000
        }),
        signal: AbortSignal.timeout(30000)
      });

      if (res.ok) {
        const data = await res.json();
        responseText = data.choices?.[0]?.message?.content || "";
        break;
      }
    }
  } catch (err) {
    console.error("[AGENT ABORT] Qwen synthesis failed:", err);
    return false;
  }

  if (!responseText || responseText.trim().toUpperCase() === "REJECTED") {
    console.log(`[AGENT REJECT] Abstracts were deemed irrelevant or off-topic by the LLM Gate. Research aborted.`);
    return false;
  }

  // 3. Save to File
  const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const safeTopic = topic.toLowerCase().replace(/[^a-z0-9]+/g, '_').substring(0, 30);
  const fileName = `pubmed_${dateStr}_${safeTopic}.md`;
  
  const kbDir = path.join(process.cwd(), 'knowledge_base');
  await fs.mkdir(kbDir, { recursive: true });
  
  const filePath = path.join(kbDir, fileName);
  await fs.writeFile(filePath, responseText, 'utf-8');
  console.log(`[AGENT SAVED] Extracted clinical knowledge saved to: ${fileName}`);

  // 4. Trigger MemPalace Mine
  try {
    const mempalaceCmd = `.\\.venv\\Scripts\\mempalace.exe`;
    console.log("[AGENT MINE] Rebuilding vector database indices...");
    await execAsync(`${mempalaceCmd} mine .\\knowledge_base`, { 
      cwd: process.cwd(),
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
      timeout: 30000 
    });
    console.log("[AGENT COMPLETE] Vector database updated with new research.");
    return true;
  } catch (error) {
    console.error("[AGENT ERROR] Failed to mine folder into mempalace:", error);
    return false;
  }
}
