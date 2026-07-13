"use client";

import { useEffect, useState } from "react";
import type { AgentTraits } from "@/lib/types";

const LABELS: { key: keyof AgentTraits; label: string }[] = [
  { key: "reliability", label: "Reliability" },
  { key: "consistency", label: "Consistency" },
  { key: "longevity", label: "Longevity" },
  { key: "riskAppetite", label: "Risk Appetite" },
  { key: "activity", label: "Activity" },
  { key: "counterpartyDiversity", label: "Diversity" },
];

function polar(cx: number, cy: number, r: number, angleRad: number) {
  return {
    x: cx + r * Math.sin(angleRad),
    y: cy - r * Math.cos(angleRad),
  };
}

export function DnaRadar({
  traits,
  size,
}: {
  traits: AgentTraits;
  size?: number;
}) {
  const [autoSize, setAutoSize] = useState(280);

  useEffect(() => {
    function measure() {
      const w = window.innerWidth;
      if (w < 390) setAutoSize(260);
      else if (w < 640) setAutoSize(300);
      else if (w < 768) setAutoSize(320);
      else setAutoSize(360);
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const s = size ?? autoSize;
  const cx = s / 2;
  const cy = s / 2;
  const maxR = s * 0.34;
  const n = LABELS.length;
  const rings = [0.25, 0.5, 0.75, 1];

  const points = LABELS.map((item, i) => {
    const angle = (i / n) * Math.PI * 2;
    const value = Math.max(0, Math.min(100, traits[item.key])) / 100;
    return polar(cx, cy, maxR * value, angle);
  });

  const poly = points.map((p) => `${p.x},${p.y}`).join(" ");

  return (
    <svg
      width={s}
      height={s}
      viewBox={`0 0 ${s} ${s}`}
      role="img"
      aria-label="Agent DNA hexagonal trait radar"
      className="mx-auto h-auto w-full max-w-[360px]"
    >
      <title>Agent DNA radar</title>
      <defs>
        <radialGradient id="radarGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#c8f135" stopOpacity="0.14" />
          <stop offset="55%" stopColor="#f5c842" stopOpacity="0.05" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="radarStroke" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#c8f135" />
          <stop offset="100%" stopColor="#f5c842" />
        </linearGradient>
        <filter id="radarSoft" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="1.1" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <circle cx={cx} cy={cy} r={maxR + 26} fill="url(#radarGlow)" />
      {rings.map((frac) => {
        const ringPts = LABELS.map((_, i) => {
          const angle = (i / n) * Math.PI * 2;
          return polar(cx, cy, maxR * frac, angle);
        });
        const d = ringPts.map((p) => `${p.x},${p.y}`).join(" ");
        return (
          <polygon
            key={frac}
            points={d}
            fill="none"
            stroke="rgba(200,241,53,0.14)"
            strokeWidth={1}
          />
        );
      })}
      {LABELS.map((item, i) => {
        const angle = (i / n) * Math.PI * 2;
        const tip = polar(cx, cy, maxR, angle);
        const labelPos = polar(cx, cy, maxR + 22, angle);
        return (
          <g key={item.key}>
            <line
              x1={cx}
              y1={cy}
              x2={tip.x}
              y2={tip.y}
              stroke="rgba(245,200,66,0.2)"
              strokeWidth={1}
            />
            <text
              x={labelPos.x}
              y={labelPos.y}
              textAnchor="middle"
              dominantBaseline="middle"
              fill="#8a8a8a"
              fontSize={s < 300 ? 9 : 10}
              fontFamily="var(--font-geist-mono), monospace"
            >
              {item.label}
            </text>
          </g>
        );
      })}
      <polygon
        className="radar-poly"
        points={poly}
        fill="rgba(200, 241, 53, 0.14)"
        stroke="url(#radarStroke)"
        strokeWidth={2.3}
        strokeLinejoin="round"
        filter="url(#radarSoft)"
      />
      {points.map((p, i) => (
        <g key={LABELS[i]!.key}>
          <circle cx={p.x} cy={p.y} r={6} fill="rgba(200,241,53,0.18)" />
          <circle cx={p.x} cy={p.y} r={3.4} fill="#c8f135" />
        </g>
      ))}
    </svg>
  );
}
