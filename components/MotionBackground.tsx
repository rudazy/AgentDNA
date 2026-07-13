"use client";

import { useEffect, useRef } from "react";

/**
 * Motion field inspired by MotionSites Cosmic Ribbon / Dark Matter / Ember Glow.
 * Lime + gold only. Lighter particle load on small screens.
 */
export function MotionBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    let raf = 0;
    let width = 0;
    let height = 0;
    let dpr = 1;
    let t = 0;

    type Hue = "lime" | "gold";
    type Particle = {
      x: number;
      y: number;
      vx: number;
      vy: number;
      r: number;
      hue: Hue;
      a: number;
    };

    let particles: Particle[] = [];

    const COLORS: Record<Hue, { r: number; g: number; b: number }> = {
      lime: { r: 200, g: 241, b: 53 },
      gold: { r: 245, g: 200, b: 66 },
    };

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas!.width = Math.floor(width * dpr);
      canvas!.height = Math.floor(height * dpr);
      canvas!.style.width = `${width}px`;
      canvas!.style.height = `${height}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);

      const density = width < 640 ? 28000 : 16000;
      const cap = width < 640 ? 42 : 88;
      const count = Math.min(cap, Math.floor((width * height) / density));
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.28,
        vy: (Math.random() - 0.5) * 0.28,
        r: 0.7 + Math.random() * 2,
        hue: Math.random() > 0.45 ? "lime" : "gold",
        a: 0.2 + Math.random() * 0.55,
      }));
    }

    function drawRibbon(
      phase: number,
      amp: number,
      yBase: number,
      color: { r: number; g: number; b: number },
      alpha: number,
      thickness: number,
    ) {
      ctx!.beginPath();
      const step = width < 640 ? 12 : 8;
      for (let x = -40; x <= width + 40; x += step) {
        const y =
          yBase +
          Math.sin(x * 0.004 + phase) * amp +
          Math.sin(x * 0.011 + phase * 1.7) * (amp * 0.35);
        if (x === -40) ctx!.moveTo(x, y);
        else ctx!.lineTo(x, y);
      }
      ctx!.strokeStyle = `rgba(${color.r},${color.g},${color.b},${alpha})`;
      ctx!.lineWidth = thickness;
      ctx!.lineCap = "round";
      ctx!.stroke();
    }

    function drawOrb(
      cx: number,
      cy: number,
      radius: number,
      color: { r: number; g: number; b: number },
      pulse: number,
    ) {
      const g = ctx!.createRadialGradient(cx, cy, 0, cx, cy, radius);
      g.addColorStop(0, `rgba(${color.r},${color.g},${color.b},${0.22 * pulse})`);
      g.addColorStop(0.45, `rgba(${color.r},${color.g},${color.b},${0.07 * pulse})`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx!.fillStyle = g;
      ctx!.beginPath();
      ctx!.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx!.fill();
    }

    function frame() {
      t += reduceMotion ? 0 : 0.0085;
      ctx!.fillStyle = "#0a0a0a";
      ctx!.fillRect(0, 0, width, height);

      const vignette = ctx!.createRadialGradient(
        width * 0.5,
        height * 0.32,
        30,
        width * 0.5,
        height * 0.5,
        Math.max(width, height) * 0.78,
      );
      vignette.addColorStop(0, "rgba(17, 17, 17, 0.95)");
      vignette.addColorStop(1, "rgba(10, 10, 10, 1)");
      ctx!.fillStyle = vignette;
      ctx!.fillRect(0, 0, width, height);

      drawOrb(
        width * 0.14,
        height * 0.2,
        Math.min(width, height) * 0.4,
        COLORS.gold,
        0.88 + Math.sin(t * 0.9) * 0.12,
      );
      drawOrb(
        width * 0.86,
        height * 0.24,
        Math.min(width, height) * 0.36,
        COLORS.lime,
        0.85 + Math.cos(t * 0.7) * 0.15,
      );
      drawOrb(
        width * 0.5,
        height * 0.88,
        Math.min(width, height) * 0.32,
        COLORS.gold,
        0.72 + Math.sin(t * 0.5 + 1) * 0.18,
      );

      drawRibbon(t * 1.15, 34, height * 0.26, COLORS.lime, 0.13, 1.4);
      drawRibbon(t * 0.92 + 2, 48, height * 0.4, COLORS.gold, 0.11, 1.5);
      drawRibbon(t * 1.05 + 4, 40, height * 0.56, COLORS.lime, 0.1, 1.3);
      drawRibbon(t * 0.78 + 1, 54, height * 0.7, COLORS.gold, 0.09, 1.4);

      for (const p of particles) {
        if (!reduceMotion) {
          p.x += p.vx + Math.sin(t + p.y * 0.01) * 0.08;
          p.y += p.vy + Math.cos(t + p.x * 0.01) * 0.08;
          if (p.x < -10) p.x = width + 10;
          if (p.x > width + 10) p.x = -10;
          if (p.y < -10) p.y = height + 10;
          if (p.y > height + 10) p.y = -10;
        }
        const c = COLORS[p.hue];
        ctx!.beginPath();
        ctx!.fillStyle = `rgba(${c.r},${c.g},${c.b},${p.a})`;
        ctx!.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx!.fill();
      }

      const linkDist = width < 640 ? 85 : 110;
      for (let i = 0; i < particles.length; i++) {
        const a = particles[i]!;
        for (let j = i + 1; j < particles.length; j++) {
          const b = particles[j]!;
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dist = Math.hypot(dx, dy);
          if (dist < linkDist) {
            const alpha = (1 - dist / linkDist) * 0.13;
            const c = COLORS[a.hue];
            ctx!.strokeStyle = `rgba(${c.r},${c.g},${c.b},${alpha})`;
            ctx!.lineWidth = 0.7;
            ctx!.beginPath();
            ctx!.moveTo(a.x, a.y);
            ctx!.lineTo(b.x, b.y);
            ctx!.stroke();
          }
        }
      }

      if (!reduceMotion) {
        raf = requestAnimationFrame(frame);
      }
    }

    resize();
    frame();
    window.addEventListener("resize", resize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 h-full w-full"
    />
  );
}
