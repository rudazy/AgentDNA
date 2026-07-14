/**
 * OG image, 1200x630. Mirrors the landing hero: near-black base, Geist Mono,
 * lime to gold accents, hexagonal trait radar as the single visual signature.
 */
import { readFile } from "fs/promises";
import { join } from "path";
import { ImageResponse } from "next/og";

export const alt =
  "Agent DNA. Every agent has DNA. Read it before you commit money.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const LIME = "#c8f135";
const GOLD = "#f5c842";
const INK = "#f5f5f5";
const MUTED = "#8a8a8a";
const BASE = "#0a0a0a";

// Fonts are read from disk at build time; this route is statically prerendered.
function loadFont(file: string): Promise<Buffer> {
  return readFile(join(process.cwd(), "app", file));
}

/** Same geometry family as components/DnaRadar.tsx, static trait values. */
function RadarMark({ width }: { width: number }) {
  return (
    <svg width={width} height={width} viewBox="0 0 120 120">
      <defs>
        <linearGradient id="stroke" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={LIME} />
          <stop offset="100%" stopColor={GOLD} />
        </linearGradient>
      </defs>
      <polygon
        points="60,48 70.39,54 70.39,66 60,72 49.61,66 49.61,54"
        fill="none"
        stroke="rgba(200,241,53,0.14)"
        strokeWidth="1"
      />
      <polygon
        points="60,36 80.78,48 80.78,72 60,84 39.22,72 39.22,48"
        fill="none"
        stroke="rgba(200,241,53,0.14)"
        strokeWidth="1"
      />
      <polygon
        points="60,24 91.18,42 91.18,78 60,96 28.82,78 28.82,42"
        fill="none"
        stroke="rgba(200,241,53,0.14)"
        strokeWidth="1"
      />
      <polygon
        points="60,12 101.57,36 101.57,84 60,108 18.43,84 18.43,36"
        fill="none"
        stroke="rgba(200,241,53,0.28)"
        strokeWidth="1"
      />
      <line x1="60" y1="60" x2="60" y2="12" stroke="rgba(245,200,66,0.2)" strokeWidth="1" />
      <line x1="60" y1="60" x2="101.57" y2="36" stroke="rgba(245,200,66,0.2)" strokeWidth="1" />
      <line x1="60" y1="60" x2="101.57" y2="84" stroke="rgba(245,200,66,0.2)" strokeWidth="1" />
      <line x1="60" y1="60" x2="60" y2="108" stroke="rgba(245,200,66,0.2)" strokeWidth="1" />
      <line x1="60" y1="60" x2="18.43" y2="84" stroke="rgba(245,200,66,0.2)" strokeWidth="1" />
      <line x1="60" y1="60" x2="18.43" y2="36" stroke="rgba(245,200,66,0.2)" strokeWidth="1" />
      <polygon
        points="60,14.4 85.77,45.12 96.58,81.12 60,86.4 26.74,79.2 30.9,43.2"
        fill="rgba(200,241,53,0.14)"
        stroke="url(#stroke)"
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
      <circle cx="60" cy="14.4" r="4" fill="rgba(200,241,53,0.18)" />
      <circle cx="60" cy="14.4" r="2.2" fill={LIME} />
      <circle cx="85.77" cy="45.12" r="4" fill="rgba(200,241,53,0.18)" />
      <circle cx="85.77" cy="45.12" r="2.2" fill={LIME} />
      <circle cx="96.58" cy="81.12" r="4" fill="rgba(245,200,66,0.18)" />
      <circle cx="96.58" cy="81.12" r="2.2" fill={GOLD} />
      <circle cx="60" cy="86.4" r="4" fill="rgba(200,241,53,0.18)" />
      <circle cx="60" cy="86.4" r="2.2" fill={LIME} />
      <circle cx="26.74" cy="79.2" r="4" fill="rgba(200,241,53,0.18)" />
      <circle cx="26.74" cy="79.2" r="2.2" fill={LIME} />
      <circle cx="30.9" cy="43.2" r="4" fill="rgba(245,200,66,0.18)" />
      <circle cx="30.9" cy="43.2" r="2.2" fill={GOLD} />
    </svg>
  );
}

function Chip({ children }: { children: string }) {
  return (
    <div
      style={{
        display: "flex",
        border: "1px solid rgba(200,241,53,0.28)",
        backgroundColor: "rgba(200,241,53,0.08)",
        borderRadius: 999,
        padding: "8px 20px",
        fontSize: 17,
        letterSpacing: 3,
        color: LIME,
      }}
    >
      {children}
    </div>
  );
}

export default async function OpengraphImage() {
  const [regular, semiBold] = await Promise.all([
    loadFont("GeistMono-Regular.ttf"),
    loadFont("GeistMono-SemiBold.ttf"),
  ]);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          backgroundColor: BASE,
          fontFamily: "Geist Mono",
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: -140,
            right: -60,
            width: 560,
            height: 560,
            backgroundImage:
              "radial-gradient(circle at center, rgba(200,241,53,0.12) 0%, rgba(200,241,53,0) 62%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: -180,
            left: 120,
            width: 520,
            height: 520,
            backgroundImage:
              "radial-gradient(circle at center, rgba(245,200,66,0.09) 0%, rgba(245,200,66,0) 60%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 32,
            left: 32,
            right: 32,
            bottom: 32,
            border: "1px solid rgba(200,241,53,0.16)",
            borderRadius: 16,
          }}
        />

        <div
          style={{
            display: "flex",
            width: "100%",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 96px",
            gap: 48,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", maxWidth: 660 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div
                style={{
                  width: 34,
                  height: 1,
                  backgroundImage: `linear-gradient(90deg, rgba(200,241,53,0), ${LIME})`,
                }}
              />
              <div
                style={{
                  fontSize: 20,
                  letterSpacing: 7,
                  color: LIME,
                }}
              >
                AGENT DNA
              </div>
              <div
                style={{
                  width: 120,
                  height: 1,
                  backgroundImage: `linear-gradient(90deg, ${LIME}, rgba(200,241,53,0))`,
                }}
              />
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                marginTop: 30,
                fontSize: 53,
                fontWeight: 600,
                lineHeight: 1.16,
                letterSpacing: 1,
              }}
            >
              <div style={{ color: INK }}>Every agent has DNA.</div>
              <div
                style={{
                  backgroundImage: `linear-gradient(100deg, ${LIME} 0%, ${GOLD} 100%)`,
                  backgroundClip: "text",
                  color: "transparent",
                }}
              >
                Read it before you commit money.
              </div>
            </div>

            <div
              style={{
                marginTop: 28,
                fontSize: 22,
                lineHeight: 1.5,
                color: MUTED,
                maxWidth: 600,
              }}
            >
              Onchain behavioral fingerprints and token safety scores for the
              OKX.AI marketplace.
            </div>

            <div style={{ display: "flex", gap: 14, marginTop: 40 }}>
              <Chip>X LAYER</Chip>
              <Chip>X402 PAID</Chip>
              <Chip>OKX.AI</Chip>
            </div>
          </div>

          <div style={{ display: "flex", flexShrink: 0 }}>
            <RadarMark width={392} />
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        {
          name: "Geist Mono",
          data: regular,
          weight: 400,
          style: "normal",
        },
        {
          name: "Geist Mono",
          data: semiBold,
          weight: 600,
          style: "normal",
        },
      ],
    },
  );
}
