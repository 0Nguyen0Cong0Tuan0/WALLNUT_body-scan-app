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
  activity: string;
  activityConfidence: number;
  clinicalSummary?: string;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp: number;
  ragContext?: boolean;
}

interface Props {
  scanMetrics: ScanMetrics;
  isExpanded?: boolean;
  onToggle?: () => void;
}

// ─── Suggested questions ───────────────────────────────────────────────────────
function buildSuggestions(metrics: ScanMetrics): string[] {
  const questions: string[] = [];

  if (metrics.hrv < 25) questions.push("My HRV is low — what does that mean for my health?");
  else questions.push("What does my HRV score indicate about my autonomic nervous system?");

  if (metrics.bodyFatPercent > 30) questions.push("What are the health risks of my body fat percentage?");
  else questions.push("Is my body fat percentage in a healthy range?");

  questions.push(`Why was I classified as "${metrics.activity}" and how accurate is that?`);
  questions.push("How does WiFi CSI actually measure my breathing and heart rate?");
  questions.push("What lifestyle changes would improve my scan results over time?");

  return questions.slice(0, 4);
}

// ─── Message bubble ────────────────────────────────────────────────────────────
function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === "user";

  return (
    <div style={{
      display: "flex", justifyContent: isUser ? "flex-end" : "flex-start",
      marginBottom: 12, alignItems: "flex-end", gap: 8,
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
        fontSize: "0.8rem",
        lineHeight: 1.65,
        boxShadow: isUser ? "0 2px 8px #0ea5e920" : "none",
      }}>
        {msg.ragContext && !isUser && (
          <div style={{
            fontSize: "0.58rem", color: "#4a8fa8", fontWeight: 600,
            letterSpacing: "0.07em", textTransform: "uppercase",
            marginBottom: 5, display: "flex", alignItems: "center", gap: 4,
          }}>
            <span style={{ display: "inline-block", width: 5, height: 5, borderRadius: "50%", background: "#22d3ee" }} />
            RAG-grounded · MemPalace knowledge base
          </div>
        )}
        <span style={{ whiteSpace: "pre-wrap" }}>{msg.text}</span>
      </div>
    </div>
  );
}

// ─── Typing indicator ──────────────────────────────────────────────────────────
function TypingIndicator() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
      <div style={{
        width: 26, height: 26, borderRadius: "50%",
        background: "linear-gradient(135deg, #0ea5e9, #8b5cf6)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: "0.6rem", fontWeight: 800, color: "#fff", flexShrink: 0,
      }}>AI</div>
      <div style={{
        padding: "10px 14px", borderRadius: "14px 14px 14px 4px",
        background: "#111827", border: "1px solid #1e2a35",
        display: "flex", alignItems: "center", gap: 5,
      }}>
        {[0, 0.2, 0.4].map(delay => (
          <div key={delay} style={{
            width: 6, height: 6, borderRadius: "50%", background: "#4a8fa8",
            animation: "pulse 1.2s ease-in-out infinite",
            animationDelay: `${delay}s`,
          }} />
        ))}
      </div>
    </div>
  );
}

// ─── Root component ────────────────────────────────────────────────────────────
export default function ChatAssistant({ scanMetrics, isExpanded, onToggle }: Props) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      text: `Hello! I'm WALLNUT's AI health assistant. I've analysed your scan — your heart rate is ${scanMetrics.heartRateBpm} bpm, body fat ${scanMetrics.bodyFatPercent}% (${scanMetrics.bodyFatClassification}), and HRV is ${scanMetrics.hrv} ms.\n\nAsk me anything about your results, the WiFi sensing technology, or what these metrics mean for your health. I use a clinical knowledge base to ground my answers.`,
      timestamp: Date.now(),
      ragContext: false,
    }
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const suggestions = buildSuggestions(scanMetrics);

  // Auto-scroll on new message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isLoading) return;
    setError(null);

    const userMsg: Message = {
      id: `u-${Date.now()}`,
      role: "user",
      text: text.trim(),
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: text.trim(),
          scanMetrics,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
      }

      const data = await res.json() as { answer: string; ragUsed: boolean; sources?: string[] };
      const aiMsg: Message = {
        id: `a-${Date.now()}`,
        role: "assistant",
        text: data.answer,
        timestamp: Date.now(),
        ragContext: data.ragUsed,
      };
      setMessages(prev => [...prev, aiMsg]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reach AI assistant");
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, scanMetrics]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  return (
    <>
      {/* CSS keyframes */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.35; transform: scale(0.85); }
          50% { opacity: 1; transform: scale(1); }
        }
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <div style={{
        display: "flex", flexDirection: "column",
        height: "100%", minHeight: 0,
      }}>
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
              <div style={{ fontSize: "0.82rem", fontWeight: 700, color: "#e2e8f0" }}>
                WALLNUT Health Assistant
              </div>
              <div style={{ fontSize: "0.62rem", color: "#4a8fa8" }}>
                Qwen-Plus · RAG-grounded · MemPalace knowledge base
              </div>
            </div>
          </div>
          <div style={{
            fontSize: "0.62rem", color: "#22c55e", fontWeight: 600,
            display: "flex", alignItems: "center", gap: 4,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e", display: "inline-block" }} />
            Online
          </div>
        </div>

        {/* Message area */}
        <div style={{
          flex: 1, overflowY: "auto", padding: "14px",
          display: "flex", flexDirection: "column",
          minHeight: 0,
        }}>
          {messages.map(msg => (
            <div key={msg.id} style={{ animation: "slideUp 0.2s ease-out" }}>
              <MessageBubble msg={msg} />
            </div>
          ))}
          {isLoading && <TypingIndicator />}
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

        {/* Suggested questions */}
        {messages.length <= 2 && (
          <div style={{
            padding: "0 14px 10px", flexShrink: 0,
            display: "flex", flexWrap: "wrap", gap: 6,
          }}>
            {suggestions.map(q => (
              <button
                key={q}
                onClick={() => sendMessage(q)}
                disabled={isLoading}
                style={{
                  fontSize: "0.68rem", color: "#22d3ee",
                  background: "#22d3ee0d", border: "1px solid #22d3ee25",
                  borderRadius: "0.75rem", padding: "4px 10px",
                  cursor: "pointer", textAlign: "left",
                  opacity: isLoading ? 0.5 : 1,
                  lineHeight: 1.4,
                }}
              >
                {q}
              </button>
            ))}
          </div>
        )}

        {/* Input area */}
        <div style={{
          padding: "10px 14px 12px", borderTop: "1px solid #1e2a35",
          flexShrink: 0, display: "flex", gap: 8, alignItems: "flex-end",
        }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your scan results, the technology, or health guidance…"
            rows={1}
            disabled={isLoading}
            style={{
              flex: 1, resize: "none", background: "#0d1117",
              border: "1px solid #1e2a35", borderRadius: "0.75rem",
              padding: "9px 12px", color: "#c8d8e8", fontSize: "0.8rem",
              lineHeight: 1.5, outline: "none", fontFamily: "inherit",
              maxHeight: 100, overflowY: "auto",
              opacity: isLoading ? 0.7 : 1,
            }}
            onFocus={e => { e.target.style.borderColor = "#22d3ee40"; }}
            onBlur={e => { e.target.style.borderColor = "#1e2a35"; }}
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={isLoading || !input.trim()}
            style={{
              width: 38, height: 38, borderRadius: "0.625rem", flexShrink: 0,
              background: input.trim() && !isLoading
                ? "linear-gradient(135deg, #0ea5e9, #0284c7)"
                : "#0a1018",
              border: "1px solid #1e2a35", cursor: input.trim() && !isLoading ? "pointer" : "default",
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "all 0.15s",
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke={input.trim() && !isLoading ? "#fff" : "#4a637a"}
              strokeWidth={2} style={{ width: 16, height: 16 }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
          </button>
        </div>

        {/* Footer disclaimer */}
        <div style={{
          padding: "4px 14px 8px", fontSize: "0.58rem", color: "#3a4f60",
          textAlign: "center", flexShrink: 0,
        }}>
          AI responses are educational only and do not constitute medical advice. Consult a qualified clinician for diagnosis.
        </div>
      </div>
    </>
  );
}
