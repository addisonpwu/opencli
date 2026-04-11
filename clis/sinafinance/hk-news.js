import * as fs from "node:fs";
import * as path from "node:path";
import { cli, Strategy } from "@jackwener/opencli/registry";
cli({
  site: "sinafinance",
  name: "hk-news",
  description: "\u65B0\u6D6A\u8D22\u7ECF\u6E2F\u80A1\u4E2D\u5FC3 - \u5927\u884C\u7814\u62A5\u548C\u516C\u53F8\u65B0\u95FB",
  domain: "finance.sina.com.cn",
  strategy: Strategy.PUBLIC,
  browser: true,
  timeoutSeconds: 300,
  args: [
    {
      name: "type",
      type: "str",
      default: "all",
      required: false,
      help: "News type: all (\u5168\u90E8), research (\u5927\u884C\u7814\u62A5), company (\u516C\u53F8\u65B0\u95FB)",
      choices: ["all", "research", "company"]
    },
    {
      name: "limit",
      type: "int",
      default: 20,
      required: false,
      help: "Number of news items per type (max 50)"
    },
    {
      name: "output",
      type: "str",
      default: ".",
      required: false,
      help: "Output directory for sinafinance_hk_news.json"
    }
  ],
  columns: ["rank", "type", "title", "time", "content", "url"],
  func: async (page, kwargs) => {
    const newsType = kwargs.type || "all";
    const limit = Math.min(kwargs.limit || 20, 50);
    const outputDir = kwargs.output || ".";
    await page.goto("https://finance.sina.com.cn/stock/hkstock/");
    await page.wait(3);
    const items = await page.evaluate(`
      (() => {
        const cleanText = (v) => (v || '').replace(/\\s+/g, ' ').trim();
        const results = [];
        const seenUrls = new Set();

        // Extract \u5927\u884C\u7814\u62A5 (Brokerage Research) - class="dxyb"
        const dxybEl = document.querySelector('.dxyb');
        if (dxybEl) {
          dxybEl.querySelectorAll('.ywzx-item a[href]').forEach(link => {
            const href = link.getAttribute('href') || link.href || '';
            const title = cleanText(link.textContent);
            if (!title || title.length < 8 || title.includes('@@=') || title.includes('$')) return;
            if (seenUrls.has(href)) return;
            seenUrls.add(href);
            const fullUrl = href.startsWith('http') ? href : 'https://finance.sina.com.cn' + href;
            results.push({ type: '\u5927\u884C\u7814\u62A5', title, time: '-', url: fullUrl });
          });
        }

        // Extract \u516C\u53F8\u65B0\u95FB (Company News) - find by data attribute
        const comnewsEl = document.querySelector('[data-sudaclick="comnews_p"]');
        if (comnewsEl) {
          comnewsEl.querySelectorAll('.ywzx-item').forEach(li => {
            const timeEl = li.querySelector('.cdate');
            const link = li.querySelector('a[href]');
            if (!link) return;
            const href = link.getAttribute('href') || link.href || '';
            const title = cleanText(link.textContent);
            if (!title || title.length < 8 || title.includes('@@=') || title.includes('$')) return;
            if (seenUrls.has(href)) return;
            seenUrls.add(href);
            const time = timeEl ? cleanText(timeEl.textContent) : '-';
            const fullUrl = href.startsWith('http') ? href : 'https://finance.sina.com.cn' + href;
            results.push({ type: '\u516C\u53F8\u65B0\u95FB', title, time, url: fullUrl });
          });
        }

        return results;
      })()
    `);
    if (!Array.isArray(items)) return [];
    let filtered = items;
    if (newsType === "research") filtered = items.filter((i) => i.type === "\u5927\u884C\u7814\u62A5");
    else if (newsType === "company") filtered = items.filter((i) => i.type === "\u516C\u53F8\u65B0\u95FB");
    const limited = filtered.slice(0, limit * (newsType === "all" ? 2 : 1));
    const results = [];
    for (let i = 0; i < limited.length; i++) {
      const item = limited[i];
      let content = "-";
      try {
        await page.goto(item.url);
        await page.wait(2);
        content = await page.evaluate(`
          (() => {
            const cleanText = (v) => (v || '').replace(/\\s+/g, ' ').trim();

            // Try #artibody first (standard Sina article body)
            const artibody = document.querySelector('#artibody');
            if (artibody) {
              const paragraphs = artibody.querySelectorAll('p');
              if (paragraphs.length > 0) {
                const text = Array.from(paragraphs)
                  .map(p => cleanText(p.textContent))
                  .filter(t => t.length > 20 && !t.includes('@@=') && !t.includes('$') && 
                           !t.includes('\u8D23\u4EFB\u7F16\u8F91') && !t.includes('.appendQr') && t.length > 20 &&
                           !t.includes('MACD') && !t.includes('\u6D77\u91CF\u8D44\u8BAF'))
                  .join(' ');
                if (text.length > 50) {
                  return text.length > 500 ? text.slice(0, 500) + '...' : text;
                }
              }
            }

            // Fallback: collect meaningful <p> tags from whole page
            const paragraphs = document.querySelectorAll('p');
            const parts = [];
            for (const p of paragraphs) {
              const text = cleanText(p.textContent);
              if (text.length > 30 && !text.includes('@@=') && !text.includes('$') &&
                  !text.includes('\u8D23\u4EFB\u7F16\u8F91') && !text.includes('Copyright') && 
                  !text.includes('sinafinance') && !text.includes('.appendQr') &&
                  !text.includes('MACD') && !text.includes('\u6D77\u91CF\u8D44\u8BAF') &&
                  !text.match(/^\\s*\\.[a-zA-Z]/)) {  // Skip CSS rules
                parts.push(text);
              }
            }
            if (parts.length > 0) {
              const text = parts.join(' ');
              return text.length > 500 ? text.slice(0, 500) + '...' : text;
            }

            return '-';
          })()
        `);
      } catch {
        content = "-";
      }
      results.push({
        rank: i + 1,
        type: item.type,
        title: item.title,
        time: item.time,
        content,
        url: item.url
      });
    }
    if (results.length > 0) {
      const outputPath = path.resolve(outputDir, "sinafinance_hk_news.json");
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, JSON.stringify(results, null, 2) + "\\n");
    }
    return results;
  }
});
