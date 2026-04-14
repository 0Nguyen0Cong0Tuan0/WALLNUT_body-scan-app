"use client";
import { useState, useRef, useEffect, useCallback } from "react";

// ─── Types ─────────────────────────────────────────────────────────────────────
interface ScanMetrics {
  heartRateBpm: number;
  breathingRateBpm: number;
  hrv: number;
  bodyFatPercent: number;
  bodyFatClassification: string;
  estimatedHeightCm: number;
  shoulderWidthCm: number;
  hipWidthCm: number;
  clinicalSummary?: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
}

interface Props {
  scanMetrics: ScanMetrics;
}

// ─── Smart suggested questions ────────────────────────────────────────────────
function buildSuggestions(m: ScanMetrics): string[] {
  const q: string[] = [];
  if (m.hrv < 25) q.push(`My HRV is ${m.hrv.toFixed(0)} ms — is that low?`);
  else q.push(`What does my HRV of ${m.hrv.toFixed(0)} ms indicate?`);
  if (m.bodyFatPercent > 28) q.push(`What are the risks of my ${m.bodyFatPercent.toFixed(1)}% body fat?`);
  else q.push(`Is ${m.bodyFatPercent.toFixed(1)}% body fat healthy for me?`);
  q.push("How should I interpret my heart rate and HRV together?");
  q.push("How does WiFi actually measure my heart rate through the air?");
  return q.slice(0, 4);
}

// ─── Typing indicator ──────────────────────────────────────────────────────────
function TypingDots() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
      <div style={{
        width: 26, height: 26, borderRadius: "50%", flexShrink: 0,
        background: "linear-gradient(135deg, #0ea5e9, #8b5cf6)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: "0.6rem", fontWeight: 800, color: "#fff",
      }}>AI</div>
      <div style={{
        padding: "10px 14px", borderRadius: "14px 14px 14px 4px",
        background: "#111827", border: "1px solid #1e2a35",
        display: "flex", gap: 5, alignItems: "center",
      }}>
        {[0, 180, 360].map(delay => (
          <span key={delay} style={{
            display: "inline-block", width: 6, height: 6,
            borderRadius: "50%", background: "#4a8fa8",
            animation: `bounce 1.1s ${delay}ms ease-in-out infinite`,
          }}/>
        ))}
      </div>
    </div>
  );
}

// ─── Simple markdown parser ───────────────────────────────────────────────────
function parseMarkdown(text: string): React.ReactNode {
  // Split by lines and process each
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let inList = false;
  let listItems: React.ReactNode[] = [];

  const flushList = () => {
    if (listItems.length > 0) {
      elements.push(
        <ul key={`ul-${elements.length}`} style={{ margin: "8px 0", paddingLeft: "20px" }}>
          {listItems}
        </ul>
      );
      listItems = [];
    }
    inList = false;
  };

  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    
    // Headers (###, ##, **text**)
    if (trimmed.startsWith("### ")) {
      flushList();
      elements.push(
        <h4 key={idx} style={{ margin: "12px 0 8px", fontSize: "0.9rem", fontWeight: 700, color: "#e2e8f0" }}>
          {parseInlineMarkdown(trimmed.substring(4))}
        </h4>
      );
    } else if (trimmed.startsWith("## ")) {
      flushList();
      elements.push(
        <h3 key={idx} style={{ margin: "14px 0 10px", fontSize: "1rem", fontWeight: 700, color: "#e2e8f0" }}>
          {parseInlineMarkdown(trimmed.substring(3))}
        </h3>
      );
    } else if (trimmed.startsWith("**") && trimmed.endsWith("**") && !trimmed.includes(" ")) {
      // Section headers like **1. TITLE**
      flushList();
      elements.push(
        <h3 key={idx} style={{ margin: "14px 0 10px", fontSize: "0.95rem", fontWeight: 700, color: "#e2e8f0" }}>
          {parseInlineMarkdown(trimmed)}
        </h3>
      );
    } else if (trimmed.startsWith("- ") || trimmed.startsWith("• ")) {
      // List items
      inList = true;
      listItems.push(
        <li key={idx} style={{ margin: "4px 0" }}>
          {parseInlineMarkdown(trimmed.substring(2))}
        </li>
      );
    } else if (trimmed === "") {
      // Empty line
      if (inList) {
        flushList();
      }
    } else {
      flushList();
      elements.push(
        <p key={idx} style={{ margin: "8px 0" }}>
          {parseInlineMarkdown(trimmed)}
        </p>
      );
    }
  });

  flushList();
  return <>{elements}</>;
}

// Parse inline markdown (**bold**, *italic*)
function parseInlineMarkdown(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let current = "";
  let i = 0;

  while (i < text.length) {
    if (text.substring(i, i + 2) === "**") {
      if (current) {
        parts.push(current);
        current = "";
      }
      const end = text.indexOf("**", i + 2);
      if (end !== -1) {
        parts.push(<strong key={i} style={{ fontWeight: 700, color: "#fff" }}>{text.substring(i + 2, end)}</strong>);
        i = end + 2;
      } else {
        current += "**";
        i += 2;
      }
    } else if (text[i] === "*" && text[i + 1] !== "*") {
      if (current) {
        parts.push(current);
        current = "";
      }
      const end = text.indexOf("*", i + 1);
      if (end !== -1) {
        parts.push(<em key={i} style={{ fontStyle: "italic" }}>{text.substring(i + 1, end)}</em>);
        i = end + 1;
      } else {
        current += "*";
        i++;
      }
    } else {
      current += text[i];
      i++;
    }
  }

  if (current) {
    parts.push(current);
  }

  return <>{parts}</>;
}

// ─── Message bubble ────────────────────────────────────────────────────────────
function Bubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === "user";
  return (
    <div style={{
      display: "flex", justifyContent: isUser ? "flex-end" : "flex-start",
      gap: 8, marginBottom: 12, alignItems: "flex-end",
    }}>
      {!isUser && (
        <div style={{
          width: 26, height: 26, borderRadius: "50%", flexShrink: 0,
          background: "linear-gradient(135deg, #0ea5e9, #8b5cf6)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: "0.6rem", fontWeight: 800, color: "#fff",
        }}>AI</div>
      )}
      <div style={{
        maxWidth: "82%",
        padding: "9px 13px",
        borderRadius: isUser ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
        background: isUser ? "linear-gradient(135deg, #0ea5e9, #0284c7)" : "#111827",
        border: isUser ? "none" : "1px solid #1e2a35",
        color: isUser ? "#fff" : "#c8d8e8",
        fontSize: "0.8rem", lineHeight: 1.65,
        boxShadow: isUser ? "0 2px 8px #0ea5e920" : "none",
      }}>
        {isUser ? (
          <span style={{ whiteSpace: "pre-wrap" }}>{msg.text}</span>
        ) : (
          parseMarkdown(msg.text)
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function ChatWithAI({ scanMetrics }: Props) {
  const WELCOME: ChatMessage = {
    id: "welcome", role: "assistant",
    text: `Hello! I'm analysing your WALLNUT scan:\n• Heart rate: ${scanMetrics.heartRateBpm.toFixed(0)} bpm  • HRV: ${scanMetrics.hrv.toFixed(0)} ms  • Body fat: ${scanMetrics.bodyFatPercent.toFixed(1)}% (${scanMetrics.bodyFatClassification})\n\nAsk me anything about your results or the WiFi sensing technology.`,
  };

  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const suggestions = buildSuggestions(scanMetrics);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const send = useCallback(async (text: string) => {
    if (!text.trim() || loading) return;
    setError(null);
    setMessages(prev => [...prev, { id: `u${Date.now()}`, role: "user", text: text.trim() }]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text.trim(), scanMetrics }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json() as { answer: string };
      setMessages(prev => [...prev, {
        id: `a${Date.now()}`, role: "assistant",
        text: data.answer,
      }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection error");
    } finally {
      setLoading(false);
    }
  }, [loading, scanMetrics]);

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); }
  };

  return (
    <>
      <style>{`
        @keyframes bounce {
          0%,80%,100%{transform:translateY(0);opacity:.4}
          40%{transform:translateY(-5px);opacity:1}
        }
        @keyframes slideUp {
          from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)}
        }
      `}</style>

      <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "10px 14px", borderBottom: "1px solid #1e2a35", flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <div style={{
              width: 32, height: 32, borderRadius: "50%",
              background: "linear-gradient(135deg, #0ea5e9, #8b5cf6)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "0.7rem", fontWeight: 800, color: "#fff",
            }}>AI</div>
            <div>
              <div style={{ fontSize: "0.82rem", fontWeight: 700, color: "#e2e8f0" }}>Chat with AI</div>
              <div style={{ fontSize: "0.62rem", color: "#4a8fa8" }}>
                Qwen-Plus · Scan-aware context
              </div>
            </div>
          </div>
          <span style={{ fontSize: "0.6rem", color: "#22c55e", display: "flex", alignItems: "center", gap: 4, fontWeight: 600 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e", display: "inline-block" }} />
            Online
          </span>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: "auto", padding: 14, minHeight: 0 }}>
          {messages.map(m => (
            <div key={m.id} style={{ animation: "slideUp .2s ease-out" }}>
              <Bubble msg={m} />
            </div>
          ))}
          {loading && <TypingDots />}
          {error && (
            <div style={{
              padding: "8px 12px", borderRadius: "0.5rem", marginBottom: 8,
              background: "#2d1515", border: "1px solid #7f1d1d",
              fontSize: "0.75rem", color: "#fca5a5",
            }}>
              ⚠ {error}
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Suggestions — shown only at the beginning */}
        {messages.length <= 2 && (
          <div style={{ padding: "0 14px 10px", flexShrink: 0, display: "flex", flexWrap: "wrap", gap: 6 }}>
            {suggestions.map(q => (
              <button key={q} onClick={() => send(q)} disabled={loading} style={{
                fontSize: "0.68rem", color: "#22d3ee", background: "#22d3ee0d",
                border: "1px solid #22d3ee25", borderRadius: "0.75rem",
                padding: "4px 10px", cursor: "pointer", textAlign: "left",
                lineHeight: 1.4, opacity: loading ? 0.5 : 1,
              }}>{q}</button>
            ))}
          </div>
        )}

        {/* Input */}
        <div style={{
          padding: "10px 14px 12px", borderTop: "1px solid #1e2a35",
          flexShrink: 0, display: "flex", gap: 8, alignItems: "flex-end",
        }}>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKey}
            placeholder="Ask about your scan results, the WiFi technology, or health guidance…"
            rows={1}
            disabled={loading}
            style={{
              flex: 1, resize: "none", background: "#0d1117",
              border: "1px solid #1e2a35", borderRadius: "0.75rem",
              padding: "9px 12px", color: "#c8d8e8", fontSize: "0.8rem",
              lineHeight: 1.5, outline: "none", fontFamily: "inherit",
              maxHeight: 100, overflowY: "auto", opacity: loading ? 0.7 : 1,
            }}
            onFocus={e => { e.target.style.borderColor = "#22d3ee40"; }}
            onBlur={e => { e.target.style.borderColor = "#1e2a35"; }}
          />
          <button
            onClick={() => send(input)}
            disabled={loading || !input.trim()}
            style={{
              width: 38, height: 38, borderRadius: "0.625rem", flexShrink: 0,
              background: input.trim() && !loading ? "linear-gradient(135deg, #0ea5e9, #0284c7)" : "#0a1018",
              border: "1px solid #1e2a35",
              cursor: input.trim() && !loading ? "pointer" : "not-allowed",
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "all 0.15s",
            }}
          >
            <svg viewBox="0 0 24 24" fill="none"
              stroke={input.trim() && !loading ? "#fff" : "#4a637a"}
              strokeWidth={2} style={{ width: 16, height: 16 }}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
          </button>
        </div>

        <div style={{
          padding: "4px 14px 8px", fontSize: "0.56rem", color: "#3a4f60",
          textAlign: "center", flexShrink: 0,
        }}>
          AI responses are educational only and do not constitute medical advice.
        </div>
      </div>
    </>
  );
}
