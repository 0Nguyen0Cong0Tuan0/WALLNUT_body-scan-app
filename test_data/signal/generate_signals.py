#!/usr/bin/env python3
"""
Signal Dataset Generator for Body Scan Testing
================================================
Uses RuView's built-in simulation tools to generate realistic CSI signal
files in both supported formats:
  - .csi.jsonl   (ESP32 live recording format, from record-csi-udp.py)
  - .json        (RuView proof-bundle format, sample_csi_data.json style)

Usage:
    python generate_signals.py
    python generate_signals.py --scenarios all
    python generate_signals.py --scenario standing --duration 30 --rate 100

Output:
    test_data/signal/
        standing_30s_100hz.csi.jsonl
        walking_30s_100hz.csi.jsonl
        sitting_30s_100hz.csi.jsonl
        fallen_10s_100hz.csi.jsonl
        obese_profile_30s.csi.jsonl
        slim_profile_30s.csi.jsonl
        proof_bundle_breathing_only.json
        proof_bundle_walking_combined.json
"""

import sys
import os
import json
import math
import time
import struct
import argparse
import random
from datetime import datetime, timedelta
from pathlib import Path

# ─── Add RuView to path ───────────────────────────────────────────────────────
REPO_ROOT = Path(__file__).parent.parent.parent / "RuView"
sys.path.insert(0, str(REPO_ROOT))

# ─── Output directory ─────────────────────────────────────────────────────────
OUTPUT_DIR = Path(__file__).parent  # test_data/signal/


# ─── Scenario Definitions ─────────────────────────────────────────────────────

SCENARIOS = {
    # activity: (amplitude_mean, amplitude_std, movement_freq_hz, noise_level)
    "standing":   {"amp_mean": 0.50, "amp_std": 0.08, "move_hz": 0.3,  "noise": 0.08, "rssi": -62, "desc": "Person standing still, breathing normally"},
    "walking":    {"amp_mean": 0.60, "amp_std": 0.15, "move_hz": 1.2,  "noise": 0.15, "rssi": -58, "desc": "Person walking across the room"},
    "sitting":    {"amp_mean": 0.40, "amp_std": 0.06, "move_hz": 0.25, "noise": 0.05, "rssi": -67, "desc": "Person seated, minimal motion"},
    "fallen":     {"amp_mean": 0.35, "amp_std": 0.04, "move_hz": 0.15, "noise": 0.03, "rssi": -70, "desc": "Person lying on floor (fall detection)"},
    # Body-composition profiles — simulate different body types by amplitude bias
    "obese_profile":  {"amp_mean": 0.72, "amp_std": 0.12, "move_hz": 0.28, "noise": 0.10, "rssi": -55, "desc": "Heavier body frame — wider RF cross-section"},
    "slim_profile":   {"amp_mean": 0.38, "amp_std": 0.07, "move_hz": 0.32, "noise": 0.06, "rssi": -68, "desc": "Slimmer body frame — narrower RF cross-section"},
    "athlete_profile":{"amp_mean": 0.55, "amp_std": 0.09, "move_hz": 0.35, "noise": 0.07, "rssi": -60, "desc": "Athletic build — dense muscle mass signature"},
}

# ─── Helpers ──────────────────────────────────────────────────────────────────

def generate_iq_pair(amplitude: float) -> tuple[int, int]:
    """Simulate IQ pair from amplitude value (range 0-1 mapped to ±127)."""
    angle = random.uniform(0, 2 * math.pi)
    scale = amplitude * 60
    I = int(scale * math.cos(angle))
    Q = int(scale * math.sin(angle))
    return max(-127, min(127, I)), max(-127, min(127, Q))


def iq_to_hex(amplitudes: list[float]) -> str:
    """Encode simulated IQ bytes as hex string (matches ESP32 packet format)."""
    raw = bytearray()
    for amp in amplitudes:
        I, Q = generate_iq_pair(amp)
        raw.append(I & 0xFF)
        raw.append(Q & 0xFF)
    return raw.hex()


# ─── Format A: .csi.jsonl (record-csi-udp.py format) ─────────────────────────

def generate_jsonl_frame(
    t: float,
    ts_start_ns: int,
    scenario: dict,
    node_id: int = 1,
    channel: int = 11,
    num_subcarriers: int = 56,
    frame_idx: int = 0,
) -> dict:
    """Generate one ESP32-style CSI frame in ADR-018 / record-csi-udp format."""
    t_offset_ns = int(t * 1e9)
    ts_ns = ts_start_ns + t_offset_ns

    # Temporal coherence: base amplitude with movement modulation
    breathing_mod = scenario["amp_std"] * math.sin(2 * math.pi * scenario["move_hz"] * t)
    base_amp = scenario["amp_mean"] + breathing_mod

    amplitudes = []
    for k in range(num_subcarriers):
        # Subcarrier-specific variation (frequency-selective fading)
        freq_factor = 1 + 0.1 * math.sin(2 * math.pi * k / num_subcarriers)
        noise = random.gauss(0, scenario["noise"])
        amp = max(0.0, min(1.0, base_amp * freq_factor + noise))
        amplitudes.append(round(amp * 100, 2))  # Scale to 0-100 like real ESP32

    ts_str = datetime.utcnow().replace(microsecond=0).isoformat() + \
             f".{frame_idx % 1000:03d}Z"

    return {
        "type": "raw_csi",
        "timestamp": ts_str,
        "ts_ns": ts_ns,
        "node_id": node_id,
        "rssi": scenario["rssi"] + random.randint(-3, 3),
        "channel": channel,
        "subcarriers": num_subcarriers,
        "amplitudes": amplitudes,
        "iq_hex": iq_to_hex([a / 100 for a in amplitudes[:20]]),  # First 20 subcarriers
        "scenario": list(SCENARIOS.keys())[[v for v in SCENARIOS.values()].index(scenario)] if scenario in SCENARIOS.values() else "custom",
    }


def generate_jsonl_file(
    scenario_name: str,
    duration_s: float = 30.0,
    sample_rate_hz: float = 100.0,
    num_subcarriers: int = 56,
    node_id: int = 1,
) -> Path:
    """Generate a complete .csi.jsonl recording file for a given scenario."""
    scenario = SCENARIOS[scenario_name]
    ts_start_ns = int(time.time() * 1e9)
    num_frames = int(duration_s * sample_rate_hz)

    filename = f"{scenario_name}_{int(duration_s)}s_{int(sample_rate_hz)}hz.csi.jsonl"
    filepath = OUTPUT_DIR / filename

    print(f"  Generating {filename} ({num_frames} frames)...")

    with open(filepath, "w") as f:
        for i in range(num_frames):
            t = i / sample_rate_hz
            frame = generate_jsonl_frame(
                t=t,
                ts_start_ns=ts_start_ns,
                scenario=scenario,
                node_id=node_id,
                num_subcarriers=num_subcarriers,
                frame_idx=i,
            )
            f.write(json.dumps(frame) + "\n")

    size_kb = filepath.stat().st_size / 1024
    print(f"  [OK]  {filename} - {num_frames} frames, {size_kb:.1f} KB")
    return filepath


# ─── Format B: .json proof-bundle (sample_csi_data.json format) ──────────────

def generate_proof_bundle(
    scenario_name: str,
    breathing_hz: float = 0.3,
    walking_hz: float = 1.2,
    duration_s: float = 10.0,
    sample_rate_hz: float = 100.0,
    num_antennas: int = 3,
    num_subcarriers: int = 56,
    seed: int = 42,
) -> Path:
    """
    Generate a deterministic physics-based CSI proof bundle.
    Mirrors the generation formula from RuView/v1/data/proof/generate_reference_signal.py:

      CSI[a,k,t] = sum_paths { A_p * exp(j*(2pi*f_k*tau_p + phi_p,a))
                    * (1 + d_breathe * sin(2pi*breathe_hz*t + psi_a))
                    * (1 + d_walk * sin(2pi*walk_hz*t + psi_a)) }
    """
    rng = __import__("numpy").random.RandomState(seed)

    scenario = SCENARIOS.get(scenario_name, SCENARIOS["standing"])
    center_freq = 5.21e9
    subcarrier_spacing = 312.5e3

    # Multipath parameters (3 paths)
    path_delays_ns = rng.uniform(0, 100, size=3)
    path_amplitudes = sorted(rng.uniform(0.2, 1.0, size=3), reverse=True)
    path_phase_offsets = rng.uniform(-3.14, 3.14, size=(3, num_antennas))
    breathing_phases = rng.uniform(0, 2 * 3.14, size=num_antennas)
    walking_phases = rng.uniform(0, 2 * 3.14, size=num_antennas)

    import numpy as np

    k_indices = np.arange(num_subcarriers) - num_subcarriers // 2
    subcarrier_freqs = center_freq + k_indices * subcarrier_spacing
    path_delays_s = path_delays_ns * 1e-9
    num_frames = int(duration_s * sample_rate_hz)

    frames = []
    for fi in range(num_frames):
        t = fi / sample_rate_hz
        csi = np.zeros((num_antennas, num_subcarriers), dtype=complex)

        for a in range(num_antennas):
            breathe_mod = 1.0 + scenario["amp_std"] * np.sin(2 * np.pi * breathing_hz * t + breathing_phases[a])
            walk_mod = 1.0 + (scenario["amp_std"] * 0.5) * np.sin(2 * np.pi * walking_hz * t + walking_phases[a])
            motion = breathe_mod * walk_mod

            for p in range(3):
                phase = 2 * np.pi * subcarrier_freqs * path_delays_s[p] + path_phase_offsets[p, a]
                csi[a] += path_amplitudes[p] * motion * np.exp(1j * phase)

        amplitude = np.abs(csi).tolist()
        phase = np.angle(csi).tolist()

        frames.append({
            "frame_index": fi,
            "timestamp_s": round(t, 4),
            "amplitude": amplitude,
            "phase": phase,
        })

    label = "breathing_only" if walking_hz < 0.5 else f"{scenario_name}_combined"
    filename = f"proof_bundle_{label}_{int(duration_s)}s.json"
    filepath = OUTPUT_DIR / filename

    output = {
        "description": f"Synthetic deterministic CSI proof bundle — scenario: {scenario_name}. {scenario['desc']}",
        "generator": "test_data/signal/generate_signals.py",
        "is_synthetic": True,
        "is_real_capture": False,
        "numpy_seed": seed,
        "scenario": scenario_name,
        "num_frames": num_frames,
        "num_antennas": num_antennas,
        "num_subcarriers": num_subcarriers,
        "sampling_rate_hz": sample_rate_hz,
        "breathing_hz": breathing_hz,
        "walking_hz": walking_hz,
        "frames": frames,
    }

    print(f"  Generating {filename} ({num_frames} frames, proof-bundle format)...")
    with open(filepath, "w") as f:
        json.dump(output, f, indent=2)

    size_kb = filepath.stat().st_size / 1024
    print(f"  [OK]  {filename} - {num_frames} frames, {size_kb:.1f} KB")
    return filepath


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Generate simulated CSI signal datasets using RuView simulation tools."
    )
    parser.add_argument("--scenario", default="all",
        help=f"Scenario name or 'all'. Options: {', '.join(SCENARIOS.keys())}")
    parser.add_argument("--duration", type=float, default=30.0,
        help="Duration in seconds (default: 30)")
    parser.add_argument("--rate", type=float, default=100.0,
        help="Sample rate in Hz (default: 100)")
    parser.add_argument("--subcarriers", type=int, default=56,
        help="Number of subcarriers (default: 56, matches ESP32-S3)")
    args = parser.parse_args()

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print("=" * 65)
    print("  Body Scan — CSI Signal Dataset Generator")
    print("  Uses RuView simulation tools (ADR-018/ADR-079 formats)")
    print(f"  Output: {OUTPUT_DIR.resolve()}")
    print("=" * 65)

    scenarios_to_run = (
        list(SCENARIOS.keys()) if args.scenario == "all" else [args.scenario]
    )

    print(f"\n[1/2] Generating .csi.jsonl files (ESP32 recording format)...")
    for sc in scenarios_to_run:
        if sc not in SCENARIOS:
            print(f"  ⚠  Unknown scenario: {sc}. Skipping.")
            continue
        generate_jsonl_file(
            scenario_name=sc,
            duration_s=args.duration,
            sample_rate_hz=args.rate,
            num_subcarriers=args.subcarriers,
        )

    print(f"\n[2/2] Generating .json proof-bundle files (physics-based reference)...")
    generate_proof_bundle("standing",  breathing_hz=0.3,  walking_hz=0.1,  duration_s=10, seed=42)
    generate_proof_bundle("walking",   breathing_hz=0.3,  walking_hz=1.2,  duration_s=10, seed=43)
    generate_proof_bundle("obese_profile",  breathing_hz=0.25, walking_hz=0.05, duration_s=10, seed=44)
    generate_proof_bundle("slim_profile",   breathing_hz=0.33, walking_hz=0.1,  duration_s=10, seed=45)

    generated = list(OUTPUT_DIR.glob("*.jsonl")) + list(OUTPUT_DIR.glob("*.json"))
    print(f"\n✅  Done. {len(generated)} files in {OUTPUT_DIR.resolve()}")
    print("\nFiles generated:")
    for f in sorted(generated):
        print(f"  {f.name}  ({f.stat().st_size/1024:.1f} KB)")

    print("\n💡  Upload any of these files in the Body Scan web app:")
    print("    http://localhost:3000  →  Upload CSI File tab")
    print("=" * 65)


if __name__ == "__main__":
    main()
