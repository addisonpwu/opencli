/**
 * 新浪财经港股中心 - 大行研报 + 公司新闻
 * 抓取 https://finance.sina.com.cn/stock/hkstock/ 中的大行研报和公司新闻
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'sinafinance',
  name: 'hk-news',
  description: '新浪财经港股中心 - 大行研报和公司新闻',
  domain: 'finance.sina.com.cn',
  strategy: Strategy.PUBLIC,
  browser: true,
  timeoutSeconds: 300,
  args: [
    {
      name: 'type',
      type: 'str',
      default: 'all',
      required: false,
      help: 'News type: all (全部), research (大行研报), company (公司新闻)',
      choices: ['all', 'research', 'company'],
    },
    {
      name: 'limit',
      type: 'int',
      default: 20,
      required: false,
      help: 'Number of news items per type (max 50)',
    },
    {
      name: 'output',
      type: 'str',
      default: '.',
      required: false,
      help: 'Output directory for sinafinance_hk_news.json',
    },
  ],
  columns: ['rank', 'type', 'title', 'time', 'content', 'url'],
  func: async (page, kwargs) => {
    const newsType = kwargs.type || 'all';
    const limit = Math.min(kwargs.limit || 20, 50);
    const outputDir = (kwargs.output as string) || '.';

    // Fetch HK stock page
    await page.goto('https://finance.sina.com.cn/stock/hkstock/');
    await page.wait(3);

    // Extract news list
    const items = await page.evaluate(`
      (() => {
        const cleanText = (v) => (v || '').replace(/\\s+/g, ' ').trim();
        const results = [];
        const seenUrls = new Set();

        // Extract 大行研报 (Brokerage Research) - class="dxyb"
        const dxybEl = document.querySelector('.dxyb');
        if (dxybEl) {
          dxybEl.querySelectorAll('.ywzx-item a[href]').forEach(link => {
            const href = link.getAttribute('href') || link.href || '';
            const title = cleanText(link.textContent);
            if (!title || title.length < 8 || title.includes('@@=') || title.includes('$')) return;
            if (seenUrls.has(href)) return;
            seenUrls.add(href);
            const fullUrl = href.startsWith('http') ? href : 'https://finance.sina.com.cn' + href;
            results.push({ type: '大行研报', title, time: '-', url: fullUrl });
          });
        }

        // Extract 公司新闻 (Company News) - find by data attribute
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
            results.push({ type: '公司新闻', title, time, url: fullUrl });
          });
        }

        return results;
      })()
    `);

    if (!Array.isArray(items)) return [];

    // Filter by type
    let filtered = items;
    if (newsType === 'research') filtered = items.filter(i => i.type === '大行研报');
    else if (newsType === 'company') filtered = items.filter(i => i.type === '公司新闻');

    const limited = filtered.slice(0, limit * (newsType === 'all' ? 2 : 1));

    // Fetch content for each article using browser navigation (like eastmoney-hk)
    const results: any[] = [];

    for (let i = 0; i < limited.length; i++) {
      const item = limited[i];
      let content = '-';

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
                           !t.includes('责任编辑') && !t.includes('.appendQr') && t.length > 20 &&
                           !t.includes('MACD') && !t.includes('海量资讯'))
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
                  !text.includes('责任编辑') && !text.includes('Copyright') && 
                  !text.includes('sinafinance') && !text.includes('.appendQr') &&
                  !text.includes('MACD') && !text.includes('海量资讯') &&
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
        content = '-';
      }

      results.push({
        rank: i + 1,
        type: item.type,
        title: item.title,
        time: item.time,
        content,
        url: item.url,
      });
    }

    // Save results to JSON file
    if (results.length > 0) {
      const outputPath = path.resolve(outputDir, 'sinafinance_hk_news.json');
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, JSON.stringify(results, null, 2) + '\\n');
    }

    return results;
  },
});
