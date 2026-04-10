import * as fs from "node:fs";
import * as path from "node:path";
import { cli, Strategy } from "@jackwener/opencli/registry";
cli({
  site: "eastmoney-hk",
  name: "news",
  description: "\u4E1C\u65B9\u8D22\u5BCC\u6E2F\u80A1\u5E02\u573A\u5FEB\u8BAF",
  domain: "hk.eastmoney.com",
  strategy: Strategy.PUBLIC,
  browser: true,
  timeoutSeconds: 300,
  args: [
    {
      name: "limit",
      type: "int",
      default: 20,
      required: false,
      help: "Number of news items (max 50)"
    },
    {
      name: "output",
      type: "str",
      default: ".",
      required: false,
      help: "Output directory for eastmoney_hk_news.json"
    }
  ],
  columns: ["rank", "title", "source", "time", "content", "url"],
  func: async (page, kwargs) => {
    const limit = Math.min(kwargs.limit || 20, 50);
    const outputDir = kwargs.output || ".";
    await page.goto("https://hk.eastmoney.com/a/csckx.html");
    await page.wait(2);
    const items = await page.evaluate(`
      (() => {
        const cleanText = (v) => (v || '').replace(/\\s+/g, ' ').trim();
        const results = [];

        const listItems = document.querySelectorAll('#newsListContent li');
        listItems.forEach(el => {
          const link = el.querySelector('a[href]');
          if (!link) return;
          const title = cleanText(link.textContent);
          if (!title || title.length < 3) return;
          const url = link.href || '';
          const href = link.getAttribute('href') || '';
          if (!href.includes('/a/') && !url.includes('/a/')) return;
          results.push({ title, source: '\u6771\u65B9\u8CA1\u5BCC', time: '-', url });
        });

        if (results.length === 0) {
          document.querySelectorAll('.repeatList a[href]').forEach(a => {
            const href = a.getAttribute('href') || '';
            if (!href.includes('/a/')) return;
            const title = cleanText(a.textContent);
            if (!title || title.length < 5) return;
            results.push({ title, source: '\u6771\u65B9\u8CA1\u5BCC', time: '-', url: a.href });
          });
        }

        const seen = new Set();
        return results.filter(item => {
          if (!item.url || seen.has(item.url)) return false;
          seen.add(item.url);
          return true;
        });
      })()
    `);
    const limitedItems = items.slice(0, limit);
    const results = [];
    for (let i = 0; i < limitedItems.length; i++) {
      const item = limitedItems[i];
      let content = "-";
      try {
        await page.goto(item.url);
        await page.wait(1);
        content = await page.evaluate(`
          (() => {
            const selectors = ['#ContentBody p', '.txtinfos p', '.Body p', 'article p', '.newsContent p'];
            for (const sel of selectors) {
              const ps = document.querySelectorAll(sel);
              if (ps.length > 0) {
                const text = Array.from(ps).map(p => p.textContent.replace(/\\s+/g, ' ').trim()).filter(t => t.length > 5).join(' ');
                if (text.length > 20) return text.length > 500 ? text.slice(0, 500) + '...' : text;
              }
            }
            return '-';
          })()
        `);
      } catch {
        content = "-";
      }
      results.push({
        rank: i + 1,
        title: item.title,
        source: item.source,
        time: item.time,
        content,
        url: item.url
      });
    }
    if (results.length > 0) {
      const outputPath = path.resolve(outputDir, "eastmoney_hk_news.json");
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, JSON.stringify(results, null, 2) + "\n");
    }
    return results;
  }
});
