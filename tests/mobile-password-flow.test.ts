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

  it("renders home scene immediately without waiting for bootstrap requests", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith("/snapshot.json")) {
        await new Promise((resolve) => window.setTimeout(resolve, 3000));
        return new Response(JSON.stringify({ fresh: [], archive: [] }), { status: 200 });
      }

      if (url.endsWith("/api/bootstrap") && (!init?.method || init.method === "GET")) {
        await new Promise((resolve) => window.setTimeout(resolve, 3000));
        return new Response(JSON.stringify(bootstrapPayload), { status: 200 });
      }

      if (url.endsWith("/api/bootstrap") && init?.method === "POST") {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    vi.stubGlobal("fetch", fetchMock);

    const app = new AppController(document.querySelector("#app") as HTMLDivElement);
    const startPromise = app.start();

    expect(document.querySelector(".home-shell")).toBeTruthy();
    expect(document.querySelector(".donate-block")).toBeTruthy();

    await vi.advanceTimersByTimeAsync(3100);
    await startPromise;
  });

  it("focuses the hidden password input on mobile-like tap inside password scene", async () => {
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

      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    vi.stubGlobal("fetch", fetchMock);

    const app = new AppController(document.querySelector("#app") as HTMLDivElement);
    await app.start();

    (document.querySelector(".home-shell") as HTMLElement).click();
    await vi.advanceTimersByTimeAsync(280);

    const shell = document.querySelector(".password-shell") as HTMLElement;
    const input = document.querySelector(".password-hidden-input") as HTMLTextAreaElement;
    shell.dispatchEvent(new Event("touchend", { bubbles: true, cancelable: true }));

    expect(document.activeElement).toBe(input);
  });

  it("builds telegram app deep link for the tg button", async () => {
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

      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    vi.stubGlobal("fetch", fetchMock);

    const app = new AppController(document.querySelector("#app") as HTMLDivElement);
    await app.start();

    expect((app as any).telegramChannelDeepLink("https://t.me/abihsgelo"))
      .toBe("tg://resolve?domain=abihsgelo");
  });

  it("tries telegram app first and falls back to web in a new tab after timeout", async () => {
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

      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    vi.stubGlobal("fetch", fetchMock);

    const app = new AppController(document.querySelector("#app") as HTMLDivElement);
    await app.start();

    const dispatchSpy = vi.spyOn(app as any, "dispatchTelegramDeepLink").mockImplementation(() => undefined);
    const openTabSpy = vi.spyOn(app as any, "openUrlInNewTab").mockImplementation(() => undefined);

    (app as any).openTelegramChannel("https://t.me/abihsgelo");

    expect(dispatchSpy).toHaveBeenCalledWith("tg://resolve?domain=abihsgelo");
    expect(openTabSpy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(800);

    expect(openTabSpy).toHaveBeenCalledWith("https://t.me/abihsgelo");
  });

  it("does not fall back to telegram website if the page becomes hidden after deep link attempt", async () => {
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

      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    vi.stubGlobal("fetch", fetchMock);

    let visibility: DocumentVisibilityState = "visible";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibility
    });
    vi.spyOn(document, "hasFocus").mockReturnValue(false);

    const app = new AppController(document.querySelector("#app") as HTMLDivElement);
    await app.start();

    const openTabSpy = vi.spyOn(app as any, "openUrlInNewTab").mockImplementation(() => undefined);
    (app as any).openTelegramChannel("https://t.me/abihsgelo");

    visibility = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(800);

    expect(openTabSpy).not.toHaveBeenCalled();
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

  it("returns from admin panel to home via close button without reload", async () => {
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
        return new Response(JSON.stringify({ ok: true, mode: "admin_mode", token: "token-close-admin" }), { status: 200 });
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
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(220);
    await Promise.resolve();

    expect(document.querySelector(".admin-shell")).toBeTruthy();

    (document.querySelector(".panel-close") as HTMLButtonElement).click();
    await vi.advanceTimersByTimeAsync(220);
    await Promise.resolve();

    expect(document.querySelector(".home-shell")).toBeTruthy();
    expect(document.querySelector(".admin-shell")).toBeFalsy();
  });

  it("renders compact admin structure with access open by default", async () => {
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
        return new Response(JSON.stringify({ ok: true, mode: "admin_mode", token: "token-admin-layout" }), { status: 200 });
      }

      if (url.endsWith("/api/admin/bootstrap")) {
        return new Response(JSON.stringify({
          mode: "admin_mode",
          modes: [
            { id: "home_mode", label: "Home", accessState: "public", isEnabled: true, isDefaultPublic: true },
            { id: "proxies_mode", label: "Proxies", accessState: "locked", isEnabled: true, isDefaultPublic: false },
            { id: "admin_mode", label: "Admin", accessState: "locked", isEnabled: true, isDefaultPublic: false }
          ],
          wallets: [],
          accessRules: [],
          settings: { "donate.visible": true },
          health: { worker: "ok", bootstrapMessage: "admin bootstrap ready" },
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
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(260);
    await Promise.resolve();

    const sections = [...document.querySelectorAll(".admin-section")] as HTMLDetailsElement[];
    expect(sections).toHaveLength(4);
    expect(sections[0].open).toBe(true);
    expect(sections[1].open).toBe(false);
    expect(sections[2].open).toBe(false);
    expect(sections[3].open).toBe(false);
  });

  it("returns from proxies panel to home via close button without reload", async () => {
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
        return new Response(JSON.stringify({ ok: true, mode: "proxies_mode", token: "token-close-proxies" }), { status: 200 });
      }

      if (url.endsWith("/api/modes/proxies_mode")) {
        return new Response(JSON.stringify({
          mode: "proxies_mode",
          title: "последние 2 свежих прокси",
          lastSuccessfulRefreshAt: "2026-04-09 14:55:00",
          isStale: false,
          staleReason: null,
          fresh: [
            { id: "proxy-2", proxyNumber: 2, proxyUrl: "tg://proxy?server=2", postedAt: "2026-04-09T14:55:00+00:00", sourceMessageId: "2" },
            { id: "proxy-1", proxyNumber: 1, proxyUrl: "tg://proxy?server=1", postedAt: "2026-04-09T14:45:00+00:00", sourceMessageId: "1" }
          ],
          archive: []
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
    input.value = "proxy-pass";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(260);
    await Promise.resolve();

    expect(document.querySelector(".proxies-shell")).toBeTruthy();

    (document.querySelector(".panel-close") as HTMLButtonElement).click();
    await vi.advanceTimersByTimeAsync(220);
    await Promise.resolve();

    expect(document.querySelector(".home-shell")).toBeTruthy();
    expect(document.querySelector(".proxies-shell")).toBeFalsy();
  });

  it("opens proxies panel already filled with proxy cards when payload preloads during auth success", async () => {
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
        return new Response(JSON.stringify({ ok: true, mode: "proxies_mode", token: "token-ready-proxies" }), { status: 200 });
      }

      if (url.endsWith("/api/modes/proxies_mode")) {
        return new Response(JSON.stringify({
          mode: "proxies_mode",
          title: "последние 2 свежих прокси",
          lastSuccessfulRefreshAt: "2026-04-09 14:55:00",
          isStale: false,
          staleReason: null,
          fresh: [
            { id: "proxy-2", proxyNumber: 2, proxyUrl: "tg://proxy?server=2", postedAt: "2026-04-09T14:55:00+00:00", sourceMessageId: "2" },
            { id: "proxy-1", proxyNumber: 1, proxyUrl: "tg://proxy?server=1", postedAt: "2026-04-09T14:45:00+00:00", sourceMessageId: "1" }
          ],
          archive: []
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
    input.value = "proxy-pass";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(260);
    await Promise.resolve();

    expect(document.querySelector(".proxies-shell")).toBeTruthy();
    expect(document.querySelectorAll(".proxy-card").length).toBe(2);
    expect(document.querySelector(".proxies-empty")).toBeFalsy();
  });

  it("submits full wallet editing payload from admin", async () => {
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
        return new Response(JSON.stringify({ ok: true, mode: "admin_mode", token: "token-wallets" }), { status: 200 });
      }

      if (url.endsWith("/api/admin/bootstrap")) {
        return new Response(JSON.stringify({
          mode: "admin_mode",
          modes: [],
          wallets: [
            {
              id: "ton",
              network: "ton",
              title: "usdt ton",
              address: "old-address",
              qrPayload: "old-qr",
              warningText: "old-warning",
              isEnabled: true,
              sortOrder: 1
            }
          ],
          accessRules: [],
          settings: { "donate.visible": true },
          health: { worker: "ok", bootstrapMessage: "admin bootstrap ready" },
          audit: []
        }), { status: 200 });
      }

      if (url.includes("/api/admin/wallets/ton")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
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
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(260);
    await Promise.resolve();

    const walletSection = document.querySelectorAll<HTMLDetailsElement>(".admin-section")[2];
    walletSection.open = true;
    walletSection.dispatchEvent(new Event("toggle"));
    await Promise.resolve();

    const forms = [...document.querySelectorAll("form")];
    const walletForm = forms.find((form) => form.querySelector('input[name="qrPayload"]')) as HTMLFormElement;
    expect(walletForm).toBeTruthy();

    (walletForm.querySelector('input[name="title"]') as HTMLInputElement).value = "ton usdt";
    (walletForm.querySelector('input[name="address"]') as HTMLInputElement).value = "new-address";
    (walletForm.querySelector('input[name="qrPayload"]') as HTMLInputElement).value = "new-qr";
    (walletForm.querySelector('input[name="warningText"]') as HTMLInputElement).value = "new-warning";
    (walletForm.querySelector('input[name="sortOrder"]') as HTMLInputElement).value = "7";
    (walletForm.querySelector('input[name="isEnabled"]') as HTMLInputElement).checked = false;
    walletForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await Promise.resolve();

    const walletCall = fetchMock.mock.calls.find(([request]) => String(request).includes("/api/admin/wallets/ton"));
    expect(walletCall).toBeTruthy();
    const body = JSON.parse(String((walletCall?.[1] as RequestInit).body));
    expect(body).toEqual({
      title: "ton usdt",
      address: "new-address",
      qrPayload: "new-qr",
      warningText: "new-warning",
      sortOrder: 7,
      isEnabled: false
    });
  });
});
