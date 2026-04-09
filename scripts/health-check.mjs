const endpoints = ["http://127.0.0.1:8787/healthz", "http://127.0.0.1:5173/snapshot.json"];

for (const endpoint of endpoints) {
  try {
    const response = await fetch(endpoint);
    if (endpoint.endsWith("/healthz")) {
      const payload = await response.json().catch(() => null);
      const ok = response.ok && payload?.ok === true;
      console.log(`${endpoint} -> ${response.status} ${payload?.bootstrap?.message ?? ""}`.trim());
      if (!ok) {
        process.exitCode = 1;
      }
      continue;
    }

    console.log(`${endpoint} -> ${response.status}`);
    if (!response.ok) {
      process.exitCode = 1;
    }
  } catch {
    console.log(`${endpoint} -> failed`);
    process.exitCode = 1;
  }
}
