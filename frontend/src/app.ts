import QRCode from "qrcode";
import { buildProxyTitle } from "@abihsgelo/shared";
import type {
  AccessRuleSummary,
  AdminPayload,
  BootstrapPayload,
  ModeSummary,
  ProxiesPayload,
  ProxyItem,
  WalletEntry
} from "@abihsgelo/shared";

type SceneState = "home" | "password" | "mode";
type PasswordVisualState = "clearing" | "cursor" | "typing" | "success" | "fail" | "timeout";
type ScrollTarget = "archive" | "fresh" | null;

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, "") ?? "";
const PASSWORD_TIMEOUT_MS = 3800;
const TELEGRAM_FALLBACK_DELAY_MS = 720;

interface SessionState {
  token: string | null;
  mode: string | null;
}

const FALLBACK_BOOTSTRAP: BootstrapPayload = {
  siteName: "abihsgelo",
  defaultPublicMode: "home_mode",
  donateVisible: true,
  telegramUrl: "https://t.me/abihsgelo",
  wallets: [
    { id: "ton", network: "ton", title: "usdt ton", address: "set-in-admin", qrPayload: "set-in-admin", warningText: "send only usdt on ton network", isEnabled: true, sortOrder: 1 },
    { id: "trc20", network: "trc20", title: "usdt trc20", address: "set-in-admin", qrPayload: "set-in-admin", warningText: "send only usdt on trc20 network", isEnabled: true, sortOrder: 2 },
    { id: "erc20", network: "erc20", title: "usdt erc20", address: "set-in-admin", qrPayload: "set-in-admin", warningText: "send only usdt on erc20 network", isEnabled: true, sortOrder: 3 },
    { id: "sol", network: "sol", title: "usdt sol", address: "set-in-admin", qrPayload: "set-in-admin", warningText: "send only usdt on sol network", isEnabled: true, sortOrder: 4 }
  ],
  yearLabel: "2026",
  snapshotAgeSeconds: null,
  workerAvailable: false,
  panicMode: false
};

export class AppController {
  private readonly root: HTMLDivElement;
  private bootstrap: BootstrapPayload = FALLBACK_BOOTSTRAP;
  private scene: SceneState = "home";
  private session: SessionState = { token: null, mode: null };
  private homeDissolving = false;
  private passwordBuffer = "";
  private passwordVisualState: PasswordVisualState = "cursor";
  private passwordTimeoutHandle: number | null = null;
  private passwordInput: HTMLTextAreaElement | null = null;
  private passwordVisual: HTMLDivElement | null = null;
  private passwordCompositionActive = false;
  private passwordFocusHandles: number[] = [];
  private passwordSubmitPending = false;
  private passwordGlobalKeyHandler: ((event: KeyboardEvent) => void) | null = null;
  private transitionHandles: number[] = [];
  private walletOverlay: WalletEntry | null = null;
  private copiedWalletId: string | null = null;
  private snapshot: { fresh: ProxyItem[]; archive: ProxyItem[] } = { fresh: [], archive: [] };
  private archiveOpen = false;
  private currentProxiesPayload: ProxiesPayload | null = null;
  private queuedProxiesPayload: ProxiesPayload | null = null;
  private proxiesLoading = false;
  private pollingHandle: number | null = null;
  private highlightProxyId: string | null = null;
  private highlightHandle: number | null = null;
  private pendingScrollTarget: ScrollTarget = null;

  public constructor(root: HTMLDivElement) {
    this.root = root;
  }

  public async start(): Promise<void> {
    this.snapshot = await this.loadSnapshot();
    this.bootstrap = await this.fetchJson<BootstrapPayload>(this.apiUrl("/api/bootstrap")).catch(() => FALLBACK_BOOTSTRAP);
    this.installPasswordGlobalHandlers();
    void this.track("site_open");
    this.render();
  }

  private async loadSnapshot(): Promise<{ fresh: ProxyItem[]; archive: ProxyItem[] }> {
    try {
      const response = await fetch("/snapshot.json", { cache: "no-store" });
      if (!response.ok) {
        return { fresh: [], archive: [] };
      }

      const payload = (await response.json()) as { fresh: ProxyItem[]; archive: ProxyItem[] };
      return { fresh: payload.fresh ?? [], archive: payload.archive ?? [] };
    } catch {
      return { fresh: [], archive: [] };
    }
  }

  private render(): void {
    this.passwordInput = null;
    this.passwordVisual = null;
    this.root.innerHTML = "";
    this.root.className = `scene-root scene-${this.scene}${this.homeDissolving ? " scene-home-dissolving" : ""}`;

    if (this.scene === "home") {
      this.stopPolling();
      this.root.append(this.renderHomeScene());
    } else if (this.scene === "password") {
      this.stopPolling();
      this.root.append(this.renderPasswordScene());
    } else if (this.session.mode === "proxies_mode") {
      this.root.append(this.renderProxiesScene());
      this.startPolling();
      if (!this.currentProxiesPayload && !this.proxiesLoading) {
        void this.ensureProxiesPayload(true);
      }
    } else if (this.session.mode === "admin_mode") {
      this.stopPolling();
      void this.renderAdminScene();
    }

    if (this.walletOverlay) {
      void this.root.append(this.renderWalletOverlay(this.walletOverlay));
    }

    this.handlePostRender();
  }

  private handlePostRender(): void {
    if (this.scene === "password") {
      this.schedulePasswordFocus();
    }

    if (!this.pendingScrollTarget) {
      return;
    }

    const target = this.pendingScrollTarget;
    this.pendingScrollTarget = null;

    queueMicrotask(() => {
      const selector = target === "archive" ? ".archive-zone" : ".fresh-grid";
      this.root.querySelector<HTMLElement>(selector)?.scrollIntoView({
        behavior: "smooth",
        block: target === "archive" ? "start" : "center"
      });
    });
  }

  private renderHomeScene(): HTMLElement {
    const shell = document.createElement("main");
    shell.className = `home-shell${this.homeDissolving ? " is-dissolving" : ""}`;
    shell.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      if (this.homeDissolving || target.closest("[data-interactive='true']")) {
        return;
      }

      this.enterPasswordScene();
    });

    shell.innerHTML = `
      <section class="home-top-stack">
        <p class="home-title">oleg shiba // abihsgelo</p>
        <a class="tg-button" data-interactive="true" href="${this.bootstrap.telegramUrl}" aria-label="Telegram" rel="noreferrer">
          <span class="tg-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false">
              <path d="M19.77 4.43 3.86 10.56c-1.09.44-1.08 1.05-.2 1.32l4.08 1.27 1.58 5.03c.19.53.1.74.66.74.43 0 .62-.2.86-.43l2-1.94 4.17 3.08c.77.42 1.32.2 1.51-.71l2.7-12.72c.28-1.12-.42-1.63-1.45-1.17Z"></path>
            </svg>
          </span>
        </a>
        <p class="home-year">${this.bootstrap.yearLabel}</p>
      </section>
      <section class="home-empty-plane" aria-hidden="true"></section>
    `;

    shell.querySelector<HTMLAnchorElement>(".tg-button")?.addEventListener("click", () => this.track("tg_click"));

    if (this.bootstrap.donateVisible) {
      shell.append(this.renderDonateBlock());
    }

    return shell;
  }

  private enterPasswordScene(): void {
    this.clearPasswordFlow();
    this.homeDissolving = true;
    this.render();
    void this.track("home_tap_to_enter");

    this.pushTransition(() => {
      this.homeDissolving = false;
      this.scene = "password";
      this.passwordVisualState = "clearing";
      this.render();

      this.pushTransition(() => {
        this.passwordVisualState = "cursor";
        this.render();
        this.resetPasswordTimeout();
      }, 110);
    }, 160);
  }

  private renderDonateBlock(): HTMLElement {
    const footer = document.createElement("section");
    footer.className = "donate-block";
    footer.innerHTML = `<p class="donate-label">donate usdt</p>`;

    const pills = document.createElement("div");
    pills.className = "pill-row";

    for (const wallet of [...this.bootstrap.wallets].sort((left, right) => left.sortOrder - right.sortOrder)) {
      if (!wallet.isEnabled) {
        continue;
      }

      const button = document.createElement("button");
      button.type = "button";
      button.dataset.interactive = "true";
      button.className = "wallet-pill";
      button.textContent = wallet.network;
      button.addEventListener("click", () => {
        this.walletOverlay = wallet;
        this.track("wallet_open", { walletId: wallet.id });
        this.render();
      });
      pills.append(button);
    }

    footer.append(pills);
    return footer;
  }

  private renderPasswordScene(): HTMLElement {
    const shell = document.createElement("main");
    shell.className = `password-shell password-state-${this.passwordVisualState}`;
    shell.addEventListener("click", () => {
      this.schedulePasswordFocus(true);
    });

    const stage = document.createElement("section");
    stage.className = "password-stage";
    const visual = document.createElement("div");
    visual.className = "password-visual-layer";
    visual.innerHTML = this.renderPasswordStage();
    this.passwordVisual = visual;

    const input = document.createElement("textarea");
    input.className = "password-hidden-input";
    input.inputMode = "text";
    input.enterKeyHint = "go";
    input.autocomplete = "off";
    input.autocapitalize = "none";
    input.autocorrect = "off";
    input.spellcheck = false;
    input.rows = 1;
    input.wrap = "off";
    input.value = this.passwordBuffer;
    input.setAttribute("aria-label", "password");
    this.passwordInput = input;

    input.addEventListener("keydown", (event) => {
      if (event.isComposing || this.passwordCompositionActive) {
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        this.leavePasswordScene("fail");
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        this.syncPasswordBufferFromInput(false);
        this.tryPasswordSubmit();
        return;
      }

      this.resetPasswordTimeout();
    });

    input.addEventListener("beforeinput", (event) => {
      const inputEvent = event as InputEvent;
      if (inputEvent.isComposing || this.passwordCompositionActive) {
        return;
      }

      if (inputEvent.inputType === "insertLineBreak") {
        event.preventDefault();
        this.syncPasswordBufferFromInput(false);
        this.tryPasswordSubmit();
      }
    });

    input.addEventListener("compositionstart", () => {
      this.passwordCompositionActive = true;
    });

    input.addEventListener("compositionend", () => {
      this.passwordCompositionActive = false;
      this.syncPasswordBufferFromInput(false);
    });

    input.addEventListener("input", () => {
      if (this.passwordCompositionActive) {
        this.syncPasswordBufferFromInput(false);
        return;
      }

      this.syncPasswordBufferFromInput(true);
    });

    input.addEventListener("blur", () => {
      if (this.scene === "password") {
        this.schedulePasswordFocus();
      }
    });

    stage.append(visual, input);
    shell.append(stage);
    return shell;
  }

  private renderPasswordStage(): string {
    if (this.passwordVisualState === "clearing") {
      return `<div class="password-blank"></div>`;
    }

    if (!this.passwordBuffer) {
      return `
        <div class="password-monolith is-empty">
          <div class="cursor-shell">
            <span class="center-cursor"></span>
          </div>
        </div>
      `;
    }

    const settled = this.passwordVisualState === "success";
    const rows = this.layoutPasswordRows(this.passwordBuffer, settled);
    const size = this.passwordSizeToken(this.passwordBuffer.length);

    return `
      <div class="password-monolith ${settled ? "is-settled" : "is-live"}" data-size="${size}">
        ${rows
          .map((row, rowIndex) => {
            const cells = [...row]
              .map((character) => {
                if (character === " ") {
                  return `<span class="glyph glyph-space">&nbsp;</span>`;
                }

                return `<span class="glyph">${this.escapeHtml(character)}</span>`;
              })
              .join("");
            const cursor = rowIndex === rows.length - 1 && !settled ? `<span class="tail-cursor"></span>` : "";
            return `<p class="password-row">${cells}${cursor}</p>`;
          })
          .join("")}
      </div>
    `;
  }

  private layoutPasswordRows(input: string, settled: boolean): string[] {
    const characters = [...input.toLocaleUpperCase("en-US")];
    const length = characters.length;

    if (length <= 2) {
      return [characters.join("")];
    }

    if (!settled) {
      const columns = Math.min(length, Math.max(3, Math.round(Math.sqrt(length * 2.35))));
      const rows: string[] = [];

      for (let index = 0; index < length; index += columns) {
        rows.push(characters.slice(index, index + columns).join(""));
      }

      return rows;
    }

    const rowCount = Math.max(1, Math.min(4, Math.round(Math.sqrt(length / 2.8))));
    const rows: string[] = [];
    let cursor = 0;

    for (let row = 0; row < rowCount; row += 1) {
      const remaining = length - cursor;
      const rowsLeft = rowCount - row;
      const take = Math.ceil(remaining / rowsLeft);
      rows.push(characters.slice(cursor, cursor + take).join(""));
      cursor += take;
    }

    return rows;
  }

  private passwordSizeToken(length: number): string {
    if (length <= 1) {
      return "single";
    }
    if (length === 2) {
      return "double";
    }
    if (length <= 6) {
      return "giant";
    }
    if (length <= 14) {
      return "dense";
    }
    return "compact";
  }

  private resetPasswordTimeout(): void {
    if (this.passwordTimeoutHandle !== null) {
      window.clearTimeout(this.passwordTimeoutHandle);
    }

    this.passwordTimeoutHandle = window.setTimeout(() => {
      this.leavePasswordScene("timeout");
    }, PASSWORD_TIMEOUT_MS);
  }

  private clearPasswordFlow(): void {
    if (this.passwordTimeoutHandle !== null) {
      window.clearTimeout(this.passwordTimeoutHandle);
      this.passwordTimeoutHandle = null;
    }

    this.passwordCompositionActive = false;

    for (const handle of this.passwordFocusHandles) {
      window.clearTimeout(handle);
    }
    this.passwordFocusHandles = [];

    for (const handle of this.transitionHandles) {
      window.clearTimeout(handle);
    }
    this.transitionHandles = [];
  }

  private pushTransition(callback: () => void, delay: number): void {
    const handle = window.setTimeout(() => {
      this.transitionHandles = this.transitionHandles.filter((value) => value !== handle);
      callback();
    }, delay);
    this.transitionHandles.push(handle);
  }

  private leavePasswordScene(reason: "fail" | "timeout"): void {
    this.clearPasswordFlow();
    this.passwordVisualState = reason;
    this.syncPasswordSceneVisuals();

    this.pushTransition(() => {
      this.passwordBuffer = "";
      this.scene = "home";
      this.passwordVisualState = "cursor";
      this.passwordSubmitPending = false;
      this.render();
    }, reason === "fail" ? 180 : 220);
  }

  private async submitPassword(): Promise<void> {
    if (this.passwordSubmitPending) {
      return;
    }

    this.passwordSubmitPending = true;
    this.clearPasswordFlow();
    this.resetPasswordTimeout();

    try {
      const result = await this.fetchJson<{ ok: boolean; mode?: string; token?: string }>(this.apiUrl("/api/auth/enter"), {
        method: "POST",
        body: JSON.stringify({ password: this.passwordBuffer }),
        headers: { "Content-Type": "application/json" }
      });

      if (!result.ok || !result.mode || !result.token) {
        this.passwordSubmitPending = false;
        this.leavePasswordScene("fail");
        return;
      }

      this.clearPasswordFlow();
      this.passwordVisualState = "success";
      this.syncPasswordSceneVisuals();

      this.pushTransition(() => {
        this.session = { mode: result.mode ?? null, token: result.token ?? null };
        this.passwordBuffer = "";
        this.scene = "mode";
        this.passwordSubmitPending = false;
        if (result.mode === "proxies_mode") {
          this.archiveOpen = false;
          this.pendingScrollTarget = "fresh";
          void this.ensureProxiesPayload(true);
        }
        this.render();
      }, 320);
    } catch {
      this.passwordSubmitPending = false;
      this.leavePasswordScene("timeout");
    }
  }

  private renderProxiesScene(): HTMLElement {
    const payload = this.currentProxiesPayload ?? this.buildProxyFallbackPayload();
    const shell = document.createElement("main");
    shell.className = `proxies-shell${this.archiveOpen ? " archive-visible" : ""}`;
    shell.innerHTML = `
      <section class="proxies-stack">
        <h1>${payload.title}</h1>
        <p class="status-line">последнее успешное обновление: ${payload.lastSuccessfulRefreshAt ? this.formatTimestamp(payload.lastSuccessfulRefreshAt) : "—"}</p>
        ${payload.isStale ? `<p class="stale-line">${payload.staleReason ?? "временно показана последняя сохраненная версия"}</p>` : ""}
      </section>
    `;

    shell.append(this.renderFreshGrid(payload.fresh));

    if (payload.archive.length > 0) {
      shell.append(this.renderArchive(payload.archive));
    }

    return shell;
  }

  private buildProxyFallbackPayload(): ProxiesPayload {
    const fresh = this.snapshot.fresh.slice(0, 9);
    return {
      mode: "proxies_mode",
      title: buildProxyTitle(fresh.length),
      lastSuccessfulRefreshAt: null,
      isStale: true,
      staleReason: "временно показана последняя сохраненная версия",
      fresh,
      archive: this.snapshot.archive
    };
  }

  private renderFreshGrid(items: ProxyItem[]): HTMLElement {
    const count = Math.min(items.length, 9);
    const grid = document.createElement("section");
    grid.className = `fresh-grid fresh-grid-count-${count}`;

    items.slice(0, 9).forEach((item, index) => {
      const card = document.createElement("button");
      const placement = this.freshPlacement(count, index);
      const rowIndex = placement.row - 1;
      const date = new Date(item.postedAt);
      card.type = "button";
      card.className = `proxy-card${this.highlightProxyId === item.id ? " is-accented" : ""}`;
      card.style.gridColumn = `${placement.column} / span 2`;
      card.style.gridRow = String(placement.row);
      card.style.animationDelay = `${90 + rowIndex * 80}ms`;
      card.innerHTML = `
        <strong>#${item.proxyNumber}</strong>
        <span>${date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</span>
        <span>${date.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit" })}</span>
      `;
      card.addEventListener("click", () => {
        void this.openProxy(item, false);
      });
      grid.append(card);
    });

    return grid;
  }

  private freshPlacement(count: number, index: number): { column: number; row: number } {
    const placements: Record<number, Array<{ column: number; row: number }>> = {
      1: [{ column: 3, row: 1 }],
      2: [{ column: 2, row: 1 }, { column: 4, row: 1 }],
      3: [{ column: 1, row: 1 }, { column: 3, row: 1 }, { column: 5, row: 1 }],
      4: [{ column: 2, row: 1 }, { column: 4, row: 1 }, { column: 2, row: 2 }, { column: 4, row: 2 }],
      5: [{ column: 2, row: 1 }, { column: 4, row: 1 }, { column: 1, row: 2 }, { column: 3, row: 2 }, { column: 5, row: 2 }],
      6: [{ column: 1, row: 1 }, { column: 3, row: 1 }, { column: 5, row: 1 }, { column: 1, row: 2 }, { column: 3, row: 2 }, { column: 5, row: 2 }],
      7: [{ column: 2, row: 1 }, { column: 4, row: 1 }, { column: 1, row: 2 }, { column: 3, row: 2 }, { column: 5, row: 2 }, { column: 2, row: 3 }, { column: 4, row: 3 }],
      8: [{ column: 1, row: 1 }, { column: 3, row: 1 }, { column: 5, row: 1 }, { column: 2, row: 2 }, { column: 4, row: 2 }, { column: 1, row: 3 }, { column: 3, row: 3 }, { column: 5, row: 3 }],
      9: [{ column: 1, row: 1 }, { column: 3, row: 1 }, { column: 5, row: 1 }, { column: 1, row: 2 }, { column: 3, row: 2 }, { column: 5, row: 2 }, { column: 1, row: 3 }, { column: 3, row: 3 }, { column: 5, row: 3 }]
    };

    return placements[Math.max(1, count)][index] ?? { column: 1 + (index % 3) * 2, row: Math.floor(index / 3) + 1 };
  }

  private renderArchive(items: ProxyItem[]): HTMLElement {
    const section = document.createElement("section");
    section.className = `archive-zone${this.archiveOpen ? " is-open" : ""}`;
    section.style.animationDelay = "240ms";

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "archive-trigger";
    trigger.innerHTML = `
      <span class="archive-trigger-label">прокси постарее (${items.length})</span>
      <span class="archive-trigger-arrow" aria-hidden="true">↓</span>
    `;
    trigger.addEventListener("click", () => {
      this.archiveOpen = !this.archiveOpen;
      this.pendingScrollTarget = this.archiveOpen ? "archive" : "fresh";
      this.track(this.archiveOpen ? "archive_open" : "archive_close");

      if (!this.archiveOpen && this.queuedProxiesPayload) {
        this.applyProxyPayload(this.queuedProxiesPayload, true);
        this.queuedProxiesPayload = null;
      }

      this.render();
    });
    section.append(trigger);

    if (this.archiveOpen) {
      const grid = document.createElement("div");
      grid.className = "archive-grid";
      const columns = window.innerWidth >= 920 ? 10 : 5;
      const rowCount = Math.max(1, Math.ceil(items.length / columns));

      items.forEach((item, index) => {
        const card = document.createElement("button");
        const row = Math.floor(index / columns);
        const delay = (rowCount - row - 1) * 38;
        card.type = "button";
        card.className = "archive-card";
        card.style.animationDelay = `${delay}ms`;
        card.textContent = `#${item.proxyNumber}`;
        card.addEventListener("click", () => {
          void this.openProxy(item, true);
        });
        grid.append(card);
      });
      section.append(grid);
    }

    return section;
  }

  private async ensureProxiesPayload(force = false): Promise<void> {
    if (this.proxiesLoading) {
      return;
    }

    if (!force && this.currentProxiesPayload) {
      return;
    }

    this.proxiesLoading = true;
    try {
      const payload = await this.fetchJson<ProxiesPayload>(this.apiUrl("/api/modes/proxies_mode"), {
        headers: this.authHeaders()
      });
      this.applyFetchedProxies(payload);
    } catch {
      this.applyFetchedProxies(this.buildProxyFallbackPayload());
    } finally {
      this.proxiesLoading = false;
    }
  }

  private applyFetchedProxies(payload: ProxiesPayload): void {
    if (this.archiveOpen && this.currentProxiesPayload && this.proxyPayloadChanged(this.currentProxiesPayload, payload)) {
      this.queuedProxiesPayload = payload;
      return;
    }

    this.applyProxyPayload(payload, true);
    if (this.scene === "mode" && this.session.mode === "proxies_mode") {
      this.render();
    }
  }

  private applyProxyPayload(payload: ProxiesPayload, animateHighlight: boolean): void {
    const previousFirst = this.currentProxiesPayload?.fresh[0]?.id ?? null;
    const nextFirst = payload.fresh[0]?.id ?? null;
    this.currentProxiesPayload = payload;

    if (!animateHighlight || !previousFirst || !nextFirst || previousFirst === nextFirst) {
      return;
    }

    this.highlightProxyId = nextFirst;
    if (this.highlightHandle !== null) {
      window.clearTimeout(this.highlightHandle);
    }
    this.highlightHandle = window.setTimeout(() => {
      this.highlightProxyId = null;
      if (this.scene === "mode" && this.session.mode === "proxies_mode") {
        this.render();
      }
    }, 1600);
  }

  private proxyPayloadChanged(left: ProxiesPayload, right: ProxiesPayload): boolean {
    const leftKey = `${left.lastSuccessfulRefreshAt}:${left.fresh.map((item) => item.id).join(",")}:${left.archive.slice(0, 6).map((item) => item.id).join(",")}`;
    const rightKey = `${right.lastSuccessfulRefreshAt}:${right.fresh.map((item) => item.id).join(",")}:${right.archive.slice(0, 6).map((item) => item.id).join(",")}`;
    return leftKey !== rightKey;
  }

  private async openProxy(item: ProxyItem, archive: boolean): Promise<void> {
    await this.track("proxy_click", { proxyId: item.id, archive });

    const deepLink = this.telegramDeepLink(item.proxyUrl);
    let fallbackHandled = false;

    const completeFallback = (): void => {
      if (fallbackHandled) {
        return;
      }
      fallbackHandled = true;
      window.location.assign(item.proxyUrl);
    };

    const cancelFallback = (): void => {
      fallbackHandled = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", cancelFallback);
    };

    const handleVisibilityChange = (): void => {
      if (document.visibilityState === "hidden") {
        cancelFallback();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange, { once: true });
    window.addEventListener("pagehide", cancelFallback, { once: true });
    window.setTimeout(() => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", cancelFallback);
      if (!fallbackHandled && document.visibilityState === "visible") {
        completeFallback();
      }
    }, TELEGRAM_FALLBACK_DELAY_MS);

    window.location.assign(deepLink);
  }

  private telegramDeepLink(proxyUrl: string): string {
    try {
      const url = new URL(proxyUrl);
      return `tg://proxy?${url.searchParams.toString()}`;
    } catch {
      return proxyUrl;
    }
  }

  private async renderAdminScene(): Promise<void> {
    const payload = await this.fetchJson<AdminPayload>(this.apiUrl("/api/admin/bootstrap"), {
      headers: this.authHeaders()
    });

    const shell = document.createElement("main");
    shell.className = "admin-shell";
    shell.innerHTML = `
      <section class="admin-intro">
        <p class="admin-kicker">hidden admin</p>
        <h1>Панель управления</h1>
        <p class="admin-intro-copy">Здесь вы управляете доступом, режимами, кошельками и оперативными действиями без правки кода.</p>
      </section>
    `;
    shell.append(
      this.sectionCard("Состояние", "Живой статус воркера, D1 и bootstrap-доступа.", this.renderHealth(payload)),
      this.sectionCard("Настройки", "Глобальные переключатели публичной сцены и emergency-режима.", this.renderSettings(payload.settings)),
      this.sectionCard("Режимы", "Какие режимы открыты, заблокированы и какой режим публичный по умолчанию.", this.renderModes(payload.modes)),
      this.sectionCard("Пароли и доступы", "Создание, архивирование и переназначение правил доступа для режимов.", this.renderAccessRules(payload.accessRules)),
      this.sectionCard("Кошельки", "Управление donate-блоком и адресами для сетей.", this.renderWallets(payload.wallets)),
      this.sectionCard("Экспорт и импорт", "Резервные выгрузки и ручное восстановление служебных данных.", this.renderExports()),
      this.sectionCard("Журнал", "Последние события авторизации и административных действий.", this.renderAudit(payload.audit))
    );
    this.root.append(shell);
  }

  private sectionCard(title: string, description: string, content: HTMLElement): HTMLElement {
    const card = document.createElement("section");
    card.className = "admin-card";
    card.innerHTML = `
      <div class="admin-card-header">
        <h2>${title}</h2>
        <p>${description}</p>
      </div>
    `;
    card.append(content);
    return card;
  }

  private renderHealth(payload: AdminPayload): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "admin-list admin-health-list";
    wrap.innerHTML = Object.entries(payload.health)
      .map(([key, value]) => `<p><span>${this.healthLabel(key)}</span><strong>${this.healthValue(value)}</strong></p>`)
      .join("");

    const actions = document.createElement("div");
    actions.className = "admin-actions";

    const refresh = document.createElement("button");
    refresh.textContent = "Обновить прокси сейчас";
    refresh.addEventListener("click", () => void this.adminAction("/api/admin/refresh-now"));

    const lock = document.createElement("button");
    lock.textContent = "Мгновенно заблокировать";
    lock.className = "danger";
    lock.addEventListener("click", () => void this.adminAction("/api/admin/lock-now"));

    actions.append(refresh, lock);
    wrap.append(actions);
    return wrap;
  }

  private renderModes(modes: ModeSummary[]): HTMLElement {
    const list = document.createElement("div");
    list.className = "admin-list";

    for (const mode of modes) {
      const row = document.createElement("form");
      row.className = "admin-form-row";
      row.innerHTML = `
        <strong>${this.modeLabel(mode.id)}</strong>
        <label>Доступ
          <select name="accessState">
            <option value="public" ${mode.accessState === "public" ? "selected" : ""}>публичный</option>
            <option value="locked" ${mode.accessState === "locked" ? "selected" : ""}>закрытый</option>
          </select>
        </label>
        <label>Включен
          <input name="isEnabled" type="checkbox" ${mode.isEnabled ? "checked" : ""} />
        </label>
        <label>Публичный по умолчанию
          <input name="isDefaultPublic" type="checkbox" ${mode.isDefaultPublic ? "checked" : ""} />
        </label>
        <button type="submit">Сохранить режим</button>
      `;
      row.addEventListener("submit", (event) => {
        event.preventDefault();
        const form = new FormData(row);
        void this.fetchJson(this.apiUrl(`/api/admin/modes/${mode.id}`), {
          method: "PUT",
          headers: { ...this.authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({
            accessState: form.get("accessState"),
            isEnabled: form.get("isEnabled") === "on",
            isDefaultPublic: form.get("isDefaultPublic") === "on"
          })
        }).then(() => this.render());
      });
      list.append(row);
    }

    return list;
  }

  private renderSettings(settings: Record<string, unknown>): HTMLElement {
    const form = document.createElement("form");
    form.className = "admin-form-row";
    form.innerHTML = `
      <label>Показывать donate-блок
        <input name="donate.visible" type="checkbox" ${settings["donate.visible"] ? "checked" : ""} />
      </label>
      <label>Режим тревоги
        <input name="panic_mode" type="checkbox" ${settings["panic_mode"] ? "checked" : ""} />
      </label>
      <button type="submit">Сохранить настройки</button>
    `;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(form);
      void this.fetchJson(this.apiUrl("/api/admin/settings"), {
        method: "PUT",
        headers: { ...this.authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          "donate.visible": data.get("donate.visible") === "on",
          panic_mode: data.get("panic_mode") === "on"
        })
      }).then(() => this.render());
    });
    return form;
  }

  private renderAccessRules(rules: AccessRuleSummary[]): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "admin-list";

    for (const rule of rules) {
      const row = document.createElement("form");
      row.className = "admin-form-row";
      row.innerHTML = `
        <strong>${this.escapeHtml(rule.label)}${rule.softDeletedAt ? " [в архиве]" : ""}</strong>
        <label>Режим
          <input name="targetMode" value="${this.escapeHtml(rule.targetMode)}" />
        </label>
        <label>Название правила
          <input name="label" value="${this.escapeHtml(rule.label)}" />
        </label>
        <label>Приоритет
          <input name="priority" type="number" value="${rule.priority}" />
        </label>
        <label>Включено
          <input name="isEnabled" type="checkbox" ${rule.isEnabled ? "checked" : ""} ${rule.softDeletedAt ? "disabled" : ""} />
        </label>
        <label>Архив
          <input name="softDelete" type="checkbox" ${rule.softDeletedAt ? "checked" : ""} />
        </label>
        <label>Новый пароль
          <input name="password" type="text" placeholder="оставьте пустым, чтобы не менять" />
        </label>
        <label>Заметки
          <input name="notes" value="${this.escapeHtml(rule.notes ?? "")}" />
        </label>
        <label>Истекает
          <input name="expiresAt" type="datetime-local" value="${this.toDatetimeLocalValue(rule.expiresAt)}" />
        </label>
        <label>Максимум использований
          <input name="maxUses" type="number" min="1" value="${rule.maxUses ?? ""}" />
        </label>
        <label>Только одно успешное использование
          <input name="firstUseOnly" type="checkbox" ${rule.firstUseOnly ? "checked" : ""} />
        </label>
        <p class="admin-rule-meta">Использований: ${rule.usageCount} | Успехов: ${rule.successCount} | Ошибок: ${rule.failCount}</p>
        <p class="admin-rule-meta">Последнее использование: ${rule.lastUsedAt ? this.formatTimestamp(rule.lastUsedAt) : "никогда"}</p>
        <button type="submit">Сохранить правило</button>
      `;
      row.addEventListener("submit", (event) => {
        event.preventDefault();
        const form = new FormData(row);
        void this.fetchJson(this.apiUrl(`/api/admin/access-rules/${rule.id}`), {
          method: "PUT",
          headers: { ...this.authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({
            label: form.get("label"),
            targetMode: form.get("targetMode"),
            priority: Number(form.get("priority")),
            isEnabled: form.get("softDelete") === "on" ? false : form.get("isEnabled") === "on",
            softDelete: form.get("softDelete") === "on",
            password: String(form.get("password") ?? ""),
            notes: String(form.get("notes") ?? ""),
            expiresAt: String(form.get("expiresAt") ?? ""),
            maxUses: String(form.get("maxUses") ?? ""),
            firstUseOnly: form.get("firstUseOnly") === "on"
          })
        }).then(() => this.render());
      });
      wrap.append(row);
    }

    const add = document.createElement("form");
    add.className = "admin-form-row";
    add.innerHTML = `
      <strong>Новое правило доступа</strong>
      <label>Название <input name="label" required /></label>
      <label>Режим <input name="targetMode" required /></label>
      <label>Приоритет <input name="priority" type="number" value="100" /></label>
      <label>Пароль <input name="password" required /></label>
      <label>Заметки <input name="notes" /></label>
      <label>Истекает <input name="expiresAt" type="datetime-local" /></label>
      <label>Максимум использований <input name="maxUses" type="number" min="1" /></label>
      <label>Только одно успешное использование <input name="firstUseOnly" type="checkbox" /></label>
      <button type="submit">Создать правило</button>
    `;
    add.addEventListener("submit", (event) => {
      event.preventDefault();
      const form = new FormData(add);
      void this.fetchJson(this.apiUrl("/api/admin/access-rules"), {
        method: "POST",
        headers: { ...this.authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          label: form.get("label"),
          targetMode: form.get("targetMode"),
          priority: Number(form.get("priority") ?? 100),
          password: form.get("password"),
          notes: form.get("notes"),
          expiresAt: form.get("expiresAt"),
          maxUses: form.get("maxUses"),
          firstUseOnly: form.get("firstUseOnly") === "on"
        })
      }).then(() => this.render());
    });
    wrap.append(add);

    return wrap;
  }

  private renderWallets(wallets: WalletEntry[]): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "admin-list";

    for (const wallet of wallets) {
      const row = document.createElement("form");
      row.className = "admin-form-row";
      row.innerHTML = `
        <strong>${wallet.network.toUpperCase()}</strong>
        <label>Адрес <input name="address" value="${this.escapeHtml(wallet.address)}" /></label>
        <label>Предупреждение <input name="warningText" value="${this.escapeHtml(wallet.warningText)}" /></label>
        <label>Включено <input name="isEnabled" type="checkbox" ${wallet.isEnabled ? "checked" : ""} /></label>
        <button type="submit">Сохранить кошелек</button>
      `;
      row.addEventListener("submit", (event) => {
        event.preventDefault();
        const form = new FormData(row);
        void this.fetchJson(this.apiUrl(`/api/admin/wallets/${wallet.id}`), {
          method: "PUT",
          headers: { ...this.authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({
            address: form.get("address"),
            warningText: form.get("warningText"),
            isEnabled: form.get("isEnabled") === "on"
          })
        }).then(() => this.render());
      });
      wrap.append(row);
    }

    return wrap;
  }

  private renderExports(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "admin-actions";
    for (const kind of ["access_rules", "wallets", "site_settings"]) {
      const anchor = document.createElement("a");
      anchor.href = this.apiUrl(`/api/admin/export?kind=${kind}`);
      anchor.textContent = this.exportLabel(kind);
      anchor.className = "export-link";
      anchor.addEventListener("click", (event) => {
        event.preventDefault();
        void fetch(anchor.href, { headers: this.authHeaders() })
          .then((response) => response.text())
          .then((content) => {
            const blob = new Blob([content], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const tmp = document.createElement("a");
            tmp.href = url;
            tmp.download = `${kind}.json`;
            tmp.click();
            URL.revokeObjectURL(url);
          });
      });
      wrap.append(anchor);
    }

    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json";
    const select = document.createElement("select");
    select.innerHTML = `
      <option value="access_rules">Правила доступа</option>
      <option value="wallets">Кошельки</option>
      <option value="site_settings">Настройки сайта</option>
    `;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Импортировать выбранный JSON";
    button.addEventListener("click", async () => {
      const file = input.files?.[0];
      if (!file) {
        return;
      }
      const text = await file.text();
      await this.fetchJson(this.apiUrl(`/api/admin/import?kind=${select.value}`), {
        method: "POST",
        headers: { ...this.authHeaders(), "Content-Type": "application/json" },
        body: text
      });
      this.render();
    });
    wrap.append(select, input, button);
    return wrap;
  }

  private renderAudit(audit: AdminPayload["audit"]): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "admin-list";
    wrap.innerHTML = audit
      .map((entry) => `<p><span>${this.auditEventLabel(entry.eventType)}</span><strong>${this.formatTimestamp(entry.createdAt)}</strong></p>`)
      .join("");
    return wrap;
  }

  private renderWalletOverlay(wallet: WalletEntry): HTMLElement {
    const overlay = document.createElement("div");
    overlay.className = "wallet-overlay";
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        this.walletOverlay = null;
        this.copiedWalletId = null;
        this.render();
      }
    });

    const card = document.createElement("div");
    card.className = "wallet-card";
    void QRCode.toDataURL(wallet.qrPayload, { margin: 0, width: 180 }).then((dataUrl) => {
      const image = card.querySelector<HTMLImageElement>("img");
      if (image) {
        image.src = dataUrl;
      }
    });

    card.innerHTML = `
      <h2>${wallet.title}</h2>
      <img alt="${wallet.title} qr" />
      <code>${wallet.address}</code>
      <button type="button" class="copy-button">${this.copiedWalletId === wallet.id ? "copied" : "copy address"}</button>
      <p>${wallet.warningText}</p>
    `;

    const button = card.querySelector<HTMLButtonElement>(".copy-button");
    button?.addEventListener("click", async () => {
      await navigator.clipboard.writeText(wallet.address);
      this.track("wallet_copy", { walletId: wallet.id });
      this.copiedWalletId = wallet.id;
      this.render();
    });

    overlay.append(card);
    return overlay;
  }

  private async adminAction(path: string): Promise<void> {
    await this.fetchJson(this.apiUrl(path), { method: "POST", headers: this.authHeaders() });
    this.render();
  }

  private authHeaders(): HeadersInit {
    return this.session.token ? { Authorization: `Bearer ${this.session.token}` } : {};
  }

  private async fetchJson<T>(input: string, init?: RequestInit): Promise<T> {
    const response = await fetch(input, init);
    if (!response.ok) {
      throw new Error(`request failed: ${response.status}`);
    }
    return response.json() as Promise<T>;
  }

  private startPolling(): void {
    if (this.pollingHandle !== null) {
      return;
    }

    this.pollingHandle = window.setInterval(() => {
      if (document.visibilityState === "visible" && this.session.mode === "proxies_mode") {
        void this.ensureProxiesPayload(true);
      }
    }, 60_000);
  }

  private stopPolling(): void {
    if (this.pollingHandle !== null) {
      window.clearInterval(this.pollingHandle);
      this.pollingHandle = null;
    }
  }

  private async track(eventType: string, metadata: Record<string, unknown> = {}): Promise<void> {
    await fetch(this.apiUrl("/api/bootstrap"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventType, metadata })
    }).catch(() => undefined);
  }

  private apiUrl(path: string): string {
    return `${API_BASE}${path}`;
  }

  private escapeHtml(value: string): string {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  private formatTimestamp(value: string): string {
    return new Date(value).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  private toDatetimeLocalValue(value: string | null): string {
    if (!value) {
      return "";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "";
    }

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  }

  private schedulePasswordFocus(force = false): void {
    if (this.scene !== "password") {
      return;
    }

    const focusDelays = force ? [0, 60, 180, 420] : [0, 120, 320];
    for (const delay of focusDelays) {
      const handle = window.setTimeout(() => {
        this.passwordFocusHandles = this.passwordFocusHandles.filter((value) => value !== handle);
        if (this.scene !== "password") {
          return;
        }
        const input = this.passwordInput ?? this.root.querySelector<HTMLTextAreaElement>(".password-hidden-input");
        if (!input) {
          return;
        }
        input.focus({ preventScroll: true });
        const length = input.value.length;
        input.setSelectionRange(length, length);
      }, delay);
      this.passwordFocusHandles.push(handle);
    }
  }

  private syncPasswordBufferFromInput(allowSubmitFromLineBreak: boolean): void {
    const input = this.passwordInput;
    if (!input) {
      return;
    }

    const rawValue = input.value;
    const hadLineBreak = /[\r\n]/.test(rawValue);
    const nextValue = rawValue.replace(/[\r\n]+/g, "");
    if (hadLineBreak) {
      input.value = nextValue;
    }

    this.passwordBuffer = nextValue;
    this.passwordVisualState = nextValue ? "typing" : "cursor";
    this.syncPasswordSceneVisuals();
    this.resetPasswordTimeout();

    if (allowSubmitFromLineBreak && hadLineBreak) {
      this.tryPasswordSubmit();
    }
  }

  private syncPasswordSceneVisuals(): void {
    if (this.scene !== "password") {
      return;
    }

    const shell = this.root.querySelector<HTMLElement>(".password-shell");
    if (shell) {
      shell.className = `password-shell password-state-${this.passwordVisualState}`;
    }

    if (this.passwordVisual) {
      this.passwordVisual.innerHTML = this.renderPasswordStage();
    }
  }

  private tryPasswordSubmit(): void {
    this.syncPasswordBufferFromInput(false);
    if (!this.passwordBuffer.trim() || this.passwordCompositionActive || this.passwordSubmitPending) {
      return;
    }

    void this.submitPassword();
  }

  private installPasswordGlobalHandlers(): void {
    if (this.passwordGlobalKeyHandler) {
      return;
    }

    this.passwordGlobalKeyHandler = (event: KeyboardEvent) => {
      if (this.scene !== "password" || event.defaultPrevented || event.isComposing || this.passwordCompositionActive) {
        return;
      }

      if (event.key !== "Enter") {
        return;
      }

      const active = document.activeElement;
      if (active instanceof HTMLInputElement || active instanceof HTMLSelectElement || active instanceof HTMLButtonElement) {
        return;
      }

      event.preventDefault();
      this.syncPasswordBufferFromInput(false);
      this.tryPasswordSubmit();
    };

    window.addEventListener("keydown", this.passwordGlobalKeyHandler, true);
  }

  private modeLabel(modeId: string): string {
    const labels: Record<string, string> = {
      home_mode: "Главная сцена",
      proxies_mode: "Прокси",
      admin_mode: "Админ-панель"
    };
    return labels[modeId] ?? modeId;
  }

  private exportLabel(kind: string): string {
    const labels: Record<string, string> = {
      access_rules: "Экспорт правил доступа",
      wallets: "Экспорт кошельков",
      site_settings: "Экспорт настроек сайта"
    };
    return labels[kind] ?? kind;
  }

  private healthLabel(key: string): string {
    const labels: Record<string, string> = {
      worker: "Worker",
      d1: "D1",
      analytics: "Analytics",
      adminBootstrapConfigured: "Bootstrap secret настроен",
      adminRulePresent: "Admin-правило существует",
      bootstrapMessage: "Статус bootstrap",
      last_live_refresh_at: "Последнее живое обновление",
      last_snapshot_at: "Последний snapshot",
      last_refresh_status: "Статус обновления",
      stale_reason: "Причина stale",
      session_version: "Версия сессий"
    };
    return labels[key] ?? key;
  }

  private healthValue(value: unknown): string {
    if (typeof value === "boolean") {
      return value ? "да" : "нет";
    }
    if (value === null) {
      return "—";
    }
    return String(value);
  }

  private auditEventLabel(eventType: string): string {
    const labels: Record<string, string> = {
      password_success: "Успешный вход",
      password_fail: "Ошибка пароля",
      admin_change_access_rule: "Изменено правило доступа",
      admin_change_mode: "Изменен режим",
      wallet_update: "Изменен кошелек",
      admin_import: "Импорт данных",
      admin_lock_now: "Принудительная блокировка",
      admin_bootstrap_rule_seeded: "Создан bootstrap admin rule",
      site_open: "Открытие сайта",
      home_tap_to_enter: "Переход к скрытому вводу",
      tg_click: "Переход в Telegram",
      wallet_open: "Открыт donate-кошелек",
      wallet_copy: "Скопирован адрес кошелька",
      proxy_click: "Открыт прокси",
      archive_open: "Открыт архив прокси",
      archive_close: "Закрыт архив прокси"
    };
    return labels[eventType] ?? eventType;
  }
}
