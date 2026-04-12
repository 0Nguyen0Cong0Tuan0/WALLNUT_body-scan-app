"use client";
/**
 * MethodologyVisualizers.tsx
 * Client-only wrapper exporting the two canvas/rAF components
 * for use inside the Server Component methodology/page.tsx
 */
import dynamic from "next/dynamic";

export const MethodologySignalViz = dynamic(
  () => import("@/components/SignalVizPanel"),
  { ssr: false, loading: () => <div className="h-64 animate-pulse rounded-xl bg-[#060c14]" /> }
);

export const MethodologyPoseFusion = dynamic(
  () => import("@/components/LivePoseFusion"),
  { ssr: false, loading: () => <div className="h-48 animate-pulse rounded-xl bg-[#060c14]" /> }
);
