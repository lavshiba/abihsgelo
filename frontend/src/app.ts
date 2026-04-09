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
type AdminSectionKey = "access" | "quick" | "wallets" | "service";

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, "") ?? "";
const PASSWORD_TIMEOUT_MS = 3800;
const AUTH_REQUEST_TIMEOUT_MS = 10000;
const TELEGRAM_FALLBACK_DELAY_MS = 720;

interface SessionState {
  token: string | null;
  mode: string | null;
}

interface AdminNotice {
  tone: "success" | "error";
  text: string;
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
  private passwordGlobalKeyHandler: EventListener | null = null;
  private transitionHandles: number[] = [];
  private walletOverlay: WalletEntry | null = null;
  private copiedWalletId: string | null = null;
  private snapshot: { fresh: ProxyItem[]; archive: ProxyItem[] } = { fresh: [], archive: [] };
  private archiveOpen = false;
  private currentProxiesPayload: ProxiesPayload | null = null;
  private queuedProxiesPayload: ProxiesPayload | null = null;
  private proxiesLoading = false;
  private proxiesLoadState: "idle" | "loading" | "ready" | "error" = "idle";
  private pollingHandle: number | null = null;
  private highlightProxyId: string | null = null;
  private highlightHandle: number | null = null;
  private pendingScrollTarget: ScrollTarget = null;
  private adminPayload: AdminPayload | null = null;
  private adminLoading = false;
  private adminError: string | null = null;
  private adminNotice: AdminNotice | null = null;
  private adminNoticeHandle: number | null = null;
  private panelClosing = false;
  private panelCloseHandle: number | null = null;
  private adminSections: Record<AdminSectionKey, boolean> = {
    access: true,
    quick: false,
    wallets: false,
    service: false
  };

  public constructor(root: HTMLDivElement) {
    this.root = root;
  }

  public async start(): Promise<void> {
    this.installPasswordGlobalHandlers();
    this.render();
    void this.hydrateBootstrapState();
    void this.track("site_open");
  }

  private async hydrateBootstrapState(): Promise<void> {
    const [snapshot, bootstrap] = await Promise.allSettled([
      this.loadSnapshot(),
      this.fetchJson<BootstrapPayload>(this.apiUrl("/api/bootstrap"))
    ]);

    if (snapshot.status === "fulfilled") {
      this.snapshot = snapshot.value;
    }

    if (bootstrap.status === "fulfilled") {
      this.bootstrap = bootstrap.value;
    } else {
      this.bootstrap = FALLBACK_BOOTSTRAP;
    }

    if (this.scene === "home") {
      this.render();
    }
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
      this.root.append(this.renderAdminScene());
      if (!this.adminPayload && !this.adminLoading) {
        void this.ensureAdminPayload(true);
      }
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
      this.safeScrollIntoView(this.root.querySelector<HTMLElement>(selector) ?? null, {
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

    shell.querySelector<HTMLAnchorElement>(".tg-button")?.addEventListener("click", (event) => {
      event.preventDefault();
      void this.track("tg_click");
      this.openTelegramChannel(this.bootstrap.telegramUrl);
    });

    if (this.bootstrap.donateVisible) {
      shell.append(this.renderDonateBlock());
    }

    return shell;
  }

  private renderPanelCloseButton(label: string): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "panel-close";
    button.setAttribute("aria-label", label);
    button.innerHTML = `
      <span class="panel-close-line"></span>
      <span class="panel-close-line"></span>
    `;
    button.addEventListener("click", () => {
      this.closeCurrentPanel();
    });
    return button;
  }

  private closeCurrentPanel(): void {
    if (this.scene !== "mode" || this.panelClosing) {
      return;
    }

    if (this.panelCloseHandle !== null) {
      window.clearTimeout(this.panelCloseHandle);
    }

    this.panelClosing = true;
    this.render();
    this.panelCloseHandle = window.setTimeout(() => {
      this.panelClosing = false;
      this.panelCloseHandle = null;
      this.archiveOpen = false;
      this.walletOverlay = null;
      this.session = { token: null, mode: null };
      this.scene = "home";
      this.render();
    }, 170);
  }

  private openPasswordSceneFromPanel(): void {
    if (this.scene !== "mode" || this.panelClosing) {
      return;
    }

    if (this.panelCloseHandle !== null) {
      window.clearTimeout(this.panelCloseHandle);
    }

    this.clearPasswordFlow();
    this.passwordBuffer = "";
    this.passwordVisualState = "clearing";
    this.passwordSubmitPending = false;
    this.panelClosing = true;
    this.render();
    this.panelCloseHandle = window.setTimeout(() => {
      this.panelClosing = false;
      this.panelCloseHandle = null;
      this.archiveOpen = false;
      this.walletOverlay = null;
      this.session = { token: null, mode: null };
      this.scene = "password";
      this.render();
      this.pushTransition(() => {
        this.passwordVisualState = "cursor";
        this.render();
        this.resetPasswordTimeout();
      }, 90);
    }, 150);
  }

  private enterPasswordScene(): void {
    this.clearPasswordFlow();
    this.activatePasswordInputBridge();
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
    const focusPassword = (event?: Event): void => {
      event?.preventDefault();
      this.focusPasswordInputNow();
      this.schedulePasswordFocus(true);
      this.resetPasswordTimeout();
    };
    shell.addEventListener("pointerdown", focusPassword);
    shell.addEventListener("touchend", focusPassword);
    shell.addEventListener("click", focusPassword);

    const stage = document.createElement("section");
    stage.className = "password-stage";
    const visual = document.createElement("div");
    visual.className = "password-visual-layer";
    visual.innerHTML = this.renderPasswordStage();
    this.passwordVisual = visual;

    const input = this.ensurePasswordInput();
    input.value = this.passwordBuffer;

    stage.append(visual, input);
    shell.append(stage);
    return shell;
  }

  private ensurePasswordInput(): HTMLTextAreaElement {
    if (this.passwordInput) {
      return this.passwordInput;
    }

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
    input.setAttribute("aria-label", "password");

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

    this.passwordInput = input;
    return input;
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
      const rowCount = length <= 4 ? 1 : length <= 8 ? 2 : length <= 16 ? 3 : 4;
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
    if (length <= 4) {
      return "giant";
    }
    if (length <= 8) {
      return "dense";
    }
    if (length <= 16) {
      return "compact";
    }
    return "packed";
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
    this.passwordInput?.blur();
    this.passwordVisualState = reason;
    this.syncPasswordSceneVisuals();

    this.pushTransition(() => {
      this.passwordBuffer = "";
      this.scene = "home";
      this.passwordVisualState = "cursor";
      this.passwordSubmitPending = false;
      this.passwordInput?.remove();
      this.render();
    }, reason === "fail" ? 180 : 220);
  }

  private async submitPassword(): Promise<void> {
    if (this.passwordSubmitPending) {
      return;
    }

    this.passwordSubmitPending = true;
    this.clearPasswordFlow();
    const controller = new AbortController();
    const requestTimeout = window.setTimeout(() => controller.abort(), AUTH_REQUEST_TIMEOUT_MS);

    try {
      const result = await this.fetchJson<{ ok: boolean; mode?: string; token?: string }>(this.apiUrl("/api/auth/enter"), {
        method: "POST",
        body: JSON.stringify({ password: this.passwordBuffer }),
        headers: { "Content-Type": "application/json" },
        signal: controller.signal
      });
      window.clearTimeout(requestTimeout);

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
        this.panelClosing = false;
        this.passwordSubmitPending = false;
        this.passwordInput?.remove();
        if (result.mode === "proxies_mode") {
          this.archiveOpen = false;
          this.pendingScrollTarget = "fresh";
          const fallback = this.buildProxyFallbackPayload();
          this.currentProxiesPayload = fallback.fresh.length > 0 || fallback.archive.length > 0 ? fallback : null;
          this.proxiesLoadState = this.currentProxiesPayload ? "ready" : "loading";
          this.proxiesLoading = false;
        }
        if (result.mode === "admin_mode") {
          this.adminError = null;
          this.adminPayload = null;
          this.adminLoading = false;
        }
        this.render();
        if (result.mode === "proxies_mode") {
          void this.ensureProxiesPayload(true);
        }
        if (result.mode === "admin_mode") {
          void this.ensureAdminPayload(true);
        }
      }, 36);
    } catch {
      window.clearTimeout(requestTimeout);
      this.passwordSubmitPending = false;
      this.leavePasswordScene("timeout");
    }
  }

  private renderProxiesScene(): HTMLElement {
    const payload = this.currentProxiesPayload ?? this.buildProxyFallbackPayload();
    const hasItems = payload.fresh.length > 0;
    const shell = document.createElement("main");
    shell.className = `proxies-shell${this.archiveOpen ? " archive-visible" : ""}${this.panelClosing ? " is-closing" : ""}`;

    const frame = document.createElement("section");
    frame.className = "panel-frame panel-frame-proxies";

    const chrome = document.createElement("div");
    chrome.className = "panel-chrome";
    chrome.innerHTML = `
      <div class="panel-kicker-wrap">
        <p class="panel-kicker">proxies_mode</p>
        <h1>${payload.title}</h1>
      </div>
    `;
    chrome.append(this.renderPanelCloseButton("Вернуться на главную"));

    const status = document.createElement("section");
    status.className = "proxies-status-card";
    status.innerHTML = `
      <p class="status-line">${this.proxyStatusLine(payload, hasItems)}</p>
      ${payload.isStale ? `<p class="stale-line">${payload.staleReason ?? "временно показана последняя сохраненная версия"}</p>` : ""}
    `;

    frame.append(chrome, status);

    if (hasItems) {
      frame.append(this.renderFreshGrid(payload.fresh));
    } else {
      frame.append(this.renderProxiesEmptyState());
    }

    if (payload.archive.length > 0) {
      frame.append(this.renderArchive(payload.archive));
    }

    shell.append(frame);
    return shell;
  }

  private buildProxyFallbackPayload(): ProxiesPayload {
    const fresh = this.snapshot.fresh.slice(0, 9);
    return {
      mode: "proxies_mode",
      title: fresh.length > 0 ? buildProxyTitle(fresh.length) : "загружаем свежие прокси...",
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
    trigger.setAttribute("aria-expanded", this.archiveOpen ? "true" : "false");

    const grid = document.createElement("div");
    grid.className = "archive-grid";
    const columns = window.innerWidth >= 920 ? 10 : 5;
    const rowCount = Math.max(1, Math.ceil(items.length / columns));

    items.forEach((item, index) => {
      const card = document.createElement("button");
      const row = Math.floor(index / columns);
      const delay = (rowCount - row - 1) * 44;
      card.type = "button";
      card.className = "archive-card";
      card.style.transitionDelay = `${delay}ms`;
      card.textContent = `#${item.proxyNumber}`;
      card.addEventListener("click", () => {
        void this.openProxy(item, true);
      });
      grid.append(card);
    });

    const syncArchiveState = (): void => {
      section.classList.toggle("is-open", this.archiveOpen);
      trigger.setAttribute("aria-expanded", this.archiveOpen ? "true" : "false");
    };

    trigger.addEventListener("click", () => {
      this.archiveOpen = !this.archiveOpen;
      this.track(this.archiveOpen ? "archive_open" : "archive_close");
      syncArchiveState();

      if (this.archiveOpen) {
        window.setTimeout(() => {
          this.safeScrollIntoView(section, { behavior: "smooth", block: "start" });
        }, 40);
        return;
      }

      this.safeScrollIntoView(this.root.querySelector<HTMLElement>(".fresh-grid") ?? null, { behavior: "smooth", block: "center" });

      if (!this.queuedProxiesPayload) {
        return;
      }

      const queued = this.queuedProxiesPayload;
      this.queuedProxiesPayload = null;
      window.setTimeout(() => {
        this.applyProxyPayload(queued, true);
        if (this.scene === "mode" && this.session.mode === "proxies_mode") {
          this.render();
        }
      }, 260);
    });
    section.append(trigger);
    section.append(grid);

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
    this.proxiesLoadState = "loading";
    if (this.scene === "mode" && this.session.mode === "proxies_mode") {
      this.render();
    }
    try {
      const payload = await this.fetchProxiesPayload();
      this.proxiesLoadState = "ready";
      this.applyFetchedProxies(payload);
    } catch {
      this.proxiesLoadState = "error";
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

  private proxyStatusLine(payload: ProxiesPayload, hasItems: boolean): string {
    if (payload.lastSuccessfulRefreshAt) {
      return `последнее успешное обновление: ${this.formatTimestamp(payload.lastSuccessfulRefreshAt)}`;
    }

    if (this.proxiesLoadState === "loading") {
      return "подождите несколько секунд, список загружается";
    }

    if (!hasItems) {
      return "пока нет доступных карточек прокси";
    }

    return "показана последняя доступная версия";
  }

  private renderProxiesEmptyState(): HTMLElement {
    const empty = document.createElement("section");
    empty.className = "proxies-empty";
    empty.innerHTML = `
      <p class="proxies-empty-title">${this.proxiesLoadState === "loading" ? "Получаем список прокси" : "Пока нечего показать"}</p>
      <p class="proxies-empty-copy">${this.proxiesLoadState === "loading" ? "Если список уже обновлен на сервере, он появится здесь автоматически без перезагрузки." : "Проверьте, что у режима прокси есть активный пароль и что последнее обновление прошло успешно."}</p>
    `;
    return empty;
  }

  private proxyPayloadChanged(left: ProxiesPayload, right: ProxiesPayload): boolean {
    const leftKey = `${left.lastSuccessfulRefreshAt}:${left.fresh.map((item) => item.id).join(",")}:${left.archive.slice(0, 6).map((item) => item.id).join(",")}`;
    const rightKey = `${right.lastSuccessfulRefreshAt}:${right.fresh.map((item) => item.id).join(",")}:${right.archive.slice(0, 6).map((item) => item.id).join(",")}`;
    return leftKey !== rightKey;
  }

  private async openProxy(item: ProxyItem, archive: boolean): Promise<void> {
    await this.track("proxy_click", { proxyId: item.id, archive });
    this.openTelegramTarget(this.telegramDeepLink(item.proxyUrl), item.proxyUrl);
  }

  private openTelegramChannel(channelUrl: string): void {
    this.openTelegramTarget(this.telegramChannelDeepLink(channelUrl), channelUrl);
  }

  private openTelegramTarget(deepLink: string, fallbackUrl: string, fallbackInNewTab = true): void {
    let handled = false;
    let timer = 0;

    const cleanup = (): void => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", cancelFallback);
      window.removeEventListener("blur", handleWindowBlur);
      if (timer) {
        window.clearTimeout(timer);
      }
    };

    const cancelFallback = (): void => {
      if (handled) {
        return;
      }
      handled = true;
      cleanup();
    };

    const completeFallback = (): void => {
      if (handled) {
        return;
      }
      handled = true;
      cleanup();
      if (fallbackInNewTab) {
        this.openUrlInNewTab(fallbackUrl);
        return;
      }
      this.navigateToUrl(fallbackUrl);
    };

    const handleVisibilityChange = (): void => {
      if (document.visibilityState === "hidden") {
        cancelFallback();
      }
    };

    const handleWindowBlur = (): void => {
      window.setTimeout(() => {
        if (document.visibilityState === "hidden" || !document.hasFocus()) {
          cancelFallback();
        }
      }, 90);
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", cancelFallback, { once: true });
    window.addEventListener("blur", handleWindowBlur, { once: true });
    timer = window.setTimeout(() => {
      if (!handled && document.visibilityState === "visible") {
        completeFallback();
      }
    }, TELEGRAM_FALLBACK_DELAY_MS);

    this.dispatchTelegramDeepLink(deepLink);
  }

  private dispatchTelegramDeepLink(deepLink: string): void {
    const anchor = document.createElement("a");
    anchor.href = deepLink;
    anchor.rel = "noopener noreferrer";
    anchor.className = "telegram-bridge-link";
    document.body.append(anchor);
    anchor.click();
    window.setTimeout(() => {
      anchor.remove();
    }, 500);
  }

  private navigateToUrl(url: string): void {
    window.location.assign(url);
  }

  private openUrlInNewTab(url: string): void {
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    if (opened) {
      return;
    }

    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.click();
  }

  private telegramDeepLink(proxyUrl: string): string {
    try {
      const url = new URL(proxyUrl);
      return `tg://proxy?${url.searchParams.toString()}`;
    } catch {
      return proxyUrl;
    }
  }

  private telegramChannelDeepLink(channelUrl: string): string {
    try {
      const url = new URL(channelUrl);
      const domain = url.pathname.replace(/^\/+/, "").split("/")[0];
      return domain ? `tg://resolve?domain=${encodeURIComponent(domain)}` : channelUrl;
    } catch {
      return channelUrl;
    }
  }

  private renderAdminScene(): HTMLElement {
    const payload = this.adminPayload;
    const shell = document.createElement("main");
    shell.className = `admin-shell${this.panelClosing ? " is-closing" : ""}`;

    const header = document.createElement("section");
    header.className = "admin-intro admin-topbar";
    header.innerHTML = `
      <div class="admin-topbar-copy">
        <p class="admin-kicker">hidden admin</p>
        <h1>Панель управления</h1>
        <p class="admin-intro-copy">Скрытая control panel для доступов, кошельков и быстрых действий без лишнего шума.</p>
      </div>
    `;
    header.append(this.renderPanelCloseButton("Вернуться на главную"));
    shell.append(header);

    if (this.adminNotice) {
      const notice = document.createElement("section");
      notice.className = `admin-notice admin-notice-${this.adminNotice.tone}`;
      notice.textContent = this.adminNotice.text;
      shell.append(notice);
    }

    if (!payload) {
      shell.append(this.renderAdminLoadingState());
      return shell;
    }

    shell.append(this.renderAdminTopStatus(payload));

    const stack = document.createElement("section");
    stack.className = "admin-section-stack";
    stack.append(
      this.renderAdminSection("access", "Access", "Добавить пароль, сменить пароль, назначить режим и убрать лишние правила в архив.", this.renderAccessRules(payload.accessRules, payload.modes), `${payload.accessRules.filter((rule) => rule.isEnabled && !rule.softDeletedAt).length} активных`),
      this.renderAdminSection("quick", "Quick actions", "Только четыре частых действия: вход в proxies, refresh, lock и donate.", this.renderAdminGuide(payload), "4 действия"),
      this.renderAdminSection("wallets", "Wallets", "Полное управление donate block и нижними сетями домашней сцены.", this.renderWallets(payload.wallets, payload.settings), `${payload.wallets.length} сети`),
      this.renderAdminSection("service", "Service", "Health, export/import и короткая лента последних событий.", this.renderAdminUtility(payload), `${Math.min(payload.audit.length, 10)} событий`)
    );

    shell.append(stack);
    return shell;
  }

  private renderAdminLoadingState(): HTMLElement {
    const card = document.createElement("section");
    card.className = "admin-card admin-loading-card";
    card.innerHTML = `
      <div class="admin-card-header">
        <h2>${this.adminError ? "Не удалось загрузить данные админки" : "Загружаем данные админки"}</h2>
        <p>${this.adminError ? "Попробуйте подождать секунду или снова открыть hidden admin. Архитектура и доступы уже живы, сейчас загружается только интерфейс управления." : "Подтягиваем режимы, правила доступа, кошельки и журнал событий."}</p>
      </div>
    `;
    return card;
  }

  private async ensureAdminPayload(force = false): Promise<void> {
    if (this.adminLoading && !force) {
      return;
    }

    if (this.adminPayload && !force) {
      return;
    }

    this.adminLoading = true;
    this.adminError = null;
    if (this.scene === "mode" && this.session.mode === "admin_mode") {
      this.render();
    }

    try {
      this.adminPayload = await this.fetchAdminPayload();
    } catch {
      this.adminError = "load_failed";
    } finally {
      this.adminLoading = false;
      if (this.scene === "mode" && this.session.mode === "admin_mode") {
        this.render();
      }
    }
  }

  private renderAdminSection(
    key: AdminSectionKey,
    title: string,
    description: string,
    content: HTMLElement,
    meta: string
  ): HTMLElement {
    const section = document.createElement("details");
    section.className = "admin-card admin-section";
    section.open = this.adminSections[key];
    section.innerHTML = `
      <summary class="admin-section-summary">
        <div class="admin-section-summary-copy">
          <h2>${title}</h2>
          <p>${description}</p>
        </div>
        <div class="admin-section-summary-side">
          <span class="admin-section-meta">${meta}</span>
          <span class="admin-section-arrow" aria-hidden="true"></span>
        </div>
      </summary>
    `;
    section.addEventListener("toggle", () => {
      this.adminSections[key] = section.open;
    });

    const body = document.createElement("div");
    body.className = "admin-section-body";
    body.append(content);
    section.append(body);
    return section;
  }

  private renderAdminTopStatus(payload: AdminPayload): HTMLElement {
    const publicMode = payload.modes.find((mode) => mode.isDefaultPublic);
    const activeRules = payload.accessRules.filter((rule) => rule.isEnabled && !rule.softDeletedAt).length;
    const wrap = document.createElement("section");
    wrap.className = "admin-top-status";
    wrap.innerHTML = `
      <span class="admin-top-pill">публично: ${publicMode ? this.modeLabel(publicMode.id) : "не выбрано"}</span>
      <span class="admin-top-pill">активных правил: ${activeRules}</span>
      <span class="admin-top-pill">donate: ${payload.settings["donate.visible"] ? "on" : "off"}</span>
      <span class="admin-top-pill">worker: ${String(payload.health.worker ?? "ok")}</span>
    `;
    return wrap;
  }

  private renderHealth(payload: AdminPayload): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "admin-list admin-health-list";
    wrap.innerHTML = Object.entries(payload.health)
      .map(([key, value]) => `<p><span>${this.healthLabel(key)}</span><strong>${this.healthValue(value)}</strong></p>`)
      .join("");
    return wrap;
  }

  private renderAdminGuide(payload: AdminPayload): HTMLElement {
    const proxiesRules = payload.accessRules.filter((rule) => !rule.softDeletedAt && rule.targetMode === "proxies_mode");
    const activeProxyRule = proxiesRules.find((rule) => rule.isEnabled);
    const wrap = document.createElement("div");
    wrap.className = "admin-actions-panel";
    const actions = document.createElement("div");
    actions.className = "admin-actions admin-actions-wide";

    const openProxies = document.createElement("button");
    openProxies.textContent = activeProxyRule ? "Войти в proxies" : "Открыть ввод для proxies";
    openProxies.addEventListener("click", () => {
      this.openPasswordSceneFromPanel();
    });

    const refresh = document.createElement("button");
    refresh.textContent = "Обновить прокси сейчас";
    refresh.addEventListener("click", () => void this.adminAction("/api/admin/refresh-now", "Прокси обновлены."));

    const lock = document.createElement("button");
    lock.textContent = "Мгновенно заблокировать";
    lock.className = "danger";
    lock.addEventListener("click", () => void this.adminAction("/api/admin/lock-now", "Активные защищенные сессии сброшены."));

    const donateToggle = document.createElement("button");
    const donateVisible = Boolean(payload.settings["donate.visible"]);
    donateToggle.textContent = donateVisible ? "Скрыть donate" : "Показать donate";
    donateToggle.addEventListener("click", () => {
      void this.runAdminTask(
        () => this.fetchJson(this.apiUrl("/api/admin/settings"), {
          method: "PUT",
          headers: { ...this.authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({
            "donate.visible": !donateVisible
          })
        }),
        donateVisible ? "Donate скрыт." : "Donate показан."
      );
    });

    actions.append(openProxies, refresh, lock, donateToggle);
    wrap.append(actions);

    const note = document.createElement("div");
    note.className = "admin-helper";
    note.innerHTML = `<p>${activeProxyRule ? `Сейчас активен пароль «${this.escapeHtml(activeProxyRule.label)}». Если нужно сменить его или создать новый, используйте главный блок Access.` : "Активного пароля для proxies сейчас нет. Создайте его в блоке Access."}</p>`;
    wrap.append(note);

    return wrap;
  }

  private renderModes(modes: ModeSummary[]): HTMLElement {
    const list = document.createElement("div");
    list.className = "admin-list";

    for (const mode of modes) {
      const row = document.createElement("form");
      row.className = "admin-form-row admin-form-card";
      row.innerHTML = `
        <div class="admin-form-heading">
          <strong>${this.modeLabel(mode.id)}</strong>
          <p>${this.modeHelp(mode.id)}</p>
        </div>
        <label>Тип доступа
          <select name="accessState">
            <option value="public" ${mode.accessState === "public" ? "selected" : ""}>публичный</option>
            <option value="locked" ${mode.accessState === "locked" ? "selected" : ""}>закрытый</option>
          </select>
        </label>
        <label>Режим включен
          <input name="isEnabled" type="checkbox" ${mode.isEnabled ? "checked" : ""} />
        </label>
        <label>Открывать всем по умолчанию
          <input name="isDefaultPublic" type="checkbox" ${mode.isDefaultPublic ? "checked" : ""} />
        </label>
        <button type="submit">Сохранить режим</button>
      `;
      row.addEventListener("submit", (event) => {
        event.preventDefault();
        const form = new FormData(row);
        void this.runAdminTask(
          () => this.fetchJson(this.apiUrl(`/api/admin/modes/${mode.id}`), {
            method: "PUT",
            headers: { ...this.authHeaders(), "Content-Type": "application/json" },
            body: JSON.stringify({
              accessState: form.get("accessState"),
              isEnabled: form.get("isEnabled") === "on",
              isDefaultPublic: form.get("isDefaultPublic") === "on"
            })
          }),
          `Режим «${this.modeLabel(mode.id)}» сохранен.`
        );
      });
      list.append(row);
    }

    return list;
  }

  private renderSettings(settings: Record<string, unknown>): HTMLElement {
    const form = document.createElement("form");
    form.className = "admin-form-row";
    form.innerHTML = `
      <label>Показывать donate block
        <input name="donate.visible" type="checkbox" ${settings["donate.visible"] ? "checked" : ""} />
      </label>
      <button type="submit">Сохранить donate</button>
    `;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(form);
      void this.runAdminTask(
        () => this.fetchJson(this.apiUrl("/api/admin/settings"), {
          method: "PUT",
          headers: { ...this.authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({
            "donate.visible": data.get("donate.visible") === "on"
          })
        }),
        "Donate-настройка сохранена."
      );
    });
    return form;
  }

  private renderAccessRules(rules: AccessRuleSummary[], modes: ModeSummary[]): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "admin-list";

    wrap.append(this.renderQuickProxyRuleCreate());

    const add = document.createElement("form");
    add.className = "admin-form-row admin-form-card admin-create-card";
      add.innerHTML = `
      <div class="admin-form-heading">
        <strong>Создать новое правило доступа</strong>
        <p>Например: отдельный пароль для прокси или новый пароль для входа в админку.</p>
      </div>
      <label>Понятное название
        <input name="label" required placeholder="например, доступ в прокси" />
      </label>
      <label>Какой режим открывает этот пароль
        <select name="targetMode" required>${this.modeOptions(modes)}</select>
      </label>
      <label>Приоритет <input name="priority" type="number" value="100" /></label>
      <label>Новый пароль <input name="password" required /></label>
      <details class="admin-advanced">
        <summary>Дополнительные настройки</summary>
        <div class="admin-advanced-grid">
          <label>Комментарий для вас <input name="notes" placeholder="необязательно" /></label>
          <label>Когда перестанет работать <input name="expiresAt" type="datetime-local" /></label>
          <label>Сколько раз можно использовать <input name="maxUses" type="number" min="1" /></label>
          <label>Разрешить только один успешный вход <input name="firstUseOnly" type="checkbox" /></label>
        </div>
      </details>
      <button type="submit">Создать правило</button>
    `;
    add.addEventListener("submit", (event) => {
      event.preventDefault();
      const form = new FormData(add);
      void this.runAdminTask(
        () => this.fetchJson(this.apiUrl("/api/admin/access-rules"), {
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
        }),
        "Новое правило доступа создано."
      ).then((result) => {
        if (result !== undefined) {
          add.reset();
        }
      });
    });
    wrap.append(add);

    const activeRules = rules.filter((rule) => !rule.softDeletedAt && rule.isEnabled);
    const disabledRules = rules.filter((rule) => !rule.softDeletedAt && !rule.isEnabled);
    const archivedRules = rules.filter((rule) => Boolean(rule.softDeletedAt));

    wrap.append(this.renderRuleGroup("Рабочие правила", "Ими можно пользоваться прямо сейчас. Здесь оставлены только основные действия: поменять режим, пароль или статус.", activeRules, modes));

    if (disabledRules.length > 0) {
      wrap.append(this.renderRuleGroup("Выключенные правила", "Они сохранены, но сейчас не работают. Это удобно для временно отключенных паролей.", disabledRules, modes, true));
    }

    if (archivedRules.length > 0) {
      wrap.append(this.renderRuleGroup("Архив", "Старые или временно отключенные правила. Их можно вернуть или оставить как историю.", archivedRules, modes, true));
    }

    const modesSection = document.createElement("details");
    modesSection.className = "admin-inset-card admin-section-inline";
    modesSection.innerHTML = `
      <summary class="admin-subsection-header">
        <h3>Режимы сайта</h3>
        <p>Публичность, блокировка и режим по умолчанию.</p>
      </summary>
    `;
    modesSection.append(this.renderModes(modes));
    wrap.append(modesSection);

    return wrap;
  }

  private renderQuickProxyRuleCreate(): HTMLElement {
    const quickProxy = document.createElement("form");
    quickProxy.className = "admin-form-row admin-form-card admin-create-card admin-quick-create";
    quickProxy.innerHTML = `
      <div class="admin-form-heading">
        <strong>Быстрый пароль для proxies_mode</strong>
        <p>Самый короткий путь: введите пароль и сохраните новое правило для прокси.</p>
      </div>
      <label>Название
        <input name="label" value="доступ в прокси" />
      </label>
      <label>Пароль
        <input name="password" required />
      </label>
      <label>Комментарий
        <input name="notes" placeholder="необязательно" />
      </label>
      <button type="submit">Создать пароль для прокси</button>
    `;
    quickProxy.addEventListener("submit", (event) => {
      event.preventDefault();
      const form = new FormData(quickProxy);
      void this.runAdminTask(
        () => this.fetchJson(this.apiUrl("/api/admin/access-rules"), {
          method: "POST",
          headers: { ...this.authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({
            label: String(form.get("label") ?? "доступ в прокси"),
            targetMode: "proxies_mode",
            priority: 100,
            password: String(form.get("password") ?? ""),
            notes: String(form.get("notes") ?? "")
          })
        }),
        "Пароль для прокси создан."
      ).then((result) => {
        if (result !== undefined) {
          quickProxy.reset();
        }
      });
    });
    return quickProxy;
  }

  private renderRuleGroup(title: string, description: string, rules: AccessRuleSummary[], modes: ModeSummary[], collapsed = false): HTMLElement {
    const group = document.createElement("section");
    group.className = "admin-rule-group";
    const body = document.createElement(collapsed ? "details" : "div");
    body.className = collapsed ? "admin-rule-shell admin-rule-shell-collapsed" : "admin-rule-shell";
    if (body instanceof HTMLDetailsElement) {
      body.open = false;
      body.innerHTML = `
        <summary class="admin-subsection-header">
          <h3>${title}</h3>
          <p>${description}</p>
        </summary>
      `;
    } else {
      body.innerHTML = `
        <div class="admin-subsection-header">
          <h3>${title}</h3>
          <p>${description}</p>
        </div>
      `;
    }

    const list = document.createElement("div");
    list.className = "admin-list";

    for (const rule of rules) {
      const row = document.createElement("form");
      row.className = "admin-form-row admin-form-card";
      row.innerHTML = `
        <div class="admin-form-heading">
          <strong>${this.escapeHtml(rule.label)}</strong>
          <p>Открывает режим: ${this.modeLabel(rule.targetMode)}</p>
        </div>
        <div class="admin-badges">
          <span class="admin-badge">${rule.softDeletedAt ? "в архиве" : rule.isEnabled ? "включено" : "выключено"}</span>
          <span class="admin-badge">успешных входов: ${rule.successCount}</span>
          <span class="admin-badge">${rule.lastUsedAt ? `последний вход ${this.formatTimestamp(rule.lastUsedAt)}` : "еще не использовалось"}</span>
        </div>
        <label>Открывает режим
          <select name="targetMode">${this.modeOptions(modes, rule.targetMode)}</select>
        </label>
        <label>Новый пароль
          <input name="password" type="text" placeholder="введите только если хотите сменить пароль" />
        </label>
        <label>Правило включено
          <input name="isEnabled" type="checkbox" ${rule.isEnabled ? "checked" : ""} ${rule.softDeletedAt ? "disabled" : ""} />
        </label>
        <label>Убрать в архив
          <input name="softDelete" type="checkbox" ${rule.softDeletedAt ? "checked" : ""} />
        </label>
        <details class="admin-advanced">
          <summary>Дополнительно: название, лимиты, срок, заметки</summary>
          <div class="admin-advanced-grid">
            <label>Название правила
              <input name="label" value="${this.escapeHtml(rule.label)}" />
            </label>
            <label>Приоритет
              <input name="priority" type="number" value="${rule.priority}" />
            </label>
            <label>Комментарий
              <input name="notes" value="${this.escapeHtml(rule.notes ?? "")}" placeholder="для ваших заметок" />
            </label>
            <label>Когда перестанет работать
              <input name="expiresAt" type="datetime-local" value="${this.toDatetimeLocalValue(rule.expiresAt)}" />
            </label>
            <label>Максимум использований
              <input name="maxUses" type="number" min="1" value="${rule.maxUses ?? ""}" />
            </label>
            <label>Только один успешный вход
              <input name="firstUseOnly" type="checkbox" ${rule.firstUseOnly ? "checked" : ""} />
            </label>
          </div>
          <div class="admin-stats">
            <p class="admin-rule-meta">Всего попыток: ${rule.usageCount}</p>
            <p class="admin-rule-meta">Успешных входов: ${rule.successCount}</p>
            <p class="admin-rule-meta">Ошибок: ${rule.failCount}</p>
            <p class="admin-rule-meta">Последнее использование: ${rule.lastUsedAt ? this.formatTimestamp(rule.lastUsedAt) : "никогда"}</p>
          </div>
        </details>
        <button type="submit">Сохранить правило</button>
      `;
      row.addEventListener("submit", (event) => {
        event.preventDefault();
        const form = new FormData(row);
        void this.runAdminTask(
          () => this.fetchJson(this.apiUrl(`/api/admin/access-rules/${rule.id}`), {
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
          }),
          `Правило «${rule.label}» сохранено.`
        );
      });
      list.append(row);
    }

    body.append(list);
    group.append(body);
    return group;
  }

  private renderWallets(wallets: WalletEntry[], settings: Record<string, unknown>): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "admin-list";

    wrap.append(this.renderSettings(settings));

    const sorted = [...wallets].sort((left, right) => left.sortOrder - right.sortOrder);
    for (const wallet of sorted) {
      const row = document.createElement("form");
      row.className = "admin-form-row admin-form-card";
      row.innerHTML = `
        <div class="admin-form-heading">
          <strong>${wallet.network.toUpperCase()}</strong>
          <p>Текущая подпись: ${wallet.title}</p>
        </div>
        <label>Подпись сети <input name="title" value="${this.escapeHtml(wallet.title)}" /></label>
        <label>Адрес <input name="address" value="${this.escapeHtml(wallet.address)}" /></label>
        <label>QR payload <input name="qrPayload" value="${this.escapeHtml(wallet.qrPayload)}" /></label>
        <label>Предупреждение <input name="warningText" value="${this.escapeHtml(wallet.warningText)}" /></label>
        <label>Порядок <input name="sortOrder" type="number" value="${wallet.sortOrder}" /></label>
        <label>Показывать сеть <input name="isEnabled" type="checkbox" ${wallet.isEnabled ? "checked" : ""} /></label>
        <button type="submit">Сохранить кошелек</button>
      `;
      row.addEventListener("submit", (event) => {
        event.preventDefault();
        const form = new FormData(row);
        void this.runAdminTask(
          () => this.fetchJson(this.apiUrl(`/api/admin/wallets/${wallet.id}`), {
            method: "PUT",
            headers: { ...this.authHeaders(), "Content-Type": "application/json" },
            body: JSON.stringify({
              title: form.get("title"),
              address: form.get("address"),
              qrPayload: form.get("qrPayload"),
              warningText: form.get("warningText"),
              sortOrder: Number(form.get("sortOrder") ?? wallet.sortOrder),
              isEnabled: form.get("isEnabled") === "on"
            })
          }),
          `Кошелек ${wallet.network.toUpperCase()} сохранен.`
        );
      });
      wrap.append(row);
    }

    return wrap;
  }

  private renderAdminUtility(payload: AdminPayload): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "admin-list admin-utility-stack";

    const summary = document.createElement("div");
    summary.className = "admin-service-summary";
    summary.innerHTML = `
      <article class="admin-overview-card">
        <p class="admin-overview-label">worker</p>
        <strong>${this.healthValue(payload.health.worker)}</strong>
      </article>
      <article class="admin-overview-card">
        <p class="admin-overview-label">refresh</p>
        <strong>${this.healthValue(payload.health.last_refresh_status)}</strong>
      </article>
      <article class="admin-overview-card">
        <p class="admin-overview-label">bootstrap</p>
        <strong>${this.healthValue(payload.health.bootstrapMessage)}</strong>
      </article>
    `;

    const auditCard = this.sectionInset("Последние события", "Последние 8 действий.", this.renderAudit(payload.audit.slice(0, 8)));
    const healthDetails = document.createElement("details");
    healthDetails.className = "admin-inset-card admin-section-inline";
    healthDetails.innerHTML = `
      <summary class="admin-subsection-header">
        <h3>Подробный health</h3>
        <p>Полный технический статус и тайминги.</p>
      </summary>
    `;
    healthDetails.append(this.renderHealth(payload));

    wrap.append(summary, this.renderExports(), auditCard, healthDetails);
    return wrap;
  }

  private sectionInset(title: string, description: string, content: HTMLElement): HTMLElement {
    const card = document.createElement("section");
    card.className = "admin-inset-card";
    card.innerHTML = `
      <div class="admin-subsection-header">
        <h3>${title}</h3>
        <p>${description}</p>
      </div>
    `;
    card.append(content);
    return card;
  }

  private renderExports(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "admin-actions admin-actions-wide";
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
      await this.runAdminTask(
        () => this.fetchJson(this.apiUrl(`/api/admin/import?kind=${select.value}`), {
          method: "POST",
          headers: { ...this.authHeaders(), "Content-Type": "application/json" },
          body: text
        }),
        "Импорт завершен."
      );
    });
    wrap.append(select, input, button);
    return wrap;
  }

  private renderAudit(audit: AdminPayload["audit"]): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "admin-list";
    if (audit.length === 0) {
      wrap.innerHTML = `<p><span>события</span><strong>пока пусто</strong></p>`;
      return wrap;
    }
    wrap.innerHTML = audit
      .map((entry) => `<p><span>${this.auditEventLabel(entry.eventType)}</span><strong>${this.formatTimestamp(entry.createdAt)}</strong></p>`)
      .join("");
    return wrap;
  }

  private modeOptions(modes: ModeSummary[], selectedMode = ""): string {
    return modes
      .map((mode) => `<option value="${this.escapeHtml(mode.id)}" ${mode.id === selectedMode ? "selected" : ""}>${this.modeLabel(mode.id)}</option>`)
      .join("");
  }

  private modeHelp(modeId: string): string {
    if (modeId === "home_mode") {
      return "Публичная домашняя сцена. Обычно открыта всем без пароля.";
    }

    if (modeId === "proxies_mode") {
      return "Закрытый режим с прокси. Обычно сюда ведет отдельный пароль.";
    }

    if (modeId === "admin_mode") {
      return "Скрытая админка. Доступ сюда должен быть только у вас.";
    }

    return "Отдельный режим сайта.";
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
      <div class="wallet-card-top">
        <button type="button" class="panel-close panel-close-inline" aria-label="Закрыть окно">
          <span class="panel-close-line"></span>
          <span class="panel-close-line"></span>
        </button>
      </div>
      <h2>${wallet.title}</h2>
      <img alt="${wallet.title} qr" />
      <code>${wallet.address}</code>
      <button type="button" class="copy-button">${this.copiedWalletId === wallet.id ? "copied" : "copy address"}</button>
      <p>${wallet.warningText}</p>
    `;

    card.querySelector<HTMLButtonElement>(".panel-close-inline")?.addEventListener("click", () => {
      this.walletOverlay = null;
      this.copiedWalletId = null;
      this.render();
    });

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

  private async adminAction(path: string, successMessage: string): Promise<void> {
    await this.runAdminTask(
      () => this.fetchJson(this.apiUrl(path), { method: "POST", headers: this.authHeaders() }),
      successMessage
    );
  }

  private async runAdminTask<T>(task: () => Promise<T>, successMessage: string): Promise<T | undefined> {
    try {
      const result = await task();
      this.setAdminNotice("success", successMessage);
      await this.ensureAdminPayload(true);
      return result;
    } catch {
      this.setAdminNotice("error", "Не удалось применить изменение. Попробуйте еще раз.");
      if (this.scene === "mode" && this.session.mode === "admin_mode") {
        this.render();
      }
      return undefined;
    }
  }

  private setAdminNotice(tone: AdminNotice["tone"], text: string): void {
    this.adminNotice = { tone, text };
    if (this.adminNoticeHandle !== null) {
      window.clearTimeout(this.adminNoticeHandle);
    }
    this.adminNoticeHandle = window.setTimeout(() => {
      this.adminNotice = null;
      this.adminNoticeHandle = null;
      if (this.scene === "mode" && this.session.mode === "admin_mode") {
        this.render();
      }
    }, 3200);

    if (this.scene === "mode" && this.session.mode === "admin_mode") {
      this.render();
    }
  }

  private authHeaders(token = this.session.token): HeadersInit {
    return token ? { Authorization: `Bearer ${token}` } : {};
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

  private async fetchProxiesPayload(token = this.session.token ?? ""): Promise<ProxiesPayload> {
    return this.fetchJson<ProxiesPayload>(this.apiUrl("/api/modes/proxies_mode"), {
      headers: this.authHeaders(token)
    });
  }

  private async fetchAdminPayload(token = this.session.token ?? ""): Promise<AdminPayload> {
    return this.fetchJson<AdminPayload>(this.apiUrl("/api/admin/bootstrap"), {
      headers: this.authHeaders(token)
    });
  }

  private safeScrollIntoView(element: HTMLElement | null, options: ScrollIntoViewOptions): void {
    if (!element || typeof element.scrollIntoView !== "function") {
      return;
    }
    element.scrollIntoView(options);
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
        this.focusPasswordInputNow(input);
      }, delay);
      this.passwordFocusHandles.push(handle);
    }
  }

  private focusPasswordInputNow(target?: HTMLTextAreaElement | null): void {
    const input = target ?? this.passwordInput ?? this.root.querySelector<HTMLTextAreaElement>(".password-hidden-input");
    if (!input) {
      return;
    }

    input.focus({ preventScroll: true });
    const length = input.value.length;
    input.setSelectionRange(length, length);
  }

  private activatePasswordInputBridge(): void {
    const input = this.ensurePasswordInput();
    input.value = this.passwordBuffer;
    if (!input.isConnected) {
      document.body.append(input);
    }
    this.focusPasswordInputNow(input);
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
