import { cli, Strategy } from '../../registry.js';

cli({
  site: 'yahoo-finance',
  name: 'latest-news',
  description: 'Yahoo 香港財經最新新聞',
  domain: 'hk.finance.yahoo.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'limit', type: 'int', default: 20, help: 'Number of news items' },
  ],
  columns: ['rank', 'title', 'source', 'time', 'content', 'url'],
  func: async (page, kwargs) => {
    const limit = Number(kwargs.limit) || 20;

    await page.goto('https://hk.finance.yahoo.com/topic/latest-news/');
    await page.wait(3);

    type RawItem = { title: string; source: string; time: string; url: string };
    const rawItems: RawItem[] = await page.evaluate(`
      (() => {
        const cleanText = (v) => (v || '').replace(/\\s+/g, ' ').trim();
        const results = [];

        // Strategy 1: Structured list items
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

        // Strategy 2: Section-based
        if (results.length === 0) {
          const section = Array.from(document.querySelectorAll('h2, h3, div')).find(el => el.textContent.includes('最新新聞'));
          if (section) {
            let container = section.closest('section') || section.parentElement?.parentElement;
            if (container) {
              container.querySelectorAll('a').forEach(a => {
                const title = cleanText(a.textContent);
                if (!title || title.length < 8) return;
                const url = a.href || '';
                if (!url.includes('yahoo.com')) return;
                const parent = a.closest('li') || a.closest('div');
                const fullText = parent ? cleanText(parent.textContent) : '';
                const meta = fullText.replace(title, '').trim();
                const parts = meta.split('\\u2022').map(s => s.trim()).filter(Boolean);
                results.push({ title, source: parts[0] || '', time: parts[1] || '', url });
              });
            }
          }
        }

        // Strategy 3: Generic news links
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
        return results.filter(item => {
          if (!item.url || seen.has(item.url)) return false;
          seen.add(item.url);
          return true;
        });
      })()
    `);

    if (!Array.isArray(rawItems) || rawItems.length === 0) return [];

    const results: { title: string; source: string; time: string; content: string; url: string }[] = [];
    const fetchLimit = Math.min(rawItems.length, limit);

    for (let i = 0; i < fetchLimit; i++) {
      const item = rawItems[i];
      let content = '';

      try {
        await page.goto(item.url);
        await page.wait(2);

        const articleText: string | null = await page.evaluate(`
          (() => {
            const clean = (v) => (v || '').replace(/\\s+/g, ' ').trim();
            // Yahoo Finance article body selectors
            const body = document.querySelector('[class*="body-wrap"]') ||
                         document.querySelector('[data-testid="articleBody"]') ||
                         document.querySelector('.caas-body') ||
                         document.querySelector('article') ||
                         document.querySelector('[class*="article-body"]');
            if (body) {
              const paragraphs = body.querySelectorAll('p');
              if (paragraphs.length > 0) {
                return Array.from(paragraphs).map(p => clean(p.textContent)).filter(t => t.length > 10).join(' ');
              }
              return clean(body.textContent);
            }
            // Fallback: collect all p tags
            const ps = document.querySelectorAll('article p, main p, [role="main"] p');
            if (ps.length > 0) {
              return Array.from(ps).map(p => clean(p.textContent)).filter(t => t.length > 10).join(' ');
            }
            return null;
          })()
        `);

        if (articleText) {
          content = articleText.length > 300 ? articleText.slice(0, 300) + '...' : articleText;
        }
      } catch {
        content = '';
      }

      results.push({
        title: item.title,
        source: item.source,
        time: item.time,
        content: content || '-',
        url: item.url,
      });
    }

    return results.map((item, i) => ({
      rank: i + 1,
      ...item,
    }));
  },
});
