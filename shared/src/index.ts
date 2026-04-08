export type ModeId = "home_mode" | "proxies_mode" | "admin_mode" | (string & {});

export interface WalletEntry {
  id: string;
  network: string;
  title: string;
  address: string;
  qrPayload: string;
  warningText: string;
  isEnabled: boolean;
  sortOrder: number;
}

export interface ProxyItem {
  id: string;
  proxyNumber: number;
  proxyUrl: string;
  postedAt: string;
  sourceMessageId: string;
  clickCount?: number;
}

export interface ModeSummary {
  id: ModeId;
  label: string;
  accessState: "public" | "locked";
  isEnabled: boolean;
  isDefaultPublic: boolean;
}

export interface BootstrapPayload {
  siteName: "abihsgelo";
  defaultPublicMode: ModeId;
  donateVisible: boolean;
  telegramUrl: string;
  wallets: WalletEntry[];
  yearLabel: string;
  snapshotAgeSeconds: number | null;
  workerAvailable: boolean;
  panicMode: boolean;
}

export interface ProxiesPayload {
  mode: "proxies_mode";
  title: string;
  lastSuccessfulRefreshAt: string | null;
  isStale: boolean;
  staleReason: string | null;
  fresh: ProxyItem[];
  archive: ProxyItem[];
}

export interface AdminPayload {
  mode: "admin_mode";
  modes: ModeSummary[];
  wallets: WalletEntry[];
  accessRules: AccessRuleSummary[];
  settings: Record<string, unknown>;
  health: Record<string, unknown>;
  audit: AuditEvent[];
}

export interface AccessRuleSummary {
  id: string;
  label: string;
  targetMode: ModeId;
  isEnabled: boolean;
  priority: number;
  notes: string | null;
  usageCount: number;
  successCount: number;
  failCount: number;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  maxUses: number | null;
  firstUseOnly: boolean;
  softDeletedAt: string | null;
}

export interface AuditEvent {
  id: number;
  eventType: string;
  actorType: string;
  createdAt: string;
  metadataJson: string | null;
}

export interface SnapshotPayload {
  generatedAt: string;
  source: string;
  fresh: ProxyItem[];
  archive: ProxyItem[];
}

export function normalizePassword(input: string): string {
  return input.trim().toLocaleUpperCase("en-US");
}

export function buildProxyTitle(count: number): string {
  if (count <= 0) {
    return "идет первая загрузка прокси...";
  }

  if (count === 1) {
    return "последний свежий прокси";
  }

  return `последние ${count} свежих прокси`;
}

export function parseTelegramProxies(html: string): ProxyItem[] {
  const blocks = [...html.matchAll(/data-post="ProxyMTProto\/(\d+)"[\s\S]*?<time datetime="([^"]+)"[\s\S]*?<a class="tgme_widget_message_date" href="([^"]+)"/g)];
  const items: ProxyItem[] = [];

  for (const match of blocks) {
    const sourceMessageId = match[1];
    const postedAt = match[2];
    const messageUrl = match[3];
    const sliceStart = match.index ?? 0;
    const slice = html.slice(sliceStart, sliceStart + 2000);
    const proxyMatch = slice.match(/href="(https:\/\/t\.me\/proxy\?[^"]+)"/);

    if (!proxyMatch) {
      continue;
    }

    items.push({
      id: `proxy-${sourceMessageId}`,
      proxyNumber: Number(sourceMessageId),
      proxyUrl: proxyMatch[1].replace(/&amp;/g, "&"),
      postedAt,
      sourceMessageId: sourceMessageId || messageUrl
    });
  }

  return items.sort((left, right) => right.proxyNumber - left.proxyNumber);
}
