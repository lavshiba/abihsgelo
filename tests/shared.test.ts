import { describe, expect, it } from "vitest";
import { assignStableProxyNumbers, buildProxyTitle, normalizePassword, parseTelegramProxies } from "../shared/src/index";

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
      <div class="tgme_widget_message_wrap js-widget_message_wrap">
        <div class="tgme_widget_message text_not_supported_wrap js-widget_message" data-post="ProxyMTProto/123">
          <div class="tgme_widget_message_footer compact js-message_footer">
            <div class="tgme_widget_message_info short js-message_info">
              <span class="tgme_widget_message_meta"><a class="tgme_widget_message_date" href="https://t.me/ProxyMTProto/123"><time datetime="2026-04-08T12:00:00+00:00"></time></a></span>
            </div>
          </div>
          <div class="tgme_widget_message_inline_keyboard">
            <div class="tgme_widget_message_inline_row">
              <a class="tgme_widget_message_inline_button url_button" href="https://t.me/proxy?server=1.1.1.1&amp;port=443&amp;secret=abc"></a>
            </div>
          </div>
        </div>
      </div>
    `;
    expect(parseTelegramProxies(html)[0]?.proxyNumber).toBe(123);
  });

  it("parses tg deep links from the current telegram markup", () => {
    const html = `
      <div class="tgme_widget_message_wrap js-widget_message_wrap">
        <div class="tgme_widget_message text_not_supported_wrap js-widget_message" data-post="ProxyMTProto/777">
          <div class="tgme_widget_message_footer compact js-message_footer">
            <div class="tgme_widget_message_info short js-message_info">
              <span class="tgme_widget_message_meta"><a class="tgme_widget_message_date" href="https://t.me/ProxyMTProto/777"><time datetime="2026-04-09T13:30:00+00:00"></time></a></span>
            </div>
          </div>
          <div class="tgme_widget_message_inline_keyboard">
            <div class="tgme_widget_message_inline_row">
              <a class="tgme_widget_message_inline_button url_button" href="tg://proxy?server=example.com&amp;port=443&amp;secret=xyz"></a>
            </div>
          </div>
        </div>
      </div>
    `;

    const parsed = parseTelegramProxies(html);
    expect(parsed[0]?.proxyNumber).toBe(777);
    expect(parsed[0]?.proxyUrl).toContain("tg://proxy?server=example.com");
  });

  it("assigns stable site proxy numbers that keep increasing for new proxies", () => {
    const items = [
      { id: "proxy-103", proxyNumber: 103, proxyUrl: "tg://proxy?server=3", postedAt: "2026-04-09T12:00:00+00:00", sourceMessageId: "103" },
      { id: "proxy-102", proxyNumber: 102, proxyUrl: "tg://proxy?server=2", postedAt: "2026-04-09T11:00:00+00:00", sourceMessageId: "102" },
      { id: "proxy-101", proxyNumber: 101, proxyUrl: "tg://proxy?server=1", postedAt: "2026-04-09T10:00:00+00:00", sourceMessageId: "101" }
    ];

    const first = assignStableProxyNumbers(items, []);
    expect(first.items.map((item) => item.proxyNumber)).toEqual([3, 2, 1]);

    const nextItems = [
      { id: "proxy-104", proxyNumber: 104, proxyUrl: "tg://proxy?server=4", postedAt: "2026-04-09T13:00:00+00:00", sourceMessageId: "104" },
      ...items
    ];
    const second = assignStableProxyNumbers(nextItems, first.catalog);
    expect(second.items.map((item) => item.proxyNumber)).toEqual([4, 3, 2, 1]);
  });
});
