const endpoints = ["http://127.0.0.1:8787/healthz", "http://127.0.0.1:5173/snapshot.json"];

for (const endpoint of endpoints) {
  try {
    const response = await fetch(endpoint);
    console.log(`${endpoint} -> ${response.status}`);
  } catch {
    console.log(`${endpoint} -> failed`);
    process.exitCode = 1;
  }
}
