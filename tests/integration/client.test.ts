import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createTestApp } from "../tools.ts";

describe("Клиент, статические файлы", () => {
  it("GET / отдаёт HTML страницу", async () => {
    const { app } = createTestApp();
    await app.start();

    const port = app.getPort();
    const response = await fetch(`http://localhost:${port}/`, {
      signal: AbortSignal.timeout(5000),
    });

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type")!, /text\/html/);

    const body = await response.text();
    assert.match(body, /Web Push/);

    await app.stop();
  });

  it("GET /sw.js отдаёт JavaScript файл", async () => {
    const { app } = createTestApp();
    await app.start();

    const port = app.getPort();
    const response = await fetch(`http://localhost:${port}/sw.js`, {
      signal: AbortSignal.timeout(5000),
    });

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type")!, /javascript/);

    const body = await response.text();
    assert.match(body, /push/i);

    await app.stop();
  });
});
