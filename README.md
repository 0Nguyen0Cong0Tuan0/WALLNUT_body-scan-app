# WALLNUT Body Scan Platform

**WALLNUT** (<ins>W</ins>iFi-enabled <ins>A</ins>daptive <ins>LL</ins>-body <ins>N</ins>ode <ins>U</ins>nified <ins>T</ins>elemetry) is a dual-pipeline, privacy-first body composition and vitals screening platform built on **Next.js 15** with **TypeScript** and **TailwindCSS**. 

It extracts precise biometric structures through sophisticated mechanisms and anchors all medical guidance to locally-hosted, verified clinical literature using an integrated AI researcher.

## Core Features & Architecture

### 1. RF Multipath Pipeline (CSI)
Decodes Orthogonal Frequency Division Multiplexing (OFDM) Channel State Information (CSI) from 5GHz ESP32-S3 IoT sensors:
- **Biometric DSP**: IIR Butterworth Bandpass Filters extract human breathing rates (0.1–0.5 Hz) and ballistic cardiac perturbations (0.8–2.0 Hz).
- **Ramanujan Body Modeling**: Generates 8 anatomical circumferences by mapping physical WiFi signal blockages onto an SMPL reference topology.

### 2. Multimodal AI Pipeline (Qwen-VL-Max)
Evaluates client-side 2D silhouettes coupled with RF Data to determine specific body fat compositions, falling back gracefully to univariate Deurenberg algorithmic calculations when AI inference is limited.

### 3. Medical RAG System (MemPalace)
The integrated Chatbot does not hallucinate medical facts. All questions concerning health, baselines, and safety ranges are grounded against a strictly maintained local vector database powered by **MemPalace**.
- **Vector Embeddings Localized**: Source content lives verbatim inside a Python-based physical database located at `knowledge_base/`.
- **RAG Interception**: The Next.js API intercepts Qwen context requests and bridges dynamically into the MemPalace subsystem via child processes.

### 4. Autonomous PubMed Research Agent
If a user queries for biometric relationships that *do not* exist in the MemPalace database, the system will **safely refuse** to answer and intelligently trigger a background AI Agent.
- **NCBI E-Utilities**: Programmatically hits PubMed to locate the latest peer-reviewed (*Clinical Trials, Meta-Analyses*) literature.
- **LLM Medical Gate**: Sifts out irrelevant data, synthesizes correct constraints, writes `.md` files to your disk, and completely re-indexes your dataset on the fly. 

## Technology Stack
- **Framework**: Next.js 15 App Router | Node.js (v20+)
- **LLM Models**: DashScope Qwen (`qwen-vl-max`, `qwen-plus`)
- **Agents/Vector DB**: Python 3.9+, MemPalace local embeddings natively bridging to TypeScript
- **Graphics**: WebGL / Three.js / React Three Fiber

---

## Running the Application 🚀

### 1. System Pre-Requisites (Local Development)
- **Node.js**: `v20+`
- **Python**: `3.9+` (Crucial for MemPalace functionality)

### 2. Initial Setup
Clone the repository and inject your API configurations:
```bash
# Create environment configurations
cp .env.example .env.local

# Add your Alibaba Cloud DashScope Key inside .env.local:
QWEN_API_KEY="your-qwen-api-key-here"
```

### 3. Initialize The AI Agent & Python Backend 
The application relies on Python for the `mempalace` agent and mock offline data traces.
```bash
npm install

# Initialize Python Virtual Environment
python -m venv .venv

# Activate Virtual Environment (Windows PowerShell)
.\.venv\Scripts\Activate.ps1
# Activate Virtual Environment (Mac/Linux)
source .venv/bin/activate

# Install the Database backend
pip install mempalace

# "Mine" your starting medical domain knowledge explicitly
mempalace mine .\knowledge_base
```

### 4. Start the Application
Run the Next.js edge-compilation development server. Exactly 10 seconds post-boot, the system triggers the native Autonomous Cron job to verify your agent works safely.
```bash
npm run dev
```
Navigate to `http://localhost:3000`.

---

## Production Deployment (Docker)

To deploy directly to the cloud without dealing with Python OS idiosyncrasies, use our built-in `Dockerfile` which perfectly configures a unified `node:22-slim` container carrying both Python 3 embedded capabilities and your Next.js standalone build.

```bash
docker build -t body-scan-app .
docker run -p 3000:3000 --env-file .env.local body-scan-app
```

## Mock Signal Generation

Lack live ESP32-S3 IoT transceivers? Generate synthetic CSI blockages natively:
```bash
# Execute local test generator
python test_data/signal/generate_signals.py
```
Upload the generated `.jsonl` inside the application to spoof a live WiFi capture.

---

> **Disclaimer**: This analysis tool functions as a non-ionizing wellness proxy, not a certified clinical diagnostic. Findings trace foundational lineage to CMU's *DensePose From WiFi (arXiv:2301.00250).*
