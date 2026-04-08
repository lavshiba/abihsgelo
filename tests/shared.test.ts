import { describe, expect, it } from "vitest";
import { buildProxyTitle, normalizePassword, parseTelegramProxies } from "../shared/src/index";

describe("shared helpers", () => {
  it("normalizes password case and trim", () => {
    expect(normalizePassword("  teSt  ")).toBe("TEST");
  });

  it("builds proxy title", () => {
    expect(buildProxyTitle(1)).toBe("последний свежий прокси");
    expect(buildProxyTitle(3)).toBe("последние 3 свежих прокси");
  });

  it("parses proxy source", () => {
    const html = `
      <div data-post="ProxyMTProto/123">
        <time datetime="2026-04-08T12:00:00+00:00"></time>
        <a class="tgme_widget_message_date" href="https://t.me/ProxyMTProto/123"></a>
        <a href="https://t.me/proxy?server=1.1.1.1&amp;port=443&amp;secret=abc"></a>
      </div>
    `;
    expect(parseTelegramProxies(html)[0]?.proxyNumber).toBe(123);
  });
});
