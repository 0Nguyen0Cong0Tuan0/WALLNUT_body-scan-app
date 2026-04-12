import dgram from "node:dgram";
import type { CSIFrameRaw } from "@/lib/csiProcessor";
import { HardwareNotFoundError, LiveStatusError } from "@/lib/scanErrors";

interface MeshNodeTelemetry {
  nodeId: number;
  packets: number;
  lastSeenAtMs: number;
  lastRssi: number;
  lastChannel: number;
}

export interface LiveCaptureResult {
  port: number;
  timeoutMs: number;
  durationMs: number;
  packetsReceived: number;
  nodes: number[];
  lastPacketAtMs: number | null;
  frames: CSIFrameRaw[];
  jsonl: string;
}

export interface MeshNodeHealth {
  nodeId: number;
  packets: number;
  lastRssi: number;
  lastChannel: number;
  lastSeenAtMs: number;
  ageMs: number;
  healthy: boolean;
}

export interface MeshStatus {
  port: number;
  timeoutMs: number;
  packetsReceived: number;
  healthy: boolean;
  activeNodes: number;
  lastPacketAtMs: number | null;
  nodes: MeshNodeHealth[];
}

const meshRegistry = new Map<number, MeshNodeTelemetry>();
let lastPacketAtMs: number | null = null;

function clamp(value: number, minValue: number, maxValue: number): number {
  return Math.min(maxValue, Math.max(minValue, value));
}

function nowNs(): number {
  return Date.now() * 1_000_000;
}

function decodeIqAmplitudes(iqBytes: Buffer): number[] {
  const amplitudes: number[] = [];
  for (let i = 0; i + 1 < iqBytes.length; i += 2) {
    const iComp = iqBytes.readInt8(i);
    const qComp = iqBytes.readInt8(i + 1);
    amplitudes.push(Math.sqrt(iComp * iComp + qComp * qComp));
  }
  return amplitudes;
}

function parseAdr018Packet(data: Buffer): CSIFrameRaw | null {
  if (data.length < 8) return null;
  const magic = data.readUInt16LE(0);
  const declaredLength = data.readUInt16LE(2);
  const frameLength = declaredLength >= 8 && declaredLength <= data.length ? declaredLength : data.length;
  const nodeId = data.readUInt8(4);
  const rssi = data.readInt8(6);
  const channel = data.readUInt8(7);
  const iqBytes = data.subarray(8, frameLength);
  const amplitudes = decodeIqAmplitudes(iqBytes);
  if (amplitudes.length === 0) return null;

  return {
    type: "raw_csi",
    timestamp: new Date().toISOString(),
    ts_ns: nowNs(),
    node_id: nodeId,
    rssi,
    channel,
    subcarriers: amplitudes.length,
    amplitudes,
    iq_hex: iqBytes.toString("hex"),
    scenario: "live",
    magic: `0x${magic.toString(16).padStart(4, "0")}`,
    size: frameLength,
  } as CSIFrameRaw;
}

function resolveEnvInt(name: string, fallback: number, minValue: number, maxValue: number): number {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw)) return fallback;
  return Math.round(clamp(raw, minValue, maxValue));
}

export function resolveLivePort(port?: number): number {
  const envPort = resolveEnvInt("LIVE_CSI_UDP_PORT", resolveEnvInt("RUVIEW_CSI_UDP_PORT", 8080, 1, 65535), 1, 65535);
  if (port === undefined) return envPort;
  if (!Number.isFinite(port)) return envPort;
  return Math.round(clamp(port, 1, 65535));
}

export function resolveLiveProbeTimeoutMs(): number {
  return resolveEnvInt("LIVE_PRE_SCAN_TIMEOUT_MS", 45, 10, 2000);
}

export function resolveLiveMaxPackets(): number {
  return resolveEnvInt("LIVE_CAPTURE_MAX_PACKETS", 96, 1, 5000);
}

function registerLiveFrame(frame: CSIFrameRaw): void {
  const current = meshRegistry.get(frame.node_id);
  const now = Date.now();
  if (current) {
    current.packets += 1;
    current.lastSeenAtMs = now;
    current.lastRssi = frame.rssi;
    current.lastChannel = frame.channel;
    return;
  }

  meshRegistry.set(frame.node_id, {
    nodeId: frame.node_id,
    packets: 1,
    lastSeenAtMs: now,
    lastRssi: frame.rssi,
    lastChannel: frame.channel,
  });
}

function snapshotMesh(staleMs = 5000): MeshNodeHealth[] {
  const now = Date.now();
  return [...meshRegistry.values()]
    .map((node) => {
      const ageMs = now - node.lastSeenAtMs;
      return {
        nodeId: node.nodeId,
        packets: node.packets,
        lastRssi: node.lastRssi,
        lastChannel: node.lastChannel,
        lastSeenAtMs: node.lastSeenAtMs,
        ageMs,
        healthy: ageMs <= staleMs,
      };
    })
    .sort((a, b) => a.nodeId - b.nodeId);
}

export async function captureLiveFrames(options: {
  port: number;
  timeoutMs?: number;
  maxPackets?: number;
}): Promise<LiveCaptureResult> {
  const timeoutMs = Math.max(1, Math.round(options.timeoutMs ?? resolveLiveProbeTimeoutMs()));
  const maxPackets = Math.max(1, Math.round(options.maxPackets ?? resolveLiveMaxPackets()));
  const port = resolveLivePort(options.port);

  return new Promise((resolve, reject) => {
    const startedAtMs = Date.now();
    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    const frames: CSIFrameRaw[] = [];
    const nodes = new Set<number>();
    let finished = false;
    let timer: NodeJS.Timeout | null = null;

    const finalize = (error?: Error): void => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      socket.removeAllListeners("message");
      socket.removeAllListeners("error");
      socket.removeAllListeners("listening");
      socket.close();

      if (error) {
        reject(error);
        return;
      }

      resolve({
        port,
        timeoutMs,
        durationMs: Date.now() - startedAtMs,
        packetsReceived: frames.length,
        nodes: [...nodes].sort((a, b) => a - b),
        lastPacketAtMs,
        frames,
        jsonl: frames.map((frame) => JSON.stringify(frame)).join("\n"),
      });
    };

    socket.on("error", (error) => {
      finalize(
        new LiveStatusError("Failed to read CSI UDP stream.", {
          reason: error.message,
          port,
        })
      );
    });

    socket.on("message", (message) => {
      const frame = parseAdr018Packet(message);
      if (!frame) return;
      frames.push(frame);
      nodes.add(frame.node_id);
      registerLiveFrame(frame);
      lastPacketAtMs = Date.now();

      if (frames.length >= maxPackets) finalize();
    });

    socket.on("listening", () => {
      timer = setTimeout(() => finalize(), timeoutMs);
    });

    socket.bind(port, "0.0.0.0");
  });
}

export async function assertLiveTraffic(options: {
  port: number;
  timeoutMs?: number;
  maxPackets?: number;
  minPackets?: number;
}): Promise<LiveCaptureResult> {
  const minPackets = Math.max(1, Math.round(options.minPackets ?? 1));
  const capture = await captureLiveFrames(options);
  if (capture.packetsReceived < minPackets) {
    throw new HardwareNotFoundError("No CSI UDP packets detected on live port.", {
      port: capture.port,
      timeoutMs: capture.timeoutMs,
      packetsReceived: capture.packetsReceived,
    });
  }
  return capture;
}

export async function getMeshStatus(options: {
  port: number;
  timeoutMs?: number;
  staleMs?: number;
}): Promise<MeshStatus> {
  const port = resolveLivePort(options.port);
  const timeoutMs = Math.max(1, Math.round(options.timeoutMs ?? 35));
  await captureLiveFrames({ port, timeoutMs, maxPackets: 12 });
  const nodes = snapshotMesh(Math.max(500, Math.round(options.staleMs ?? 5000)));
  const activeNodes = nodes.filter((node) => node.healthy).length;
  const healthy = activeNodes > 0;
  return {
    port,
    timeoutMs,
    packetsReceived: nodes.reduce((sum, node) => sum + node.packets, 0),
    healthy,
    activeNodes,
    lastPacketAtMs,
    nodes,
  };
}

