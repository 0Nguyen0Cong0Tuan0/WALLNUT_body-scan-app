#!/usr/bin/env python3
"""
Action-neutral CSI fixture generator for WALLNUT Body Scan.

This script replaces legacy action-labeled fixtures with
profile-based synthetic data that better matches the current project direction:
continuous motion dynamics + morphology variation (no hard action labels).

Reference lineage:
1. RuView scripts/record-csi-udp.py      -> JSONL frame contract (`type: raw_csi`)
2. RuView v1/data/proof/generate_reference_signal.py
   -> deterministic multipath + modulation synthesis approach

Generated outputs (examples):
- profile_balanced_baseline_30s_100hz.csi.jsonl
- profile_broad_torso_30s_100hz.csi.jsonl
- proof_bundle_balanced_baseline_10s.json
"""

from __future__ import annotations

import argparse
import json
import math
import random
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, List

OUTPUT_DIR = Path(__file__).parent

CENTER_FREQ_HZ = 5.21e9
SUBCARRIER_SPACING_HZ = 312_500.0
DEFAULT_CHANNEL = 11
DEFAULT_SUBCARRIERS = 56
DEFAULT_PROOF_ANTENNAS = 3
DEFAULT_JSONL_NODE_BASE = 11


@dataclass(frozen=True)
class ProfileSpec:
    name: str
    description: str
    # Zone gains map to subcarrier slices used by csiProcessor estimatePoseFromCSI:
    # head, shoulders, torso, hips, thighs, calves
    zone_gains: tuple[float, float, float, float, float, float]
    breathing_hz: float
    heart_hz: float
    motion_hz: float
    breathing_depth: float
    cardiac_depth: float
    motion_depth: float
    noise_sigma: float
    rssi_base: int


@dataclass(frozen=True)
class MultipathParams:
    path_delays_ns: tuple[float, ...]
    path_amplitudes: tuple[float, ...]
    path_phase_offsets: tuple[tuple[float, ...], ...]  # [path][antenna]
    breathing_phase_offsets: tuple[float, ...]
    heart_phase_offsets: tuple[float, ...]
    motion_phase_offsets: tuple[float, ...]
    rssi_phase: float


PROFILES: dict[str, ProfileSpec] = {
    "balanced_baseline": ProfileSpec(
        name="balanced_baseline",
        description="Balanced morphology with moderate micro-motion dynamics.",
        zone_gains=(0.95, 1.04, 1.00, 1.00, 0.97, 0.94),
        breathing_hz=0.24,
        heart_hz=1.12,
        motion_hz=0.42,
        breathing_depth=0.085,
        cardiac_depth=0.030,
        motion_depth=0.030,
        noise_sigma=0.020,
        rssi_base=-62,
    ),
    "calm_recovery": ProfileSpec(
        name="calm_recovery",
        description="Low-motion profile with stronger respiratory dominance.",
        zone_gains=(0.98, 1.00, 1.01, 0.99, 0.95, 0.93),
        breathing_hz=0.21,
        heart_hz=1.00,
        motion_hz=0.24,
        breathing_depth=0.095,
        cardiac_depth=0.028,
        motion_depth=0.016,
        noise_sigma=0.016,
        rssi_base=-64,
    ),
    "dynamic_variability": ProfileSpec(
        name="dynamic_variability",
        description="Higher movement cadence and channel perturbation.",
        zone_gains=(0.92, 1.06, 1.02, 1.00, 1.01, 0.96),
        breathing_hz=0.28,
        heart_hz=1.34,
        motion_hz=0.96,
        breathing_depth=0.072,
        cardiac_depth=0.038,
        motion_depth=0.074,
        noise_sigma=0.028,
        rssi_base=-59,
    ),
    "broad_torso": ProfileSpec(
        name="broad_torso",
        description="Broader upper-body morphology with stable cadence.",
        zone_gains=(0.90, 1.20, 1.12, 1.06, 0.94, 0.90),
        breathing_hz=0.23,
        heart_hz=1.08,
        motion_hz=0.38,
        breathing_depth=0.082,
        cardiac_depth=0.029,
        motion_depth=0.026,
        noise_sigma=0.020,
        rssi_base=-60,
    ),
    "compact_frame": ProfileSpec(
        name="compact_frame",
        description="Narrower frame with lower torso/hip energy spread.",
        zone_gains=(1.02, 0.86, 0.90, 0.88, 0.95, 1.00),
        breathing_hz=0.26,
        heart_hz=1.18,
        motion_hz=0.34,
        breathing_depth=0.086,
        cardiac_depth=0.033,
        motion_depth=0.024,
        noise_sigma=0.019,
        rssi_base=-66,
    ),
}


def clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def round_float(value: float, digits: int = 6) -> float:
    factor = 10 ** digits
    return math.floor(value * factor + 0.5) / factor


def iso_timestamp_from_ns(ts_ns: int) -> str:
    dt = datetime.fromtimestamp(ts_ns / 1e9, tz=timezone.utc)
    return dt.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def gaussian_zone(x: float, center: float, width: float) -> float:
    return math.exp(-((x - center) ** 2) / (2.0 * width * width))


def morphology_gain(zone_gains: tuple[float, float, float, float, float, float], sub_norm: float) -> float:
    zones = (
        (0.05, 0.08, zone_gains[0]),  # head
        (0.18, 0.11, zone_gains[1]),  # shoulders
        (0.38, 0.15, zone_gains[2]),  # torso
        (0.58, 0.13, zone_gains[3]),  # hips
        (0.73, 0.11, zone_gains[4]),  # thighs
        (0.90, 0.09, zone_gains[5]),  # calves
    )

    weighted = 0.0
    base = 0.0
    for center, width, gain in zones:
        kernel = gaussian_zone(sub_norm, center, width)
        weighted += kernel * gain
        base += kernel

    return weighted / max(base, 1e-6)


def build_multipath(seed: int, num_paths: int, num_antennas: int) -> MultipathParams:
    rng = random.Random(seed)

    base_delays = [0.0, 15.0, 42.0, 78.0, 120.0, 165.0]
    base_amps = [1.00, 0.62, 0.38, 0.21, 0.11, 0.06]

    delays = tuple(base_delays[i] + rng.uniform(-2.0, 2.0) for i in range(num_paths))
    amps = tuple(base_amps[i] * rng.uniform(0.92, 1.08) for i in range(num_paths))

    phase_offsets: list[tuple[float, ...]] = []
    for _ in range(num_paths):
        phase_offsets.append(tuple(rng.uniform(-math.pi, math.pi) for _ in range(num_antennas)))

    breathing_phase = tuple(rng.uniform(0, 2 * math.pi) for _ in range(num_antennas))
    heart_phase = tuple(rng.uniform(0, 2 * math.pi) for _ in range(num_antennas))
    motion_phase = tuple(rng.uniform(0, 2 * math.pi) for _ in range(num_antennas))
    rssi_phase = rng.uniform(0, 2 * math.pi)

    return MultipathParams(
        path_delays_ns=delays,
        path_amplitudes=amps,
        path_phase_offsets=tuple(phase_offsets),
        breathing_phase_offsets=breathing_phase,
        heart_phase_offsets=heart_phase,
        motion_phase_offsets=motion_phase,
        rssi_phase=rssi_phase,
    )


def build_frame(
    profile: ProfileSpec,
    params: MultipathParams,
    rng: random.Random,
    t: float,
    num_antennas: int,
    num_subcarriers: int,
) -> tuple[list[list[float]], list[list[float]]]:
    k_indices = [k - num_subcarriers // 2 for k in range(num_subcarriers)]
    subcarrier_freqs = [CENTER_FREQ_HZ + k * SUBCARRIER_SPACING_HZ for k in k_indices]

    amplitude_matrix: list[list[float]] = []
    phase_matrix: list[list[float]] = []

    for antenna_idx in range(num_antennas):
        breath = 1.0 + profile.breathing_depth * math.sin(
            2 * math.pi * profile.breathing_hz * t + params.breathing_phase_offsets[antenna_idx]
        )
        heart = 1.0 + profile.cardiac_depth * math.sin(
            2 * math.pi * profile.heart_hz * t + params.heart_phase_offsets[antenna_idx]
        )
        motion = 1.0 + profile.motion_depth * math.sin(
            2 * math.pi * profile.motion_hz * t + params.motion_phase_offsets[antenna_idx]
        )
        drift = 1.0 + 0.028 * math.sin(2 * math.pi * 0.045 * t + antenna_idx * 0.7)
        temporal_mod = breath * heart * motion * drift

        amp_row: list[float] = []
        phase_row: list[float] = []

        for sub_idx, freq in enumerate(subcarrier_freqs):
            sub_norm = sub_idx / max(1, num_subcarriers - 1)
            morph = morphology_gain(profile.zone_gains, sub_norm)

            re = 0.0
            im = 0.0
            for path_idx, path_amp in enumerate(params.path_amplitudes):
                tau_s = params.path_delays_ns[path_idx] * 1e-9
                phase = 2 * math.pi * freq * tau_s + params.path_phase_offsets[path_idx][antenna_idx]
                ripple = 1.0 + 0.025 * math.sin(2 * math.pi * (0.14 * sub_idx + 0.12 * t + path_idx * 0.3))
                gain = path_amp * morph * temporal_mod * ripple
                re += gain * math.cos(phase)
                im += gain * math.sin(phase)

            re += rng.gauss(0.0, profile.noise_sigma)
            im += rng.gauss(0.0, profile.noise_sigma)

            amp = math.sqrt(re * re + im * im)
            ph = math.atan2(im, re)
            amp_row.append(round_float(max(0.01, amp)))
            phase_row.append(round_float(ph))

        amplitude_matrix.append(amp_row)
        phase_matrix.append(phase_row)

    return amplitude_matrix, phase_matrix


def to_capture_amplitudes(amp_row: list[float], rng: random.Random) -> list[float]:
    out: list[float] = []
    for amp in amp_row:
        # Map linear synthetic magnitude to ESP32-like capture amplitude range.
        capture_amp = 36.0 + amp * 24.0 + rng.gauss(0.0, 0.8)
        out.append(round(clamp(capture_amp, 4.0, 120.0), 2))
    return out


def to_iq_hex(capture_amplitudes: list[float], phase_row: list[float]) -> str:
    raw = bytearray()
    for amp, phase in zip(capture_amplitudes, phase_row):
        magnitude = clamp(amp / 120.0, 0.0, 1.0) * 95.0
        i_val = int(round(clamp(magnitude * math.cos(phase), -127.0, 127.0)))
        q_val = int(round(clamp(magnitude * math.sin(phase), -127.0, 127.0)))
        raw.append(i_val & 0xFF)
        raw.append(q_val & 0xFF)
    return raw.hex()


def generate_jsonl_fixture(
    profile: ProfileSpec,
    duration_s: float,
    sample_rate_hz: float,
    num_subcarriers: int,
    node_id: int,
    seed: int,
) -> Path:
    rng = random.Random(seed)
    num_frames = int(duration_s * sample_rate_hz)
    params = build_multipath(seed + 97, num_paths=5, num_antennas=1)
    start_ns = int(time.time() * 1e9)

    output_path = OUTPUT_DIR / f"profile_{profile.name}_{int(duration_s)}s_{int(sample_rate_hz)}hz.csi.jsonl"
    with output_path.open("w", encoding="utf-8") as handle:
        for frame_idx in range(num_frames):
            t = frame_idx / sample_rate_hz
            amp_matrix, phase_matrix = build_frame(
                profile=profile,
                params=params,
                rng=rng,
                t=t,
                num_antennas=1,
                num_subcarriers=num_subcarriers,
            )

            capture_amplitudes = to_capture_amplitudes(amp_matrix[0], rng)
            ts_ns = start_ns + int(t * 1e9)
            rssi = int(
                round(
                    profile.rssi_base
                    + 2.3 * math.sin(2 * math.pi * 0.11 * t + params.rssi_phase)
                    + rng.gauss(0.0, 0.6)
                )
            )

            payload = {
                "type": "raw_csi",
                "timestamp": iso_timestamp_from_ns(ts_ns),
                "ts_ns": ts_ns,
                "node_id": node_id,
                "rssi": rssi,
                "channel": DEFAULT_CHANNEL,
                "subcarriers": num_subcarriers,
                "amplitudes": capture_amplitudes,
                "iq_hex": to_iq_hex(capture_amplitudes, phase_matrix[0]),
                "profile": profile.name,
            }
            handle.write(json.dumps(payload) + "\n")

    return output_path


def generate_proof_fixture(
    profile: ProfileSpec,
    duration_s: float,
    sample_rate_hz: float,
    num_subcarriers: int,
    num_antennas: int,
    seed: int,
) -> Path:
    rng = random.Random(seed)
    num_frames = int(duration_s * sample_rate_hz)
    params = build_multipath(seed + 211, num_paths=5, num_antennas=num_antennas)

    frames: list[dict] = []
    for frame_idx in range(num_frames):
        t = frame_idx / sample_rate_hz
        amp_matrix, phase_matrix = build_frame(
            profile=profile,
            params=params,
            rng=rng,
            t=t,
            num_antennas=num_antennas,
            num_subcarriers=num_subcarriers,
        )
        frames.append(
            {
                "frame_index": frame_idx,
                "timestamp_s": round(t, 4),
                "amplitude": amp_matrix,
                "phase": phase_matrix,
            }
        )

    output_path = OUTPUT_DIR / f"proof_bundle_{profile.name}_{int(duration_s)}s.json"
    payload = {
        "description": (
            "Synthetic CSI proof bundle generated for WALLNUT testing. "
            "Uses deterministic multipath + respiratory/cardiac/motion modulation; "
            "no hard action labels."
        ),
        "generator": "test_data/signal/generate_signals.py",
        "generator_version": "2.0.0",
        "is_synthetic": True,
        "is_real_capture": False,
        "seed": seed,
        "profile_name": profile.name,
        "profile_description": profile.description,
        "num_frames": num_frames,
        "num_antennas": num_antennas,
        "num_subcarriers": num_subcarriers,
        "sampling_rate_hz": sample_rate_hz,
        "center_frequency_hz": CENTER_FREQ_HZ,
        "subcarrier_spacing_hz": SUBCARRIER_SPACING_HZ,
        "profile_parameters": {
            "zone_gains": profile.zone_gains,
            "breathing_hz": profile.breathing_hz,
            "heart_hz": profile.heart_hz,
            "motion_hz": profile.motion_hz,
            "breathing_depth": profile.breathing_depth,
            "cardiac_depth": profile.cardiac_depth,
            "motion_depth": profile.motion_depth,
            "noise_sigma": profile.noise_sigma,
        },
        "multipath_parameters": {
            "path_delays_ns": params.path_delays_ns,
            "path_amplitudes": params.path_amplitudes,
            "path_phase_offsets_rad": params.path_phase_offsets,
            "breathing_phase_offsets_rad": params.breathing_phase_offsets,
            "heart_phase_offsets_rad": params.heart_phase_offsets,
            "motion_phase_offsets_rad": params.motion_phase_offsets,
        },
        "frames": frames,
    }

    with output_path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)

    return output_path


def clean_output_dir() -> int:
    removed = 0
    for pattern in ("*.csi.jsonl", "*.json"):
        for file_path in OUTPUT_DIR.glob(pattern):
            if file_path.name == "generate_signals.py":
                continue
            file_path.unlink(missing_ok=True)
            removed += 1
    return removed


def parse_profiles(raw: str) -> List[ProfileSpec]:
    if raw.strip().lower() == "all":
        return list(PROFILES.values())

    selected: list[ProfileSpec] = []
    for name in [item.strip() for item in raw.split(",") if item.strip()]:
        if name not in PROFILES:
            valid = ", ".join(sorted(PROFILES.keys()))
            raise ValueError(f"Unknown profile '{name}'. Valid profiles: {valid}")
        selected.append(PROFILES[name])
    if not selected:
        raise ValueError("No profiles selected.")
    return selected


def format_size_kb(path: Path) -> str:
    return f"{path.stat().st_size / 1024:.1f} KB"


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate action-neutral CSI fixtures for WALLNUT testing.")
    parser.add_argument(
        "--profiles",
        default="all",
        help=f"Comma-separated profile names or 'all'. Options: {', '.join(sorted(PROFILES.keys()))}",
    )
    parser.add_argument("--duration", type=float, default=30.0, help="Duration (seconds) for JSONL fixtures.")
    parser.add_argument("--proof-duration", type=float, default=10.0, help="Duration (seconds) for proof bundles.")
    parser.add_argument("--rate", type=float, default=100.0, help="Sample rate (Hz).")
    parser.add_argument("--subcarriers", type=int, default=DEFAULT_SUBCARRIERS, help="Number of subcarriers.")
    parser.add_argument("--proof-antennas", type=int, default=DEFAULT_PROOF_ANTENNAS, help="Antennas in proof bundle.")
    parser.add_argument("--seed", type=int, default=20260412, help="Base seed for reproducible fixture generation.")
    parser.add_argument("--clean", action="store_true", help="Delete existing fixtures in test_data/signal before generating.")
    args = parser.parse_args()

    profiles = parse_profiles(args.profiles)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    if args.clean:
        removed = clean_output_dir()
        print(f"Removed {removed} legacy fixture file(s).")

    print("=" * 78)
    print("WALLNUT CSI Fixture Generator (action-neutral)")
    print(f"Output directory: {OUTPUT_DIR.resolve()}")
    print(f"Profiles: {', '.join(profile.name for profile in profiles)}")
    print("=" * 78)

    generated: list[Path] = []
    for idx, profile in enumerate(profiles):
        profile_seed = args.seed + idx * 1009
        node_id = DEFAULT_JSONL_NODE_BASE + idx

        print(f"\n[Profile] {profile.name}")
        print(f"  Description: {profile.description}")

        jsonl_path = generate_jsonl_fixture(
            profile=profile,
            duration_s=args.duration,
            sample_rate_hz=args.rate,
            num_subcarriers=args.subcarriers,
            node_id=node_id,
            seed=profile_seed,
        )
        print(f"  JSONL: {jsonl_path.name} ({format_size_kb(jsonl_path)})")
        generated.append(jsonl_path)

        proof_path = generate_proof_fixture(
            profile=profile,
            duration_s=args.proof_duration,
            sample_rate_hz=args.rate,
            num_subcarriers=args.subcarriers,
            num_antennas=args.proof_antennas,
            seed=profile_seed + 17,
        )
        print(f"  Proof: {proof_path.name} ({format_size_kb(proof_path)})")
        generated.append(proof_path)

    print(f"\nDone. Generated {len(generated)} fixture file(s).")
    print("Use any .csi.jsonl or proof_bundle_*.json file in Upload mode at http://localhost:3000")
    print("=" * 78)


if __name__ == "__main__":
    main()

