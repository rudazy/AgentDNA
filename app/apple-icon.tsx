/**
 * Apple touch icon, 180x180. Full-bleed dark tile (iOS applies its own mask),
 * same hex radar mark as app/icon.svg at home-screen scale.
 */
import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#0a0a0a",
        }}
      >
        <svg width={132} height={132} viewBox="0 0 32 32">
          <defs>
            <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#c8f135" />
              <stop offset="100%" stopColor="#f5c842" />
            </linearGradient>
          </defs>
          <polygon
            points="16,4.5 25.96,10.25 25.96,21.75 16,27.5 6.04,21.75 6.04,10.25"
            fill="none"
            stroke="rgba(200,241,53,0.28)"
            strokeWidth="1"
          />
          <polygon
            points="16,5.07 22.18,12.44 24.76,21.06 16,22.33 8.03,20.6 9.03,11.98"
            fill="rgba(200,241,53,0.16)"
            stroke="url(#g)"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <circle cx="16" cy="5.07" r="1.4" fill="#c8f135" />
          <circle cx="24.76" cy="21.06" r="1.4" fill="#f5c842" />
          <circle cx="8.03" cy="20.6" r="1.4" fill="#c8f135" />
        </svg>
      </div>
    ),
    size,
  );
}
