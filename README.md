# WALLNUT Body Scan Platform

**WALLNUT** (<ins>W</ins>iFi-enabled <ins>A</ins>daptive <ins>LL</ins>-body <ins>N</ins>ode <ins>U</ins>nified <ins>T</ins>elemetry) is a dual-pipeline, privacy-first body composition and vitals screening platform built on **Next.js 16** with **TypeScript** and **TailwindCSS**. 

It is capable of extracting precise biometric structures through two sophisticated mechanisms:
1. **At-Rest WiFi CSI Sensing**: Decodes Orthogonal Frequency Division Multiplexing (OFDM) Channel State Information (CSI) from 5GHz ESP32-S3 IoT sensors to deduce mechanical respiration rates, cardiac pulse (ballistocardiography), subcarrier energy region mapping (SMPL pose fitting), and Ramanujan anthropometric constraints.
2. **Vision-Language Artificial Intelligence**: Evaluates user-submitted 2D silhouettes using the **Qwen-VL-Max** multimodal network alongside body height/weight to synthesize body fat composition matrices (with Deurenberg BMI algorithmic fallbacks).

## Dual-Pipeline Core Architecture

### 1. RF Multipath Pipeline (CSI)
- **Input Methods**: Passive hardware continuous UDP streams (802.11ac packets), simulated offline proof-bundles, or recorded `.jsonl` trace buffers.
- **Biometric Digital Signal Processing (DSP)**: Mean-centered subcarriers routed into 2nd-Order **IIR Butterworth Bandpass Filters**—extracting human breathing rates (0.1–0.5 Hz) and ballistic cardiac mechanical perturbations (0.8–2.0 Hz) using zero-crossing calculations. 
- **Time/Frequency Kinematics**: Sliding-window Discrete Fourier Transform (DFT) calculates phase stability and signal confidence margins.
- **Ramanujan Body Modeling**: Generates 8 anatomical circumferences by estimating cross-sections of the torso, limbs, and trunk from dense keypoints mapped mathematically onto an SMPL reference topology.

### 2. Vision-Language Multimodal Pipeline (Image AI)
- **Input Methods**: Client-side drag-and-drop ingestion of Standard 2D Image files (`.jpeg`, `.png`, `.webp`) plus Height and Weight properties mapped onto multipart boundary streams.
- **AI Body Composition Estimation**: Visual matrices coupled directly to the `Qwen-VL-Max` DashScope inference endpoint. Uses generative vision to calculate fat distribution arrays visually mapped along human contours.
- **Deurenberg Fallback Mechanism**: If the DashScope API rate limits are exceeded, inference seamlessly resorts to deterministic univariate approximations utilizing BMI scalar rules extrapolated using non-gender deterministic modifiers.

## Technology Stack

- **Framework**: [Next.js](https://nextjs.org/) 16 with App Router and Turbopack.
- **Models**: [Qwen Multimodal](https://dashscope.aliyun.com/) APIs (`qwen-vl-max`, `qwen-plus`).
- **3D Engine**: WebGL with [Three.js](https://threejs.org/) + React Three Fiber (`@react-three/fiber`) used to visualize the real-time SMPL spatial topologies.
- **Compute Storage**: Stateless design. Client-local state caches are persisted internally via browser `localStorage`. 

---

## Running the Application 🚀

### 1. System Requirements
- Node.js `^v20`
- Python `>3.9` (Only required if you are generating synthetic CSI mock files using the `test_data` module). **No `pip` dependencies are required; it uses strict standard libraries.**

### 2. Environment Configuration
Create a `.env.local` file in the root context containing your API telemetry keys:
```bash
# Model Inference key for AI clinical narration and Vision tracking
DASHSCOPE_API_KEY="your-qwen-api-key-here"

# (Optional) Developer routing configurations
LIVE_CSI_UDP_PORT="8080"
```

### 3. Build & Run Node Service
Start the project locally utilizing NPM configurations.
```bash
npm install
npm run dev
```
Navigate to `http://localhost:3000` to begin interacting. 

---

## Mock Signal Generation (Testing without Physical Hardware)

If you lack live ESP32-S3 IoT transceivers to stream physical WiFi OFDM responses, you can rapidly test the logic gates via the included deterministic signal simulator script:

```bash
# Execute local test generator
python test_data/signal/generate_signals.py

# Optional: Generate a massive 30-minute block for long-range tests
python test_data/signal/generate_signals.py --duration 1800
```
This utility mathematically replicates the physics of human cardiopulmonary modulation to generate dense `profile_balanced_baseline.csi.jsonl` traces, allowing seamless debugging inside the application's "File Upload" view.

---

## Clinical Safety & Academic Lineage 
WALLNUT acts strictly as a **non-ionizing wellness analytics proxy**. WiFi router signals naturally operate roughly ~50,000x beneath standard ICNIRP threshold emissions for environmental safety. 

Because estimations hinge on the mathematical physics of `Ramanujan cross-sectional volume estimates` and derived `Deurenberg` logic, findings do *not* legally constitute medical diagnostic truth boundaries. The methodologies within this application trace foundational lineage to CMU robotics institute's *DensePose From WiFi (arXiv:2301.00250)* logic structures.
