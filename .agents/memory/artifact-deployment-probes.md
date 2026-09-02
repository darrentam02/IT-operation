---
name: Artifact deployment probes
description: Non-obvious health-check behavior for path-mounted API artifacts on Replit.
---

When an API artifact is mounted at a path such as `/api`, make the mounted root respond with a lightweight HTTP 200 health response in addition to any explicit health endpoint such as `/api/healthz`.

**Why:** Replit artifact promotion may probe the service mount path (`/api`) even when `artifact.toml` declares a custom startup path. A missing mounted-root route can produce promotion health-check failures even though the explicit health endpoint works.

**How to apply:** For path-mounted API artifacts, verify both the configured startup path and the artifact mount root through the local proxy before publishing.