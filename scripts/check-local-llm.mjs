const baseUrl = (process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/+$/, "");
const model = process.env.OLLAMA_MODEL || "hamyar-security";

try {
  const response = await fetch(`${baseUrl}/api/tags`, {
    signal: AbortSignal.timeout(5_000)
  });

  if (!response.ok) {
    console.error(`Ollama returned HTTP ${response.status}.`);
    process.exitCode = 1;
  } else {
    const data = await response.json();
    const names = (data.models || []).map((item) => item.name || item.model).filter(Boolean);
    const normalise = (value) => String(value).replace(/:latest$/, "");
    const installed = names.some((name) => normalise(name) === normalise(model));

    if (installed) {
      console.log(`Local LLM is ready: ${model} at ${baseUrl}`);
      console.log("Low, medium and high reasoning modes use this CPU-safe model with different reasoning budgets.");
    } else {
      console.error(`Ollama is running, but model "${model}" is not installed.`);
      console.error("Create it with: ollama create hamyar-security -f ollama/Modelfile");
      process.exitCode = 1;
    }
  }
} catch {
  console.error(`Ollama is not reachable at ${baseUrl}.`);
  console.error("Start Ollama, then run this check again.");
  process.exitCode = 1;
}
