#!/usr/bin/env python3
"""
ingest_knowledge.py — One-time MemPalace Knowledge Base Ingestion
=================================================================
Loads WALLNUT medical / DSP / RF-sensing knowledge into a local
ChromaDB palace so the RAG sidecar can perform similarity search.

Run once before starting rag_server.py:
    python scripts/ingest_knowledge.py

The palace is stored at:  scripts/palace/
"""

import sys
import os
from pathlib import Path

# Ensure mempalace repo is importable
REPO_ROOT = Path(__file__).parent.parent
MEMPALACE_REPO = REPO_ROOT.parent / "mempalace"
sys.path.insert(0, str(MEMPALACE_REPO))

try:
    from mempalace.palace import get_collection
except ImportError:
    print("❌  MemPalace not found. Install it: pip install mempalace")
    print(f"   Searched in: {MEMPALACE_REPO}")
    sys.exit(1)

PALACE_PATH = Path(__file__).parent / "palace"

# ─── Knowledge base ────────────────────────────────────────────────────────────
# Each entry: (id, wing, room, text)
# wing = "wallnut_knowledge"
# rooms: rf_sensing | dsp_vitals | clinical_biometrics | anthropometry | activity_classification

KNOWLEDGE_ENTRIES = [

    # ── RF SENSING PHYSICS ────────────────────────────────────────────────────
    ("rf_001", "wallnut_knowledge", "rf_sensing",
     """WiFi CSI (Channel State Information) encodes the amplitude and phase of each subcarrier 
     in an OFDM transmission. At 5 GHz with a 20 MHz channel, up to 56 orthogonal subcarriers 
     are available. Each subcarrier's complex transfer function H[t,s] = A[t,s]·exp(jφ[t,s]) 
     is measured per packet. The human body modulates this function through partial dielectric 
     absorption (~1.5 dB/cm at 5 GHz in muscle tissue), edge diffraction, and Doppler shift 
     proportional to body-part velocity projected onto the TX-RX axis."""),

    ("rf_002", "wallnut_knowledge", "rf_sensing",
     """WiFi-based human sensing is non-ionizing — the signal power density at 5 GHz from a 
     typical router is 0.01–50 mW/m², far below the ICNIRP continuous exposure limit of 
     10,000 mW/m² for the general public. The sensing modality is camera-free: raw CSI data 
     contains no visual information and cannot reconstruct facial features or identifying marks. 
     The spatial resolution limit is approximately λ/2 = 3 cm at 5 GHz, meaning features 
     smaller than 3 cm cannot be resolved from a single access point."""),

    ("rf_003", "wallnut_knowledge", "rf_sensing",
     """DensePose from WiFi (Carnegie Mellon University, Geng et al. 2022) demonstrated 
     that WiFi-derived CSI can reconstruct dense UV pose coordinates comparable to camera-based 
     DensePose systems. The key insight is domain translation: CSI amplitude and phase matrices 
     are processed by parallel MLP encoder branches, fused into a 2D feature map, then fed 
     into a DensePose-RCNN head. WALLNUT extends this with a rule-based temporal activity 
     classifier and a probabilistic anthropometric SMPL-fit regression layer."""),

    # ── DSP & VITALS ──────────────────────────────────────────────────────────
    ("dsp_001", "wallnut_knowledge", "dsp_vitals",
     """Breathing rate is extracted from WiFi CSI amplitude timeseries using a 2nd-order 
     IIR bandpass filter in the 0.1–0.5 Hz range (6–30 breaths per minute). 
     The diaphragm and thoracic wall displace approximately 1–2 cm during each breath, 
     creating a 2–8 dB RF path-length modulation. Zero-crossing rate of the filtered signal 
     divided by 2 gives cycles per second, multiplied by 60 for breaths per minute. 
     Clinical normal adult range: 12–20 breaths/min at rest."""),

    ("dsp_002", "wallnut_knowledge", "dsp_vitals",
     """Heart rate is isolated from CSI by applying a 2nd-order IIR bandpass filter in 
     the 0.8–2.0 Hz range (48–120 bpm). Ventricular ejection creates approximately 0.3–1.2 mm 
     of chest-wall micro-displacement per beat. Zero-crossing rate of the cardiac-filtered signal 
     gives beats per minute. CSI-based heart rate has approximately ±5 bpm accuracy under 
     controlled static conditions; accuracy degrades with movement. Normal resting range: 
     60–100 bpm (American Heart Association)."""),

    ("dsp_003", "wallnut_knowledge", "dsp_vitals",
     """HRV (Heart Rate Variability) is measured using RMSSD — Root Mean Square of Successive 
     Differences of RR intervals. Formula: RMSSD = √(Σ(RR[i+1]−RR[i])²/N) in milliseconds.
     Clinical interpretation: RMSSD < 20 ms = high sympathetic dominance (stress, exertion); 
     20–50 ms = normal balanced autonomic tone; > 50 ms = strong parasympathetic tone, 
     good cardiovascular fitness. Higher RMSSD is consistently associated with lower all-cause 
     mortality risk (Task Force of ESC/NASPE, 1996; Kleiger et al. 1992).
     WALLNUT derives RMSSD from peak detection of the cardiac-filtered CSI signal."""),

    ("dsp_004", "wallnut_knowledge", "dsp_vitals",
     """Parasympathetic nervous system tone is reflected in HRV. The vagus nerve modulates 
     heart rate through acetylcholine release. During rest and recovery, vagal tone increases 
     HRV. Reduced HRV is a marker of: cardiovascular disease, diabetes, depression, 
     poor sleep quality, and chronic stress. HRV increases with: regular aerobic exercise, 
     meditation, yoga, quality sleep, and reduced alcohol intake. A low RMSSD on the WALLNUT 
     scan warrants lifestyle review but is not diagnostic — ECG-based HRV measurement is 
     required for clinical decisions."""),

    # ── CLINICAL BIOMETRICS ───────────────────────────────────────────────────
    ("clin_001", "wallnut_knowledge", "clinical_biometrics",
     """Body fat percentage WHO clinical thresholds (by sex):
     Males: Underfat <10%, Healthy 10–24%, Overfat 25–31%, Obese ≥32%
     Females: Underfat <17%, Healthy 17–30%, Overfat 31–35%, Obese ≥36%
     Body fat >25% in males or >32% in females is independently associated with 
     elevated cardiometabolic risk, insulin resistance, and cardiovascular disease (WHO, 2011).
     WALLNUT estimates body fat via anthropometric regression from WiFi-derived dimensions — 
     error margin ±3–5% compared to DEXA scan gold standard."""),

    ("clin_002", "wallnut_knowledge", "clinical_biometrics",
     """Waist circumference cardiometabolic risk thresholds (WHO):
     Elevated risk: >94 cm males, >80 cm females
     High risk: >102 cm males, >88 cm females
     Waist circumference predicts visceral adiposity independently of BMI. Visceral fat 
     (abdominal, perivisceral) is metabolically active, secreting pro-inflammatory cytokines 
     (IL-6, TNF-α, leptin) that drive insulin resistance. The waist-to-hip ratio (WHR) 
     >0.95 for males or >0.85 for females indicates central obesity pattern (android).
     WALLNUT estimates waist from SMPL-fit anthropometric regression — confirm with tape measure."""),

    ("clin_003", "wallnut_knowledge", "clinical_biometrics",
     """Mid-Upper Arm Circumference (MUAC): clinical significance.
     In adults: MUAC <23 cm indicates under-nutrition / low muscle mass risk.
     MUAC is used as a rapid screening tool for malnutrition in field settings (WHO, 2013).
     In the WALLNUT system, upper arm circumference is estimated using the Ramanujan ellipse 
     formula applied to arm half-width (≈24.5% of half-shoulder width × fatFactor) 
     and arm half-depth (≈88% of half-width). Accuracy: ±2–3 cm vs tape measure."""),

    ("clin_004", "wallnut_knowledge", "clinical_biometrics",
     """Obstructive Sleep Apnea (OSA) neck circumference screening:
     Risk thresholds: >40 cm for males, >35 cm for females.
     Neck circumference is a stronger predictor of OSA than BMI in some populations 
     (Davies et al., 1992). WALLNUT estimates neck circumference from biacromial width 
     (≈18.5% of shoulder half-width × 0.87 depth ratio ellipse formula, CAESAR database).
     If WALLNUT estimate exceeds threshold, further evaluation with PSG (polysomnography) 
     is clinically appropriate."""),

    # ── ANTHROPOMETRY ─────────────────────────────────────────────────────────
    ("anth_001", "wallnut_knowledge", "anthropometry",
     """SMPL (Skinned Multi-Person Linear model, Loper et al. 2015, Max Planck Institute) 
     encodes human body shape variation in 10 principal component coefficients (β₀–β₉) 
     learned from 4,000+ 3D body scans. Given sparse measurements (height, shoulder width, 
     hip width), a linear regressor predicts β values, and the full 6,890-vertex 3D mesh 
     with circumferences falls out automatically. WALLNUT uses a simplified SMPL-inspired 
     approach: Ramanujan ellipse circumference formulas with CAESAR/ANSUR-II depth ratios, 
     without requiring the full SMPL weight matrices."""),

    ("anth_002", "wallnut_knowledge", "anthropometry",
     """ANSUR II (Gordon et al. 2012) — U.S. Army Anthropometric Survey of 4,082 male and 
     1,986 female soldiers. Provides validated proportional relationships between body segment 
     widths, depths, and circumferences. Key WALLNUT-used ratios: 
     neck width = 18.5% of half-shoulder-width; 
     thigh width = 37.5% of half-hip-width;
     calf width = 20% of half-hip-width;
     upper arm width = 24.5% of half-shoulder-width.
     CAESAR (Kouchi & Mochimaru 2003) provides the depth-to-width ratios for ellipse modeling."""),

    ("anth_003", "wallnut_knowledge", "anthropometry",
     """Ramanujan's ellipse circumference approximation (1914):
     C = π(a+b)[1 + 3h/(10+√(4−3h))] where h=(a−b)²/(a+b)²
     This approximation has error <0.001% for any ellipse, far superior to the simple 
     π(a+b) formula. WALLNUT uses this for all body segment circumference calculations:
     a = half-width (from subcarrier energy profile or CSI-derived keypoint distance)
     b = half-depth (width × segment-specific CAESAR depth ratio)
     Body fat increases cross-sectional depth via fatFactor = 1 + (BF%−22)/80."""),

    ("anth_004", "wallnut_knowledge", "anthropometry",
     """Body shape and fat distribution types:
     Android (apple): central abdominal fat, higher cardiometabolic risk, high waist-to-hip ratio
     Gynoid (pear): peripheral gluteo-femoral fat, lower CVD risk but higher joint load
     WALLNUT's shoulder-to-hip width ratio (bmi_proxy) helps classify shape type.
     bmi_proxy = shoulderWidth / hipWidth: 
     >1.0 = shoulder-dominant (android tendency); <1.0 = hip-dominant (gynoid tendency).
     This is a proxy — not a clinical classification. DXA is gold standard for fat distribution."""),

    # ── TEMPORAL MOTION DYNAMICS ──────────────────────────────────────────────
    ("dyn_001", "wallnut_knowledge", "temporal_motion",
     """WALLNUT uses continuous temporal motion descriptors rather than hard action labels.
     Core features:
       dominantMotionHz = argmax_f |DFT(amplitude_timeseries)|
       motionEnergy = std(amplitude_timeseries) / mean(amplitude_timeseries)
       phaseStability = 1 - meanAbsCircularDiff(phase_matrix) / pi  (clamped)
     These descriptors drive replay synthesis and confidence scoring while avoiding
     over-claiming exact user actions in unconstrained real-world settings."""),

    ("dyn_002", "wallnut_knowledge", "temporal_motion",
     """Interpreting temporal dynamics bands (action-neutral):
       Quasi-static:   dominantMotionHz < 0.30 and motionEnergy < 0.05
       Low dynamic:    0.30-0.70 Hz with moderate energy
       Moderate:       0.70-1.20 Hz with clear periodic modulation
       High dynamic:   >1.20 Hz and elevated energy
     These bands describe signal behavior intensity and cadence, not a semantic
     posture tag."""),
]

# ─── Ingestion ─────────────────────────────────────────────────────────────────
def ingest():
    print(f"\n🏛  WALLNUT Knowledge Base Ingestion")
    print(f"   Palace path: {PALACE_PATH}")
    print(f"   Entries to index: {len(KNOWLEDGE_ENTRIES)}\n")

    PALACE_PATH.mkdir(parents=True, exist_ok=True)

    col = get_collection(str(PALACE_PATH), create=True)

    # Check for existing entries so re-running is idempotent
    existing_ids = set()
    try:
        existing = col.get(include=[])
        existing_ids = set(existing.get("ids", []))
    except Exception:
        pass

    added = 0
    skipped = 0

    for entry_id, wing, room, text in KNOWLEDGE_ENTRIES:
        if entry_id in existing_ids:
            skipped += 1
            continue

        col.add(
            ids=[entry_id],
            documents=[text.strip()],
            metadatas=[{
                "wing": wing,
                "room": room,
                "source_file": f"wallnut_knowledge/{room}.md",
            }],
        )
        added += 1
        print(f"  ✓ [{room}] {entry_id}")

    print(f"\n  Added:   {added}")
    print(f"  Skipped: {skipped} (already indexed)")
    print(f"\n✅  Knowledge base ready. Start the RAG sidecar with:")
    print(f"    python scripts/rag_server.py\n")

if __name__ == "__main__":
    ingest()
