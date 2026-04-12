#!/usr/bin/env python3
"""
rag_server.py — MemPalace FastAPI Sidecar
==========================================
Wraps MemPalace's search_memories() and exposes a REST endpoint
at http://localhost:8787 for the Next.js chat API route.

Start with:  python scripts/rag_server.py
Or:          uvicorn rag_server:app --port 8787 --reload  (from scripts/)
"""

import sys
import os
from pathlib import Path

# Add mempalace repo to path
REPO_ROOT = Path(__file__).parent.parent
MEMPALACE_REPO = REPO_ROOT.parent / "mempalace"
sys.path.insert(0, str(MEMPALACE_REPO))

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional

try:
    from mempalace.searcher import search_memories
    MEMPALACE_AVAILABLE = True
except ImportError:
    MEMPALACE_AVAILABLE = False
    print("⚠  MemPalace not found — run: pip install mempalace  (or point MEMPALACE_REPO correctly)")

# ── Configuration ─────────────────────────────────────────────────────────────
PALACE_PATH = os.environ.get(
    "WALLNUT_PALACE_PATH",
    str(Path(__file__).parent / "palace")
)

app = FastAPI(
    title="WALLNUT RAG Sidecar",
    description="MemPalace semantic search bridge for Next.js chat API",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)

# ── Request/Response schemas ──────────────────────────────────────────────────
class SearchRequest(BaseModel):
    query: str
    n_results: int = 5
    wing: Optional[str] = "wallnut_knowledge"
    room: Optional[str] = None
    max_distance: float = 0.85   # cosine distance threshold

class SearchHit(BaseModel):
    text: str
    wing: str
    room: str
    similarity: float
    distance: float

class SearchResponse(BaseModel):
    query: str
    results: list[SearchHit]
    palace_path: str
    mempalace_available: bool

# ── Routes ────────────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {
        "status": "ok",
        "mempalace_available": MEMPALACE_AVAILABLE,
        "palace_path": PALACE_PATH,
        "palace_exists": Path(PALACE_PATH).exists(),
    }

@app.post("/search", response_model=SearchResponse)
def search(req: SearchRequest):
    if not MEMPALACE_AVAILABLE:
        raise HTTPException(status_code=503, detail="MemPalace not installed. Run: pip install mempalace")

    palace_path = Path(PALACE_PATH)
    if not palace_path.exists():
        raise HTTPException(
            status_code=503,
            detail=f"Palace not found at {PALACE_PATH}. Run: python scripts/ingest_knowledge.py"
        )

    raw = search_memories(
        query=req.query,
        palace_path=str(palace_path),
        wing=req.wing,
        room=req.room,
        n_results=req.n_results,
        max_distance=req.max_distance,
    )

    if "error" in raw:
        raise HTTPException(status_code=500, detail=raw["error"])

    hits = [
        SearchHit(
            text=h["text"],
            wing=h["wing"],
            room=h["room"],
            similarity=h["similarity"],
            distance=h["distance"],
        )
        for h in (raw.get("results") or [])
    ]

    return SearchResponse(
        query=req.query,
        results=hits,
        palace_path=str(palace_path),
        mempalace_available=True,
    )

# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("RAG_PORT", 8787))
    print(f"\n🏛  WALLNUT RAG Sidecar starting on http://localhost:{port}")
    print(f"   Palace path: {PALACE_PATH}")
    print(f"   MemPalace available: {MEMPALACE_AVAILABLE}\n")
    uvicorn.run("rag_server:app", host="127.0.0.1", port=port, reload=True)
