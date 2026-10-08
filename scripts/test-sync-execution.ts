import fs from "fs";
import path from "path";

// Load environment variables from .env.local
const envFile = fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8");
envFile.split("\n").forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    let value = (match[2] || "").replace(/\r/g, "").trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
});

// Dynamic import after env vars are populated
async function main() {
  const { startWooCatalogSync, getWooCatalogSyncRun } = await import("../src/lib/catalog/woocommerce");
  console.log("Triggering WooCommerce Catalog Sync...");
  const result = await startWooCatalogSync(false);
  console.log("Sync trigger result:", result);
  
  if (!result.accepted) {
    console.error("Sync not accepted.");
    process.exit(1);
  }
  
  const runId = result.runId;
  let seenLogCount = 0;
  
  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  
  while (true) {
    await sleep(1000);
    const run = await getWooCatalogSyncRun(runId);
    if (!run) {
      console.log("Run not found.");
      break;
    }
    
    console.log(`\n--- Status Update (ID: ${run.id}) ---`);
    console.log(`Status: ${run.status}`);
    console.log(`Stage: ${run.stage}`);
    console.log(`Progress: ${run.progressPercent}% (${run.progressCurrent}/${run.progressTotal})`);
    
    if (run.logs && run.logs.length > seenLogCount) {
      console.log("New Logs:");
      const newLogs = run.logs.slice(seenLogCount);
      newLogs.forEach((l: { level: string; message: string }) => {
        console.log(`  [${l.level}] ${l.message}`);
      });
      seenLogCount = run.logs.length;
    }
    
    if (run.status !== "queued" && run.status !== "running") {
      console.log("\nSync Completed!");
      console.log("Final Result:", run.result);
      console.log("Error details:", run.error);
      break;
    }
  }
  
  process.exit(0);
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
