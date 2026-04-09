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

export interface ProxyCatalogEntry {
  sourceMessageId: string;
  proxyNumber: number;
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
  const items: ProxyItem[] = [];
  const markers = [...html.matchAll(/data-post="ProxyMTProto\/(\d+)"/g)];

  for (let index = 0; index < markers.length; index += 1) {
    const match = markers[index];
    const sourceMessageId = match[1];
    const blockStart = match.index ?? 0;
    const blockEnd = markers[index + 1]?.index ?? html.length;
    const block = html.slice(blockStart, blockEnd);
    const timeMatch = block.match(/<time datetime="([^"]+)"/);
    const proxyMatch = block.match(/href="((?:https:\/\/t\.me\/proxy\?|tg:\/\/proxy\?)[^"]+)"/);

    if (!timeMatch || !proxyMatch) {
      continue;
    }

    items.push({
      id: `proxy-${sourceMessageId}`,
      proxyNumber: Number(sourceMessageId),
      proxyUrl: proxyMatch[1].replace(/&amp;/g, "&"),
      postedAt: timeMatch[1],
      sourceMessageId
    });
  }

  return items.sort((left, right) => right.proxyNumber - left.proxyNumber);
}

export function assignStableProxyNumbers(items: ProxyItem[], catalog: ProxyCatalogEntry[]): {
  items: ProxyItem[];
  catalog: ProxyCatalogEntry[];
} {
  const numberBySource = new Map(catalog.map((entry) => [entry.sourceMessageId, entry.proxyNumber]));
  let nextNumber = Math.max(0, ...catalog.map((entry) => entry.proxyNumber)) + 1;

  const unseen = items
    .filter((item) => !numberBySource.has(item.sourceMessageId))
    .sort((left, right) => {
      const leftTime = Date.parse(left.postedAt);
      const rightTime = Date.parse(right.postedAt);
      if (!Number.isNaN(leftTime) && !Number.isNaN(rightTime) && leftTime !== rightTime) {
        return leftTime - rightTime;
      }
      return Number(left.sourceMessageId) - Number(right.sourceMessageId);
    });

  for (const item of unseen) {
    numberBySource.set(item.sourceMessageId, nextNumber);
    nextNumber += 1;
  }

  return {
    items: items.map((item) => ({
      ...item,
      proxyNumber: numberBySource.get(item.sourceMessageId) ?? item.proxyNumber
    })),
    catalog: [...numberBySource.entries()]
      .map(([sourceMessageId, proxyNumber]) => ({ sourceMessageId, proxyNumber }))
      .sort((left, right) => left.proxyNumber - right.proxyNumber)
  };
}
