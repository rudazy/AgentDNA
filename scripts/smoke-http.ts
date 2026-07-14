/**
 * Smoke local Next routes. Does not print secrets.
 */
async function main(): Promise<void> {
  const base = process.env.SMOKE_BASE ?? "http://localhost:3000";
  const address = "0x779Ded0c9e1022225f8E0630b35a9b54bE713736";

  console.log("GET /api/health");
  const health = await fetch(`${base}/api/health`);
  const healthBody = await health.json();
  console.log(
    `  status=${health.status} demoMode=${healthBody.demoMode} service=${healthBody.service}`,
  );

  console.log("POST /api/playground/scan (same-origin)");
  const play = await fetch(`${base}/api/playground/scan`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: base,
    },
    body: JSON.stringify({ address, scan: "agent" }),
  });
  const playText = await play.text();
  console.log(`  status=${play.status} body=${playText.slice(0, 280)}`);

  console.log("POST /api/scan/agent (unpaid)");
  const paid = await fetch(`${base}/api/scan/agent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address }),
  });
  const paidText = await paid.text();
  console.log(`  status=${paid.status} body=${paidText.slice(0, 280)}`);
}

main().catch((e) => {
  console.error("HTTP_SMOKE_FAIL", e instanceof Error ? e.message : e);
  process.exit(1);
});
