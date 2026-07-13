# Agent DNA Demo Script (90 seconds)

No em dashes. Timed blocks for a screen recording of the live playground and pricing section.

---

## 0:00 to 0:10. Problem

**Visual:** Landing wordmark and headline.

**Voiceover:**

"Agents hire other agents blind. They swap tokens blind. Agent DNA is the trust layer: one engine, two scans, live on X Layer for the OKX.AI marketplace."

---

## 0:10 to 0:45. Agent Scan playground

**Visual:** Open playground. Toggle Agent Scan. Paste a real agent or active X Layer wallet address. Click Run scan. Wait for the hexagonal radar, grade in gold, delivery probability.

**Voiceover:**

"Here is Agent Scan. We read onchain behavioral history and build a DNA fingerprint: reliability, consistency, longevity, risk appetite, activity, and counterparty diversity."

"Grade and confidence stay honest. Thin history means low confidence, not a fake A. Delivery probability is a heuristic estimate from reliability, consistency, and longevity, so agents can vet a counterparty before they commit money."

**On screen callouts (optional captions):**

- Radar draws once
- Grade
- Delivery probability (heuristic estimate)

---

## 0:45 to 1:10. Token Scan of a risky token

**Visual:** Toggle Token Scan. Paste a token that should flag (unverified, new, or high holder concentration). Show score, riskLevel, and flags list.

**Voiceover:**

"Same engine, Token Scan. Safety score from verification, holder concentration, age, transfer patterns, and supply mechanics. Flags call out red reasons in plain language so an agent can refuse a swap or LP before it hurts."

---

## 1:10 to 1:30. Endpoints, pricing, close

**Visual:** Scroll to How agents call this. Show POST paths, prices, copy buttons.

**Voiceover:**

"Agents call POST /api/scan/agent at five cents USDT0, and POST /api/scan/token at one cent, paid per call through x402 on X Layer. Unpaid calls get 402."

"Agent DNA, the trust layer for the agent economy, live on OKX.AI."

**End card (2 seconds):**

Agent DNA  
Ludarep  
trustgated.xyz

---

## Prep checklist

- [ ] DEMO_MODE=true on the deploy used for the video
- [ ] OKLINK_API_KEY set so scans return real data
- [ ] Pick one active agent/wallet address with enough history for a visible radar
- [ ] Pick one obviously risky token (unverified or concentrated) for flags
- [ ] Disable browser blue highlights / dark theme already default
- [ ] Capture 1080p, mono UI readable
