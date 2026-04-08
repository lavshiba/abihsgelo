import QRCode from "qrcode";
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
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, "") ?? "";

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
  private passwordBuffer = "";
  private walletOverlay: WalletEntry | null = null;
  private snapshot: { fresh: ProxyItem[]; archive: ProxyItem[] } = { fresh: [], archive: [] };
  private archiveOpen = false;
  private pollingHandle: number | null = null;

  public constructor(root: HTMLDivElement) {
    this.root = root;
  }

  public async start(): Promise<void> {
    this.snapshot = await this.loadSnapshot();
    this.bootstrap = await this.fetchJson<BootstrapPayload>(this.apiUrl("/api/bootstrap")).catch(() => FALLBACK_BOOTSTRAP);
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
    this.root.innerHTML = "";
    this.root.className = `scene-root scene-${this.scene}`;

    if (this.scene === "home") {
      this.stopPolling();
      this.root.append(this.renderHomeScene());
    } else if (this.scene === "password") {
      this.stopPolling();
      this.root.append(this.renderPasswordScene());
    } else if (this.session.mode === "proxies_mode") {
      void this.renderProxiesScene();
    } else if (this.session.mode === "admin_mode") {
      void this.renderAdminScene();
    }

    if (this.walletOverlay) {
      void this.root.append(this.renderWalletOverlay(this.walletOverlay));
    }
  }

  private renderHomeScene(): HTMLElement {
    const shell = document.createElement("main");
    shell.className = "home-shell";
    shell.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      if (target.closest("[data-interactive='true']")) {
        return;
      }

      this.scene = "password";
      this.passwordBuffer = "";
      this.render();
      this.track("home_tap_to_enter");
    });

    shell.innerHTML = `
      <section class="home-top-stack">
        <p class="home-title">oleg shiba // abihsgelo</p>
        <a class="tg-button" data-interactive="true" href="${this.bootstrap.telegramUrl}" aria-label="Telegram" target="_blank" rel="noreferrer">
          <span>T</span>
        </a>
        <p class="home-year">${this.bootstrap.yearLabel}</p>
      </section>
      <section class="home-empty-plane" aria-hidden="true"></section>
    `;

    const tgButton = shell.querySelector<HTMLAnchorElement>(".tg-button");
    tgButton?.addEventListener("click", () => this.track("tg_click"));

    if (this.bootstrap.donateVisible) {
      shell.append(this.renderDonateBlock());
    }

    return shell;
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
    shell.className = "password-shell";

    const block = document.createElement("div");
    block.className = "password-block";
    block.tabIndex = 0;
    block.setAttribute("aria-label", "hidden password entry");
    block.addEventListener("keydown", (event) => void this.onPasswordKey(event));
    block.addEventListener("paste", (event) => {
      event.preventDefault();
      const pasted = event.clipboardData?.getData("text") ?? "";
      this.passwordBuffer += pasted;
      this.render();
    });

    const upper = this.passwordBuffer.toLocaleUpperCase("en-US");
    block.innerHTML = `
      <div class="cursor-layer ${upper ? "has-text" : ""}">
        ${upper ? this.renderPasswordLines(upper) : `<span class="center-cursor"></span>`}
      </div>
    `;
    const controls = document.createElement("form");
    controls.className = "password-controls";
    controls.innerHTML = `
      <label class="password-label" for="password-fallback">hidden entry</label>
      <input
        id="password-fallback"
        class="password-input"
        type="password"
        inputmode="text"
        autocomplete="off"
        autocapitalize="none"
        autocorrect="off"
        spellcheck="false"
        placeholder="type password"
        value="${this.escapeHtml(this.passwordBuffer)}"
      />
      <div class="password-actions">
        <button type="submit" class="password-submit">enter</button>
        <button type="button" class="password-cancel">back</button>
      </div>
    `;

    const input = controls.querySelector<HTMLInputElement>(".password-input");
    input?.addEventListener("input", (event) => {
      this.passwordBuffer = (event.currentTarget as HTMLInputElement).value;
      this.render();
    });
    controls.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.submitPassword();
    });
    controls.querySelector<HTMLButtonElement>(".password-cancel")?.addEventListener("click", () => {
      this.passwordBuffer = "";
      this.scene = "home";
      this.render();
    });

    shell.addEventListener("click", (event) => {
      if (!(event.target instanceof HTMLElement)) {
        return;
      }
      if (event.target.closest(".password-controls")) {
        return;
      }
      input?.focus();
    });

    shell.append(block, controls);

    queueMicrotask(() => input?.focus() ?? block.focus());
    return shell;
  }

  private renderPasswordLines(input: string): string {
    const characters = [...input];
    const viewportWidth = typeof window !== "undefined" ? Math.max(window.innerWidth, 320) : 1200;
    const columns = characters.length <= 2 ? characters.length : Math.max(4, Math.floor(viewportWidth / 150));
    const lines: string[] = [];

    for (let index = 0; index < characters.length; index += columns) {
      lines.push(characters.slice(index, index + columns).join(""));
    }

    return `<div class="password-lines">${lines
      .map((line, index) => `<p class="password-line" style="opacity:${0.62 + index / Math.max(lines.length, 1) * 0.34}">${line}</p>`)
      .join("")}<span class="tail-cursor"></span></div>`;
  }

  private async onPasswordKey(event: KeyboardEvent): Promise<void> {
    if (event.key === "Escape") {
      this.passwordBuffer = "";
      this.scene = "home";
      this.render();
      return;
    }

    if (event.key === "Backspace") {
      event.preventDefault();
      this.passwordBuffer = this.passwordBuffer.slice(0, -1);
      this.render();
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      if (!this.passwordBuffer.trim()) {
        return;
      }

      await this.submitPassword();
      return;
    }

    if (event.key.length === 1) {
      event.preventDefault();
      this.passwordBuffer += event.key;
      this.render();
    }
  }

  private async submitPassword(): Promise<void> {
    const timeout = window.setTimeout(() => {
      this.track("worker_timeout");
      this.scene = "home";
      this.passwordBuffer = "";
      this.render();
    }, 3800);

    try {
      const result = await this.fetchJson<{ ok: boolean; mode?: string; token?: string }>(this.apiUrl("/api/auth/enter"), {
        method: "POST",
        body: JSON.stringify({ password: this.passwordBuffer }),
        headers: { "Content-Type": "application/json" }
      });

      window.clearTimeout(timeout);

      if (!result.ok || !result.mode || !result.token) {
        this.scene = "home";
        this.passwordBuffer = "";
        this.render();
        return;
      }

      this.session = { mode: result.mode, token: result.token };
      this.passwordBuffer = "";
      this.scene = "mode";
      this.render();
    } catch {
      window.clearTimeout(timeout);
      this.scene = "home";
      this.passwordBuffer = "";
      this.render();
    }
  }

  private async renderProxiesScene(): Promise<void> {
    const payload = await this.fetchJson<ProxiesPayload>(this.apiUrl("/api/modes/proxies_mode"), {
      headers: this.authHeaders()
    }).catch(() => {
      return {
        mode: "proxies_mode" as const,
        title: this.snapshot.fresh.length ? `последние ${this.snapshot.fresh.length} свежих прокси` : "идет первая загрузка прокси...",
        lastSuccessfulRefreshAt: null,
        isStale: true,
        staleReason: "temporarily showing last saved snapshot",
        fresh: this.snapshot.fresh,
        archive: this.snapshot.archive
      };
    });

    const shell = document.createElement("main");
    shell.className = "proxies-shell";
    shell.innerHTML = `
      <section class="proxies-stack">
        <h1>${payload.title}</h1>
        <p class="status-line">последнее успешное обновление: ${payload.lastSuccessfulRefreshAt ? this.formatTimestamp(payload.lastSuccessfulRefreshAt) : "—"}</p>
        ${payload.isStale ? `<p class="stale-line">временно показана последняя сохраненная версия</p>` : ""}
      </section>
    `;

    shell.append(this.renderFreshGrid(payload.fresh));
    if (payload.archive.length > 0) {
      shell.append(this.renderArchive(payload.archive));
    }

    this.root.append(shell);
    this.startPolling();
  }

  private renderFreshGrid(items: ProxyItem[]): HTMLElement {
    const grid = document.createElement("section");
    grid.className = "fresh-grid";

    for (const item of items.slice(0, 9)) {
      const card = document.createElement("a");
      card.className = "proxy-card";
      card.href = item.proxyUrl;
      card.target = "_blank";
      card.rel = "noreferrer";
      const date = new Date(item.postedAt);
      card.innerHTML = `
        <strong>#${item.proxyNumber}</strong>
        <span>${date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</span>
        <span>${date.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit" })}</span>
      `;
      card.addEventListener("click", () => this.track("proxy_click", { proxyId: item.id }));
      grid.append(card);
    }

    return grid;
  }

  private renderArchive(items: ProxyItem[]): HTMLElement {
    const section = document.createElement("section");
    section.className = `archive-zone ${this.archiveOpen ? "is-open" : ""}`;

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "archive-trigger";
    trigger.textContent = `прокси постарее (${items.length})`;
    trigger.addEventListener("click", () => {
      this.archiveOpen = !this.archiveOpen;
      this.track(this.archiveOpen ? "archive_open" : "archive_close");
      this.render();
    });

    section.append(trigger);

    if (this.archiveOpen) {
      const grid = document.createElement("div");
      grid.className = "archive-grid";
      for (const item of items) {
        const card = document.createElement("a");
        card.className = "archive-card";
        card.href = item.proxyUrl;
        card.target = "_blank";
        card.rel = "noreferrer";
        card.textContent = `#${item.proxyNumber}`;
        card.addEventListener("click", () => this.track("proxy_click", { proxyId: item.id, archive: true }));
        grid.append(card);
      }
      section.append(grid);
    }

    return section;
  }

  private async renderAdminScene(): Promise<void> {
    const payload = await this.fetchJson<AdminPayload>(this.apiUrl("/api/admin/bootstrap"), {
      headers: this.authHeaders()
    });

    const shell = document.createElement("main");
    shell.className = "admin-shell";
    shell.append(
      this.sectionCard("health", this.renderHealth(payload)),
      this.sectionCard("settings", this.renderSettings(payload.settings)),
      this.sectionCard("modes", this.renderModes(payload.modes)),
      this.sectionCard("access rules", this.renderAccessRules(payload.accessRules)),
      this.sectionCard("wallets", this.renderWallets(payload.wallets)),
      this.sectionCard("exports", this.renderExports()),
      this.sectionCard("audit", this.renderAudit(payload.audit))
    );
    this.root.append(shell);
  }

  private sectionCard(title: string, content: HTMLElement): HTMLElement {
    const card = document.createElement("section");
    card.className = "admin-card";
    const heading = document.createElement("h2");
    heading.textContent = title;
    card.append(heading, content);
    return card;
  }

  private renderHealth(payload: AdminPayload): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "admin-list";
    wrap.innerHTML = Object.entries(payload.health)
      .map(([key, value]) => `<p><span>${key}</span><strong>${String(value)}</strong></p>`)
      .join("");

    const actions = document.createElement("div");
    actions.className = "admin-actions";

    const refresh = document.createElement("button");
    refresh.textContent = "refresh now";
    refresh.addEventListener("click", () => void this.adminAction("/api/admin/refresh-now"));

    const lock = document.createElement("button");
    lock.textContent = "lock now";
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
        <strong>${mode.id}</strong>
        <label>state
          <select name="accessState">
            <option value="public" ${mode.accessState === "public" ? "selected" : ""}>public</option>
            <option value="locked" ${mode.accessState === "locked" ? "selected" : ""}>locked</option>
          </select>
        </label>
        <label>enabled
          <input name="isEnabled" type="checkbox" ${mode.isEnabled ? "checked" : ""} />
        </label>
        <label>default
          <input name="isDefaultPublic" type="checkbox" ${mode.isDefaultPublic ? "checked" : ""} />
        </label>
        <button type="submit">save</button>
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
      <label>donate visible
        <input name="donate.visible" type="checkbox" ${settings["donate.visible"] ? "checked" : ""} />
      </label>
      <label>panic mode
        <input name="panic_mode" type="checkbox" ${settings["panic_mode"] ? "checked" : ""} />
      </label>
      <button type="submit">save</button>
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
        <strong>${rule.label}</strong>
        <label>mode
          <input name="targetMode" value="${rule.targetMode}" />
        </label>
        <label>priority
          <input name="priority" type="number" value="${rule.priority}" />
        </label>
        <label>enabled
          <input name="isEnabled" type="checkbox" ${rule.isEnabled ? "checked" : ""} />
        </label>
        <label>password
          <input name="password" type="text" placeholder="leave empty to keep" />
        </label>
        <button type="submit">save</button>
      `;
      row.addEventListener("submit", (event) => {
        event.preventDefault();
        const form = new FormData(row);
        void this.fetchJson(this.apiUrl(`/api/admin/access-rules/${rule.id}`), {
          method: "PUT",
          headers: { ...this.authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({
            targetMode: form.get("targetMode"),
            priority: Number(form.get("priority")),
            isEnabled: form.get("isEnabled") === "on",
            password: String(form.get("password") ?? "")
          })
        }).then(() => this.render());
      });
      wrap.append(row);
    }

    const add = document.createElement("form");
    add.className = "admin-form-row";
    add.innerHTML = `
      <strong>new rule</strong>
      <label>label <input name="label" required /></label>
      <label>mode <input name="targetMode" required /></label>
      <label>password <input name="password" required /></label>
      <button type="submit">add</button>
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
          password: form.get("password")
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
        <strong>${wallet.network}</strong>
        <label>address <input name="address" value="${wallet.address}" /></label>
        <label>warning <input name="warningText" value="${wallet.warningText}" /></label>
        <label>enabled <input name="isEnabled" type="checkbox" ${wallet.isEnabled ? "checked" : ""} /></label>
        <button type="submit">save</button>
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
      anchor.textContent = `export ${kind}`;
      anchor.target = "_blank";
      anchor.rel = "noreferrer";
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
      <option value="access_rules">access_rules</option>
      <option value="wallets">wallets</option>
      <option value="site_settings">site_settings</option>
    `;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "import selected json";
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
      .map((entry) => `<p><span>${entry.eventType}</span><strong>${this.formatTimestamp(entry.createdAt)}</strong></p>`)
      .join("");
    return wrap;
  }

  private renderWalletOverlay(wallet: WalletEntry): HTMLElement {
    const overlay = document.createElement("div");
    overlay.className = "wallet-overlay";
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        this.walletOverlay = null;
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
      <button type="button" class="copy-button">copy address</button>
      <p>${wallet.warningText}</p>
    `;

    const button = card.querySelector<HTMLButtonElement>(".copy-button");
    button?.addEventListener("click", async () => {
      await navigator.clipboard.writeText(wallet.address);
      this.track("wallet_copy", { walletId: wallet.id });
      button.textContent = "copied";
      window.setTimeout(() => {
        button.textContent = "copy address";
      }, 600);
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
      if (document.visibilityState === "visible" && !this.archiveOpen && this.session.mode === "proxies_mode") {
        this.render();
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
}
