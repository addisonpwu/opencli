import * as fs from 'node:fs';
import * as path from 'node:path';
import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'yahoo-finance',
  name: 'latest-news',
  description: 'Yahoo 香港財經最新新聞',
  domain: 'hk.finance.yahoo.com',
  strategy: Strategy.COOKIE,
  timeoutSeconds: 180,
  args: [
    { name: 'limit', type: 'int', default: 20, help: 'Number of news items' },
    { name: 'output', default: '.', help: 'Output directory for stock_news.json' },
  ],
  columns: ['rank', 'title', 'source', 'time', 'content', 'url'],
  func: async (page: any, kwargs: Record<string, any>) => {
    const limit = Number(kwargs.limit) || 20;
    const outputDir = (kwargs.output as string) || '.';

    await page.goto('https://hk.finance.yahoo.com/topic/latest-news/');
    await page.wait(3);

    const fetchLimit = Math.min(limit, 50);

    const results = await page.evaluate(`
      (async () => {
        const cleanText = (v) => (v || '').replace(/\\s+/g, ' ').trim();
        const results = [];

        const extractContent = (html) => {
          const parser = new DOMParser();
          const doc = parser.parseFromString(html, 'text/html');
          const selectors = [
            '[class*="body-wrap"] p',
            '[data-testid="articleBody"] p',
            '.caas-body p',
            'article p',
            '[class*="article-body"] p',
          ];
          for (const sel of selectors) {
            const ps = doc.querySelectorAll(sel);
            if (ps.length > 0) {
              const text = Array.from(ps).map(p => cleanText(p.textContent)).filter(t => t.length > 10).join(' ');
              if (text.length > 20) return text.length > 300 ? text.slice(0, 300) + '...' : text;
            }
          }
          return '-';
        };

        const listItems = document.querySelectorAll('li[class*="stream-item"], [data-testid="storyitem"], div[class*="Ov(h)"] li');
        if (listItems.length > 0) {
          listItems.forEach(el => {
            const link = el.querySelector('a[href*="/news/"]');
            if (!link) return;
            const title = cleanText(link.textContent);
            if (!title || title.length < 5) return;
            const url = link.href || '';
            const meta = cleanText(el.textContent.replace(title, ''));
            const parts = meta.split('\\u2022').map(s => s.trim());
            results.push({ title, source: parts[0] || '', time: parts[1] || '', url });
          });
        }

        if (results.length === 0) {
          document.querySelectorAll('a').forEach(a => {
            const href = a.href || '';
            if (!href.includes('/news/') && !href.includes('/video/')) return;
            const title = cleanText(a.textContent);
            if (!title || title.length < 10) return;
            const parent = a.closest('li, article, div');
            const fullText = parent ? cleanText(parent.textContent) : '';
            const meta = fullText.replace(title, '').trim();
            const parts = meta.split('\\u2022').map(s => s.trim()).filter(Boolean);
            results.push({ title, source: parts[0] || '', time: parts[1] || '', url: href });
          });
        }

        const seen = new Set();
        const unique = results.filter(item => {
          if (!item.url || seen.has(item.url)) return false;
          seen.add(item.url);
          return true;
        }).slice(0, ${fetchLimit});

        const final = [];
        const batchSize = 3;
        for (let i = 0; i < unique.length; i += batchSize) {
          const batch = unique.slice(i, i + batchSize);
          const batchResults = await Promise.all(
            batch.map(item =>
              fetch(item.url, { credentials: 'include', signal: AbortSignal.timeout(10000) })
                .then(r => r.text())
                .then(html => ({ ...item, content: extractContent(html) }))
                .catch(() => ({ ...item, content: '-' }))
            )
          );
          final.push(...batchResults);
          if (i + batchSize < unique.length) await new Promise(r => setTimeout(r, 500));
        }

        return final.map((item, i) => ({ rank: i + 1, ...item }));
      })()
    `);

    // Save results to stock_news.json
    if (Array.isArray(results) && results.length > 0) {
      const outputPath = path.resolve(outputDir, 'stock_news.json');
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, JSON.stringify(results, null, 2) + '\n');
    }

    return results;
  },
});
