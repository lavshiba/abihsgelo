// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppController } from "../frontend/src/app";

const bootstrapPayload = {
  siteName: "abihsgelo",
  defaultPublicMode: "home_mode",
  donateVisible: true,
  telegramUrl: "https://t.me/abihsgelo",
  wallets: [],
  yearLabel: "2026",
  snapshotAgeSeconds: null,
  workerAvailable: true,
  panicMode: false
} as const;

describe("password flow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="app"></div>';
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("submits on mobile insertLineBreak action", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith("/snapshot.json")) {
        return new Response(JSON.stringify({ fresh: [], archive: [] }), { status: 200 });
      }

      if (url.endsWith("/api/bootstrap") && (!init?.method || init.method === "GET")) {
        return new Response(JSON.stringify(bootstrapPayload), { status: 200 });
      }

      if (url.endsWith("/api/bootstrap") && init?.method === "POST") {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      if (url.endsWith("/api/auth/enter")) {
        return new Response(JSON.stringify({ ok: true, mode: "admin_mode", token: "token-1" }), { status: 200 });
      }

      if (url.endsWith("/api/admin/bootstrap")) {
        return new Response(JSON.stringify({
          mode: "admin_mode",
          modes: [],
          wallets: [],
          accessRules: [],
          settings: {},
          health: {},
          audit: []
        }), { status: 200 });
      }

      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    vi.stubGlobal("fetch", fetchMock);

    const app = new AppController(document.querySelector("#app") as HTMLDivElement);
    await app.start();

    (document.querySelector(".home-shell") as HTMLElement).click();
    await vi.advanceTimersByTimeAsync(280);

    const input = document.querySelector(".password-hidden-input") as HTMLTextAreaElement;
    expect(input).toBeTruthy();

    input.value = "olegadmin";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await Promise.resolve();

    const beforeInput = new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      inputType: "insertLineBreak",
      data: "\n"
    });
    input.dispatchEvent(beforeInput);
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/auth/enter"),
      expect.objectContaining({ method: "POST" })
    );
  });

  it("submits when mobile keyboard inserts a newline into hidden textarea", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith("/snapshot.json")) {
        return new Response(JSON.stringify({ fresh: [], archive: [] }), { status: 200 });
      }

      if (url.endsWith("/api/bootstrap") && (!init?.method || init.method === "GET")) {
        return new Response(JSON.stringify(bootstrapPayload), { status: 200 });
      }

      if (url.endsWith("/api/bootstrap") && init?.method === "POST") {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      if (url.endsWith("/api/auth/enter")) {
        return new Response(JSON.stringify({ ok: false }), { status: 200 });
      }

      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    vi.stubGlobal("fetch", fetchMock);

    const app = new AppController(document.querySelector("#app") as HTMLDivElement);
    await app.start();

    (document.querySelector(".home-shell") as HTMLElement).click();
    await vi.advanceTimersByTimeAsync(280);

    const input = document.querySelector(".password-hidden-input") as HTMLTextAreaElement;
    input.value = "olegadmin\n";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await Promise.resolve();

    expect(input.value).toBe("olegadmin");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/auth/enter"),
      expect.objectContaining({ method: "POST" })
    );
  });

  it("submits on desktop Enter and opens admin mode", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith("/snapshot.json")) {
        return new Response(JSON.stringify({ fresh: [], archive: [] }), { status: 200 });
      }

      if (url.endsWith("/api/bootstrap") && (!init?.method || init.method === "GET")) {
        return new Response(JSON.stringify(bootstrapPayload), { status: 200 });
      }

      if (url.endsWith("/api/bootstrap") && init?.method === "POST") {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      if (url.endsWith("/api/auth/enter")) {
        return new Response(JSON.stringify({ ok: true, mode: "admin_mode", token: "desktop-token" }), { status: 200 });
      }

      if (url.endsWith("/api/admin/bootstrap")) {
        return new Response(JSON.stringify({
          mode: "admin_mode",
          modes: [],
          wallets: [],
          accessRules: [],
          settings: {},
          health: {},
          audit: []
        }), { status: 200 });
      }

      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    vi.stubGlobal("fetch", fetchMock);

    const app = new AppController(document.querySelector("#app") as HTMLDivElement);
    await app.start();

    (document.querySelector(".home-shell") as HTMLElement).click();
    await vi.advanceTimersByTimeAsync(280);

    const input = document.querySelector(".password-hidden-input") as HTMLTextAreaElement;
    input.value = "olegadmin";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await Promise.resolve();

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(340);
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/auth/enter"),
      expect.objectContaining({ method: "POST" })
    );
    expect(document.querySelector(".admin-shell")).toBeTruthy();
  });

  it("does not fall back to home if successful auth is slower than the visual password timeout", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith("/snapshot.json")) {
        return new Response(JSON.stringify({ fresh: [], archive: [] }), { status: 200 });
      }

      if (url.endsWith("/api/bootstrap") && (!init?.method || init.method === "GET")) {
        return new Response(JSON.stringify(bootstrapPayload), { status: 200 });
      }

      if (url.endsWith("/api/bootstrap") && init?.method === "POST") {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      if (url.endsWith("/api/auth/enter")) {
        await new Promise((resolve) => window.setTimeout(resolve, 4500));
        return new Response(JSON.stringify({ ok: true, mode: "admin_mode", token: "slow-token" }), { status: 200 });
      }

      if (url.endsWith("/api/admin/bootstrap")) {
        return new Response(JSON.stringify({
          mode: "admin_mode",
          modes: [],
          wallets: [],
          accessRules: [],
          settings: {},
          health: {},
          audit: []
        }), { status: 200 });
      }

      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    vi.stubGlobal("fetch", fetchMock);

    const app = new AppController(document.querySelector("#app") as HTMLDivElement);
    await app.start();

    (document.querySelector(".home-shell") as HTMLElement).click();
    await vi.advanceTimersByTimeAsync(280);

    const input = document.querySelector(".password-hidden-input") as HTMLTextAreaElement;
    input.value = "olegadmin";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await Promise.resolve();

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await Promise.resolve();

    await vi.advanceTimersByTimeAsync(4600);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(160);
    await Promise.resolve();

    expect(document.querySelector(".admin-shell")).toBeTruthy();
    expect(document.querySelector(".home-shell")).toBeFalsy();
  });
});
