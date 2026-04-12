/**
 * app/api/chat/route.ts — Thin proxy to rag-server
 * ==================================================
 * Forwards the browser's POST request to the FastAPI rag-server.
 * This avoids CORS complexity and keeps the API key on the server side.
 */

import { NextRequest, NextResponse } from "next/server";

const RAG_SERVER = process.env.RAG_SERVER_URL ?? "http://localhost:8787";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const upstream = await fetch(`${RAG_SERVER}/v1/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(35_000),  // 35 s — room for Qwen latency
    });

    const data = await upstream.json();

    if (!upstream.ok) {
      return NextResponse.json(
        { error: (data as { detail?: string }).detail ?? `RAG server error ${upstream.status}` },
        { status: upstream.status }
      );
    }

    return NextResponse.json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isTimeout = msg.includes("AbortError") || msg.includes("timeout");
    return NextResponse.json(
      { error: isTimeout ? "RAG server timed out. Is rag-server running?" : msg },
      { status: isTimeout ? 504 : 502 }
    );
  }
}
