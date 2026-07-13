import { HowAgentsCall } from "@/components/HowAgentsCall";
import { HexSeal, SectionLabel } from "@/components/Ornament";
import { MotionBackground } from "@/components/MotionBackground";
import { Playground } from "@/components/Playground";

export default function HomePage() {
  return (
    <main className="relative min-h-dvh overflow-x-hidden">
      <MotionBackground />

      <div
        aria-hidden
        className="pointer-events-none fixed inset-y-0 left-0 z-[1] hidden w-px bg-gradient-to-b from-transparent via-lime/35 to-transparent md:block"
      />
      <div
        aria-hidden
        className="pointer-events-none fixed inset-y-0 right-0 z-[1] hidden w-px bg-gradient-to-b from-transparent via-gold/30 to-transparent md:block"
      />

      <div className="relative z-10">
        <header className="mx-auto max-w-content px-4 pb-6 pt-[max(1.25rem,env(safe-area-inset-top))] sm:px-5 sm:pb-8 sm:pt-16 md:pt-20">
          <div className="relative glass-panel overflow-hidden px-4 py-8 sm:px-8 sm:py-12 md:px-12 md:py-14">
            <div
              aria-hidden
              className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-lime/10 blur-3xl"
            />
            <div
              aria-hidden
              className="pointer-events-none absolute -bottom-12 left-1/4 h-36 w-36 rounded-full bg-gold/10 blur-3xl"
            />

            <div className="relative flex flex-col items-stretch gap-8 md:grid md:grid-cols-[1fr_auto] md:items-center md:gap-10">
              <div className="min-w-0">
                <div className="mb-3 flex flex-wrap gap-2">
                  <span className="chip">X Layer</span>
                  <span className="chip">x402 paid</span>
                  <span className="chip">OKX.AI</span>
                </div>
                <SectionLabel>Agent DNA</SectionLabel>
                <h1 className="hero-title mt-4 max-w-3xl font-mono text-[1.65rem] font-medium leading-[1.15] tracking-wideish text-ink xs:text-3xl sm:mt-5 sm:text-4xl md:text-5xl md:leading-[1.08]">
                  Every agent has DNA.
                  <span className="hero-accent mt-1 block sm:mt-2">
                    Read it before you commit money.
                  </span>
                </h1>
                <p className="mt-4 max-w-xl font-mono text-sm leading-relaxed text-muted sm:mt-5 sm:text-base">
                  Onchain behavioral fingerprints and token safety scores for
                  the OKX.AI marketplace. One engine, two scans, pay per call in
                  USDT0 on X Layer.
                </p>
                <div className="mt-6 flex flex-col gap-3 sm:mt-8 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
                  <a href="#playground" className="fancy-btn no-underline">
                    Open playground
                  </a>
                  <a
                    href="#how"
                    className="touch-link justify-center font-mono text-xs uppercase tracking-[0.16em] text-muted underline-offset-4 hover:text-gold sm:justify-start"
                  >
                    API & pricing
                  </a>
                </div>
              </div>

              <HexSeal className="float-seal mx-auto hidden h-24 w-24 opacity-95 sm:block md:h-36 md:w-36" />
            </div>
          </div>
        </header>

        <Playground />
        <HowAgentsCall />

        <footer className="border-t border-lime/10 py-8 pb-[max(2rem,env(safe-area-inset-bottom))] sm:py-12">
          <div className="mx-auto flex max-w-content flex-col gap-4 px-4 font-mono text-xs text-muted sm:px-5 md:flex-row md:items-center md:justify-between">
            <p className="tracking-[0.16em] uppercase text-lime/70">
              Agent DNA
            </p>
            <div className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:gap-5">
              <a
                href="https://www.trustgated.xyz"
                target="_blank"
                rel="noopener noreferrer"
                className="touch-link hover:text-lime"
              >
                trustgated.xyz
              </a>
              <a
                href="https://github.com/rudazy"
                target="_blank"
                rel="noopener noreferrer"
                className="touch-link hover:text-lime"
              >
                github.com/rudazy
              </a>
              <a
                href="https://github.com/rudazy/AgentDNA"
                target="_blank"
                rel="noopener noreferrer"
                className="touch-link hover:text-gold"
              >
                AgentDNA repo
              </a>
            </div>
          </div>
        </footer>
      </div>
    </main>
  );
}
