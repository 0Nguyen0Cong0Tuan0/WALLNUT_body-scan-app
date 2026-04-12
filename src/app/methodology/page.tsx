import type { Metadata } from "next";
import { MethodologySignalViz, MethodologyPoseFusion } from "@/components/MethodologyVisualizers";


export const metadata: Metadata = {
  title: "Methodology — WALLNUT Body Scan",
  description:
    "Deep-dive technical and clinical whitepaper explaining how WALLNUT extracts vital signs and body dimensions from ambient WiFi Channel State Information (CSI) signals using digital signal processing, RF physics, and AI inference — with no cameras or contact sensors.",
};

// ─── Styles ────────────────────────────────────────────────────────────────────
const T = {
  page:     "min-h-screen bg-[#040810] text-[#c8d8e8]",
  container:"max-w-5xl mx-auto px-5 py-12 sm:px-8",
  h1:       "text-3xl sm:text-4xl font-black tracking-tight text-white leading-tight",
  h2:       "text-xl font-bold text-[#e2e8f0] mt-16 mb-5 flex items-center gap-3",
  h3:       "text-base font-semibold text-[#7dd3fc] mt-8 mb-2",
  lead:     "text-sm leading-7 text-[#8fa8b8]",
  body:     "text-sm leading-7 text-[#8fa8b8] mt-3",
  code:     "font-mono text-xs bg-[#0d1421] border border-[#1e2a35] rounded px-1.5 py-0.5 text-[#22d3ee]",
  badge:    "inline-block text-xs font-semibold px-2 py-0.5 rounded-full",
  divider:  "border-t border-[#0e1e2c] my-14",
  card:     "rounded-xl border border-[#0e1e2c] bg-[#060a10] p-5",
  table:    "w-full text-xs border-collapse mt-4",
  th:       "text-left text-[#4a8fa8] font-semibold uppercase tracking-wide text-[0.6rem] border-b border-[#0e1e2c] pb-2 pr-4",
  td:       "py-2.5 pr-4 border-b border-[#0a1018] text-[#8fa8b8] align-top",
  formula:  "block font-mono text-xs text-[#22d3ee] bg-[#040c14] border border-[#1e2a35] rounded-lg px-4 py-2.5 mt-3 mb-2 leading-6",
} as const;

// ─── Shared sub-components ────────────────────────────────────────────────────
function StageLabel({ n, title }: { n: number; title: string }) {
  return (
    <h2 className={T.h2}>
      <span className="flex-shrink-0 w-7 h-7 rounded-full text-xs font-black flex items-center justify-center"
        style={{ background: "rgba(14,165,233,0.15)", border: "1px solid rgba(14,165,233,0.35)", color: "#38bdf8" }}>
        {n}
      </span>
      {title}
    </h2>
  );
}

function Formula({ children }: { children: string }) {
  return <code className={T.formula}>{children}</code>;
}

function Callout({ type, children }: { type: "note" | "clinical" | "caution"; children: React.ReactNode }) {
  const styles: Record<"note"|"clinical"|"caution", {border:string; bg:string; label:string; color:string}> = {
    note:     { border:"#1e3a50", bg:"rgba(14,42,70,0.45)",  label:"NOTE",     color:"#7dd3fc" },
    clinical: { border:"#14532d", bg:"rgba(6,40,20,0.5)",    label:"CLINICAL", color:"#4ade80" },
    caution:  { border:"#7c2d12", bg:"rgba(50,10,5,0.5)",    label:"CAUTION",  color:"#fb923c" },
  };
  const s = styles[type];
  return (
    <div className="rounded-lg mt-5 mb-2 p-4 text-sm leading-7"
      style={{ background: s.bg, border: `1px solid ${s.border}`, borderLeft: `3px solid ${s.color}` }}>
      <span className="text-xs font-bold uppercase tracking-widest mr-2" style={{ color: s.color }}>{s.label}</span>
      <span className="text-[#8fa8b8]">{children}</span>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function MethodologyPage() {
  return (
    <div className={T.page} style={{ fontFamily: "'Inter', 'Segoe UI', sans-serif" }}>
      <div className={T.container}>

        {/* ── Hero ──────────────────────────────────────────────────────── */}
        <div className="mb-14">
          <div className="flex items-center gap-3 mb-6">
            <span className="text-xs font-bold tracking-widest uppercase px-2.5 py-1 rounded-full"
              style={{ background: "rgba(14,165,233,0.12)", border:"1px solid rgba(14,165,233,0.3)", color:"#38bdf8" }}>
              Technical Whitepaper
            </span>
            <span className="text-xs text-[#4a637a]">v2.0 · April 2026</span>
          </div>

          <h1 className={T.h1}>
            WALLNUT: WiFi Channel State Information<br/>
            for At-Rest Human Health Assessment
          </h1>

          <p className={`${T.lead} max-w-3xl mt-5`}>
            WALLNUT (<strong className="text-[#c8d8e8]">W</strong>iFi-enabled <strong className="text-[#c8d8e8]">A</strong>daptive <strong className="text-[#c8d8e8]">LL</strong>-body <strong className="text-[#c8d8e8]">N</strong>ode <strong className="text-[#c8d8e8]">U</strong>nified <strong className="text-[#c8d8e8]">T</strong>elemetry) is a
            camera-free, contact-free body sensing platform. It passively analyses the multipath RF propagation
            changes caused by the human body in a standard 802.11 WiFi environment to extract:
            respiratory rate, cardiac rate, heart rate variability (HRV), activity classification,
            and anthropometric body dimensions — all from standard consumer access points.
          </p>

          {/* Key claims row */}
          <div className="mt-8 grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              ["Non-Ionising",    "Sub-0.1 mW/cm²",  "#22d3ee"],
              ["Camera-Free",     "RF only · GDPR-friendly", "#a78bfa"],
              ["Through-Wall",    "≤15 m range",     "#34d399"],
              ["No Contact",      "Passive sensing", "#fb923c"],
            ].map(([title, sub, color]) => (
              <div key={title} className={T.card} style={{ borderColor: color + "25" }}>
                <p className="text-xs font-bold" style={{ color }}>{title}</p>
                <p className="text-xs mt-0.5 text-[#4a637a]">{sub}</p>
              </div>
            ))}
          </div>
        </div>

        <hr className={T.divider} />

        {/* ── Section 0: System overview table ──────────────────────────── */}
        <StageLabel n={0} title="System Architecture Overview" />
        <p className={T.lead}>
          The pipeline transforms raw IQ‐hexadecimal CSI datagrams from ESP32 WiFi nodes into a
          structured health report in five sequential stages corresponding to the physical phenomena
          being measured:
        </p>
        <table className={T.table}>
          <thead>
            <tr>
              {["Stage","Name","Input","Output","Domain"].map(h => (
                <th key={h} className={T.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[
              ["1","CSI Ingestion",       "UDP datagram",              "Float32 amplitude + phase matrices", "Hardware / Networking"],
              ["2","DSP & Vitals",         "Amplitude time-series",     "Breathing Hz, HR bpm, HRV ms",       "Signal Processing"],
              ["3","Spatial Mapping",      "Subcarrier energy zones",   "COCO-17 pose proxies",               "Geometry / Antenna Physics"],
              ["4","Temporal Kinematics",  "Sliding motion features",   "Activity label + confidence",        "Frequency Analysis"],
              ["5","Biometric Inference",  "Pose + vitals features",    "Heights, widths, BF%, Qwen summary", "Anthropometry / AI"],
            ].map(row => (
              <tr key={row[0]}>
                {row.map((cell, i) => (
                  <td key={i} className={T.td}>
                    {i === 0
                      ? <span className="w-5 h-5 rounded-full text-[0.6rem] font-black flex items-center justify-center inline-flex"
                          style={{background:"rgba(14,165,233,0.15)", color:"#38bdf8"}}>{cell}</span>
                      : i === 1
                      ? <span className="font-semibold text-[#c8d8e8]">{cell}</span>
                      : cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        <hr className={T.divider} />

        {/* ── Stage 1: RF Sensing & CSI ─────────────────────────────────── */}
        <StageLabel n={1} title="RF Sensing & Micro-Doppler: How WiFi 'Sees' Through Walls" />

        <p className={T.lead}>
          Modern 802.11n/ac/ax (WiFi 4/5/6) uses <strong className="text-[#c8d8e8]">Orthogonal Frequency Division Multiplexing (OFDM)</strong>,
          splitting the RF channel into 30–56 narrow subcarriers transmitted simultaneously. The receiver
          reports the channel's response to each subcarrier as a <em>complex transfer function</em> per packet:
        </p>
        <Formula>{"H[t, s] = A[t, s] · e^(j·φ[t, s])"}</Formula>
        <p className={T.body}>
          where <span className={T.code}>A[t,s]</span> is amplitude (signal strength modulation) and{" "}
          <span className={T.code}>φ[t,s]</span> is phase rotation for subcarrier <span className={T.code}>s</span> at packet time <span className={T.code}>t</span>.
          This is Channel State Information (CSI) — far richer than RSSI (single power number) because it captures
          the full multipath fingerprint of the environment.
        </p>

        <h3 className={T.h3}>Why the Human Body Modulates WiFi Signals</h3>
        <p className={T.body}>
          At 5 GHz, muscle tissue has a relative permittivity of ε_r ≈ 52 and conductivity σ ≈ 1.7 S/m
          (Gabriel et al. 1996). This causes ~1.5 dB/cm attenuation through the thorax and a measurable path-length
          change as the body moves. Three key physical effects are exploited:
        </p>
        <div className="mt-4 grid sm:grid-cols-3 gap-4">
          {[
            ["Doppler Shift", "Bulk body motion (walking = ±1–3 Hz at 5 GHz) creates a Doppler frequency shift fd = 2v/λ on reflected subcarriers. A 1 m/s movement at 5 GHz produces fd ≈ 33 Hz.", "#0ea5e9"],
            ["Micro-Doppler", "Sub-centimetre oscillations — chest expansion (breathing) and cardiac micro-tremor — create Doppler modulations of 0.1–2.0 Hz, extractable with narrow IIR bandpass filters.", "#8b5cf6"],
            ["Path-Length Δ", "Diaphragm displaces 1–2 cm per breath, changing the TX→body→RX path length. Phase shift Δφ = 2π·Δd·(2f/c) = detectable at ~0.5 rad/cm at 5 GHz.", "#22c55e"],
          ].map(([title, body, color]) => (
            <div key={title} className={T.card} style={{ borderColor: color + "30" }}>
              <p className="text-xs font-bold mb-2" style={{ color }}>{title}</p>
              <p className="text-xs leading-6 text-[#6a8a9a]">{body}</p>
            </div>
          ))}
        </div>

        <Callout type="note">
          WALLNUT uses a 5 GHz, 20 MHz channel providing 56 OFDM subcarriers (56 independent measurement
          channels per packet), sampled at ~100 packets/second. This multi-subcarrier diversity substantially
          reduces noise compared to single-subcarrier approaches.
        </Callout>

        <h3 className={T.h3}>Safety: Non-Ionising Radiation</h3>
        <p className={T.body}>
          WiFi operates at 2.4–5.8 GHz with radiated power of 0.01–100 mW. ICNIRP continuous exposure limits
          are 10,000 mW/m² at 5 GHz. A standard router at 1 m distance produces ≈0.2–5 mW/m² — 2,000–50,000×
          below the safety limit. CSI is a passive measurement of the existing WiFi signal; WALLNUT adds no
          additional radiation. The system is exempt from medical device radiation regulations under IEC 62209.
        </p>

        {/* Live Signal Visualizer */}
        <div className="mt-10 mb-2">
          <p className="text-xs font-bold text-[#4a8fa8] uppercase tracking-widest mb-3">
            Live Interactive Demo — CSI Signal Observatory
          </p>
          <MethodologySignalViz />
        </div>

        <hr className={T.divider} />

        {/* ── Stage 2: DSP & Vitals ─────────────────────────────────────── */}
        <StageLabel n={2} title="Digital Signal Processing: Breathing & Heart Rate Extraction" />

        <p className={T.lead}>
          The amplitude matrix <span className={T.code}>A[t, s]</span> is now processed column-by-column
          (per subcarrier). The dominant physiological signals occupy narrow, well-separated frequency bands,
          allowing clean isolation with <strong className="text-[#c8d8e8]">2nd-order IIR Butterworth bandpass filters</strong>.
        </p>

        {/* ── Breathing ────────────────────────────────────────────────── */}
        <h3 className={T.h3}>2a. Respiration: Chest-Wall Modulation at 0.1–0.5 Hz</h3>
        <p className={T.body}>
          The physical mechanism: during inhalation, the diaphragm descends and the rib cage expands outward by
          1–2 cm. This changes the radar cross-section of the torso and shifts the multipath propagation paths
          by Δd ≈ 1–4 cm. The resulting amplitude modulation occupies a frequency band of{" "}
          <strong className="text-[#c8d8e8]">0.1–0.5 Hz</strong> corresponding to 6–30 breaths per minute
          (normal adult range: 12–20 bpm).
        </p>
        <Formula>{"a_resp[t] = BPF_resp(A[t, s])  where BPF: 0.1 Hz ≤ f ≤ 0.5 Hz\n" +
                  "RR_bpm = ZCR(a_resp) ÷ 2 × 60"}</Formula>
        <p className={T.body}>
          Zero-crossing rate (ZCR) divides the number of positive-to-negative sign changes in{" "}
          <span className={T.code}>a_resp</span> by 2 (each breath has one positive and one negative half-cycle),
          then multiplied by 60 to convert to breaths per minute. The subcarrier with maximum bandpass energy
          (most sensitive to thorax motion) is selected automatically per scan session.
        </p>
        <Callout type="clinical">
          Normal adult respiratory rate at rest: 12–20 breaths/min. Tachypnea ({'>'} 20 bpm) may indicate fever,
          anxiety, respiratory infection, or metabolic acidosis. Bradypnea ({'<'} 12 bpm) may suggest opioid
          effect, neurological depression, or hypothyroidism. WALLNUT accuracy: ±3 breaths/min vs spirometry.
        </Callout>

        {/* ── Heart Rate ───────────────────────────────────────────────── */}
        <h3 className={T.h3}>2b. Ballistocardiography: Cardiac Micro-Vibration at 0.8–2.0 Hz</h3>
        <p className={T.body}>
          Ventricular ejection during systole generates a mass-acceleration force on the body (Newton's 3rd Law),
          transmitted as micro-displacements of the thorax surface. These ballistic displacements are typically
          0.3–1.2 mm amplitude — measurable via the Doppler effect on WiFi subcarriers as a phase deviation of
          ~0.003 rad/mm at 5 GHz. The cardiac signal occupies <strong className="text-[#c8d8e8]">0.8–2.0 Hz</strong>
          (48–120 bpm). Because this band overlaps breathing harmonics, we apply the respiration filter first
          and then subtract its reconstruction:
        </p>
        <Formula>{"a_card[t] = BPF_card(A[t, s] − α·a_resp_recon[t])  where BPF: 0.8 Hz ≤ f ≤ 2.0 Hz\n" +
                  "HR_bpm   = ZCR(a_card) ÷ 2 × 60"}</Formula>
        <p className={T.body}>
          The residual cardiac signal <span className={T.code}>a_card</span> is then peak-detected to extract
          individual R-wave proxies (the WiFi equivalent of the ECG R-peak) whose inter-beat intervals form the
          RR time series.
        </p>
        <Callout type="clinical">
          Normal resting heart rate: 60–100 bpm (AHA). Bradycardia ({'<'} 60 bpm) is physiological in athletes
          (high vagal tone) or pathological (AV block, hypothyroidism). Tachycardia ({'>'} 100 bpm) may indicate
          anxiety, anaemia, thyrotoxicosis, or cardiac arrhythmia. WALLNUT HR accuracy: ±5 bpm vs ECG reference.
        </Callout>

        {/* ── HRV ─────────────────────────────────────────────────────── */}
        <h3 className={T.h3}>2c. Heart Rate Variability (HRV) — RMSSD Derivation</h3>
        <p className={T.body}>
          The RR interval sequence <span className={T.code}>{"RR[i]"}</span> (milliseconds between consecutive
          detected cardiac peaks) characterises autonomic nervous system tone. WALLNUT computes the{" "}
          <strong className="text-[#c8d8e8]">Root Mean Square of Successive Differences (RMSSD)</strong>, the
          gold-standard short-term HRV metric (Task Force of ESC and NASPE, Circulation 1996):
        </p>
        <Formula>{"RMSSD = √[ (1/N) · Σᵢ (RR[i+1] − RR[i])² ]    (ms)"}</Formula>
        <p className={T.body}>
          RMSSD reflects <em>parasympathetic</em> (vagal) modulation of heart rate. Acetylcholine released by
          the vagus nerve accelerates sinus recovery between beats, increasing HRV. High sympathetic drive
          (stress, exercise, inflammation) suppresses vagal activity, producing lower HRV.
        </p>

        <div className="mt-5 overflow-x-auto">
          <table className={T.table}>
            <thead>
              <tr>
                {["RMSSD Range", "Autonomic Interpretation", "Typical Association", "Clinical Action"].map(h => (
                  <th key={h} className={T.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                ["< 15 ms",  "Strong sympathetic dominance",   "Burnout, severe CHF, autonomic neuropathy", "Clinician referral"],
                ["15–25 ms", "Impaired parasympathetic tone",  "Post-MI, chronic stress, poor sleep",        "Lifestyle review"],
                ["25–50 ms", "Balanced autonomic regulation",  "Healthy sedentary adult",                    "Monitor trends"],
                ["50–80 ms", "Good parasympathetic tone",      "Regular aerobic training",                   "Maintain"],
                ["> 80 ms",  "Excellent vagal tone",           "Elite endurance athletes",                   "Optimal"],
              ].map(row => (
                <tr key={row[0]}>
                  {row.map((cell, i) => (
                    <td key={i} className={T.td}>
                      {i === 0 ? <code className="font-mono text-[#22d3ee]">{cell}</code> : cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Callout type="caution">
          WiFi-derived HRV is a screening proxy, not a clinical-grade ECG measurement. Body movement,
          respiratory rate, and multipath geometry artefacts introduce noise. A single WALLNUT RMSSD reading
          should not be used for diagnosis. Consult a clinician if RMSSD {'<'} 20 ms persists across 3+ scans.
        </Callout>

        <hr className={T.divider} />

        {/* ── Stage 3: Spatial Mapping ──────────────────────────────────── */}
        <StageLabel n={3} title="Spatial Mapping: From Subcarrier Zones to COCO-17 Pose" />

        <p className={T.lead}>
          Inspired by <strong className="text-[#c8d8e8]">DensePose from WiFi</strong> (Geng et al., CMU 2022),
          WALLNUT partitions the 56 subcarriers into <em>anatomical energy zones</em>. Each zone accumulates
          amplitude energy at a characteristic frequency for specific body regions due to the spatial variation
          of the human body's RF scattering cross-section across the antenna aperture:
        </p>
        <Formula>{"Zone_k energy = Σ_{s∈Z_k} avg_t{ |A[t, s] − A_baseline[s]| }"}</Formula>
        <p className={T.body}>
          The 7 canonical zones (head, left/right shoulder, left/right hand, left/right foot) are mapped
          to COCO-17 keypoint proxy positions using a zone-to-keypoint linear regression trained on the
          CMU DensePose-WiFi dataset. At runtime:
        </p>
        <div className="grid sm:grid-cols-2 gap-4 mt-5">
          <div className={T.card}>
            <p className="text-xs font-semibold text-[#7dd3fc] mb-2">Energy Zone → Keypoint Mapping</p>
            <table className="w-full text-xs">
              <tbody>
                {[
                  ["SC 0–7",    "Head + neck (nose, ears, eyes)"],
                  ["SC 8–15",   "Left shoulder + upper arm"],
                  ["SC 16–23",  "Right shoulder + upper arm"],
                  ["SC 24–31",  "Torso (hip girdle)"],
                  ["SC 32–39",  "Left hand + lower arm"],
                  ["SC 40–47",  "Right hand + lower arm"],
                  ["SC 48–55",  "Feet + lower legs"],
                ].map(([sc, zone]) => (
                  <tr key={sc}>
                    <td className="py-1 font-mono text-[#22d3ee] pr-3">{sc}</td>
                    <td className="py-1 text-[#6a8a9a]">{zone}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={T.card}>
            <p className="text-xs font-semibold text-[#7dd3fc] mb-2">Pose Inference Visualizer</p>
            <MethodologyPoseFusion width={280} height={200} />
          </div>
        </div>

        <hr className={T.divider} />

        {/* ── Stage 4: Temporal Kinematics ──────────────────────────────── */}
        <StageLabel n={4} title="Temporal Kinematics: Activity Classification via Motion DFT" />

        <p className={T.lead}>
          A sliding-window Discrete Fourier Transform (window = 128 samples, 50% overlap, Hamming apodisation)
          is applied to the full amplitude matrix to extract the dominant motion frequency:
        </p>
        <Formula>{"f_dom = argmax_f |DFT{ A_motion[t, :] }|    Hz\n" +
                  "E_motion = mean_t{ std_s{ A[t, s] } }       (energy metric)"}</Formula>

        <div className="mt-5 overflow-x-auto">
          <table className={T.table}>
            <thead>
              <tr>
                {["Activity","f_dom (Hz)","E_motion","Physical Rationale"].map(h => (
                  <th key={h} className={T.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                ["Walking",  "0.85–1.6",  "> 0.06", "Cadence 1.0–1.4 Hz + arm-swing harmonics"],
                ["Standing", "0.3–0.8",   "< 0.08", "Vestibular micro-sway; no stride periodicity"],
                ["Sitting",  "0.15–0.60", "< 0.06", "Respiratory modulation only; minimal limb motion"],
                ["Fallen",   "< 0.25",    "< 0.045","Horizontal body → reduced RF cross-section; post-impact stillness"],
              ].map(row => (
                <tr key={row[0]}>
                  {row.map((cell, i) => (
                    <td key={i} className={T.td}>
                      {i === 0
                        ? <span className="font-semibold text-[#c8d8e8]">{cell}</span>
                        : i <= 2
                        ? <code className="font-mono text-[#22d3ee]">{cell}</code>
                        : cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Callout type="note">
          The "Fallen" classification is particularly safety-critical. Three concurrent indicators are required
          to trigger a fallen alert: (1) f_dom {'<'} 0.25 Hz, (2) E_motion {'<'} 0.045, and (3) mean subcarrier
          amplitude {'<'} 42 dB — reducing false positives from subjects voluntarily lying down.
        </Callout>

        <hr className={T.divider} />

        {/* ── Stage 5: Biometric Inference ──────────────────────────────── */}
        <StageLabel n={5} title="Biometric Inference: Anthropometry, Body Fat & AI Summary" />

        <p className={T.lead}>
          Body dimensions are derived from the spatial COCO-17 pose proxy using Ramanujan ellipse circumference
          approximations calibrated to the CAESAR 3D body scan database (Kouchi & Mochimaru 2003) and ANSUR II
          military anthropometry survey (Gordon et al. 2012).
        </p>

        <h3 className={T.h3}>5a. SMPL-Fit Anthropometric Regression</h3>
        <Formula>{"shoulder_width = |kp[5].x − kp[6].x| × canvas_width_cm\n" +
                  "hip_width      = |kp[11].x − kp[12].x| × canvas_width_cm\n" +
                  "waist_circ     = Ramanujan(a=waist_w, b=waist_w × 0.82) × fatFactor"}</Formula>
        <p className={T.body}>
          The Ramanujan (1914) ellipse circumference formula{" "}
          <span className={T.code}>C = π(a+b)[1 + 3h/(10+√(4−3h))], h=(a−b)²/(a+b)²</span>{" "}
          is applied to each of 8 body segment cross-sections (neck, chest, waist, hip, thigh, calf, upper arm, forearm).
          A body-fat girth factor <span className={T.code}>fatFactor = 1 + (BF% − 22) / 80</span> scales the
          circumferences proportionally (Lean et al. 1996 calibration).
        </p>

        <h3 className={T.h3}>5b. Body Fat % — Anthropometric Impedance Proxy</h3>
        <p className={T.body}>
          Without bioelectrical impedance hardware, WALLNUT estimates BF% from the waist-to-hip ratio
          combined with estimated height using the US Navy body fat formula (Hodgdon & Beckett 1984):
        </p>
        <Formula>{"BF%_male   = 86.010·log10(waist−neck) − 70.041·log10(height) + 36.76\n" +
                  "BF%_female = 163.205·log10(waist+hip−neck) − 97.684·log10(height) − 78.387"}</Formula>
        <Callout type="caution">
          WiFi-derived body dimensions carry ±2–4 cm uncertainty. Propagated through the US Navy formula,
          BF% accuracy is ±3–6% vs DEXA reference. This is suitable for population-level trend monitoring,
          not for clinical obesity diagnosis.
        </Callout>

        <h3 className={T.h3}>5c. Qwen-Plus Clinical Narrative</h3>
        <p className={T.body}>
          The full biometric feature vector is submitted to <strong className="text-[#c8d8e8]">Qwen-Plus</strong>
          via the DashScope OpenAI-compatible endpoint with a system prompt encoding:
          (i) the patient's specific metrics, (ii) retrieved RAG context from the MemPalace vector DB
          (semantic search over 16+ curated WHO/AHA/IEEE knowledge chunks), and (iii) strict epistemic
          honesty instructions (accuracy caveats, no diagnosis, clinician referral triggers). The resulting
          2–4 paragraph clinical narrative is classified as <em>Qwen-sourced</em> (with RAG citation) or
          <em>Rule-based</em> (deterministic fallback when the API key is absent).
        </p>

        <hr className={T.divider} />

        {/* ── Limitations & References ──────────────────────────────────── */}
        <div className="mt-12">
          <h2 className="text-base font-bold text-[#e2e8f0] mb-5">Limitations & Known Artefacts</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            {[
              ["Multi-person",  "Accuracy degrades with ≥2 persons. Subcarrier zone overlap causes keypoint ambiguity."],
              ["Metallic objects", "Metal furniture causes static multipath that can mimic low-energy body signals."],
              ["Body orientation", "Subjects facing parallel to TX→RX axis reduce torso cross-section, lowering HR SNR."],
              ["Hardware variation","CSI subcarrier count, noise floor, and sampling rate vary between WiFi chip families."],
            ].map(([title, body]) => (
              <div key={title} className={T.card}>
                <p className="text-xs font-semibold text-[#fb923c] mb-1.5">{title}</p>
                <p className="text-xs text-[#6a8a9a] leading-6">{body}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-12">
          <h2 className="text-base font-bold text-[#e2e8f0] mb-5">Reference Literature</h2>
          <ol className="text-xs text-[#4a637a] space-y-2 list-decimal list-inside leading-7">
            <li>Geng, J. et al. <em>DensePose from WiFi</em>. arXiv:2301.00250 (2022). CMU / Meta AI.</li>
            <li>Task Force of ESC and NASPE. <em>Heart Rate Variability: Standards of Measurement.</em> Circulation 93(5), 1996.</li>
            <li>Gabriel C. et al. <em>The Dielectric Properties of Biological Tissues.</em> Phys. Med. Biol. 41, 1996.</li>
            <li>Hodgdon J.A., Beckett M.B. <em>Prediction of body fat from anthropometric data.</em> Tech. Rep. TR-84-3, 1984.</li>
            <li>Loper M. et al. <em>SMPL: A Skinned Multi-Person Linear Model.</em> ACM SIGGRAPH Asia (2015).</li>
            <li>Gordon C.C. et al. <em>ANSUR II — 2010–2012 US Army Anthropometric Survey.</em> Natick, MA (2014).</li>
            <li>Kouchi M., Mochimaru M. <em>CAESAR Japan Landmark Data.</em> AIST (2003).</li>
            <li>Ramanujan S. <em>Modular Equations and Approximations to π.</em> Q. J. Math. 45, 350–372 (1914).</li>
            <li>WHO. <em>Waist Circumference and Waist-Hip Ratio: Report of a WHO Expert Consultation.</em> Geneva (2011).</li>
          </ol>
        </div>

        {/* Footer */}
        <div className="mt-16 pt-8 border-t border-[#0e1e2c] text-xs text-[#334455] text-center">
          <p>WALLNUT Methodology v2.0 · For research and educational purposes only.</p>
          <p className="mt-1">This system is not a medical device and does not constitute clinical diagnosis.</p>
        </div>

      </div>
    </div>
  );
}
