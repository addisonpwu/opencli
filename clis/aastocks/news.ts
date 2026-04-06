/**
 * AASTOCKS 財經新聞 — 利好新聞 / 推薦新聞
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'aastocks',
  name: 'news',
  description: 'AASTOCKS 財經新聞 — 利好新聞 (positive) 或推薦新聞 (recommend)',
  domain: 'www.aastocks.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  timeoutSeconds: 180,
  args: [
    {
      name: 'type',
      type: 'str',
      default: 'positive',
      required: false,
      help: 'News type: positive (利好新聞) or recommend (推薦新聞)',
      choices: ['positive', 'recommend'],
    },
    {
      name: 'limit',
      type: 'int',
      default: 20,
      required: false,
      help: 'Number of news items (max 50)',
    },
    {
      name: 'output',
      type: 'str',
      default: '.',
      required: false,
      help: 'Output directory for aastocks_news.json',
    },
  ],
  columns: ['rank', 'title', 'source', 'time', 'content', 'url'],
  func: async (_page, kwargs) => {
    const newsType = kwargs.type || 'positive';
    const limit = Math.min(kwargs.limit || 20, 50);
    const outputDir = (kwargs.output as string) || '.';
    const typePath = newsType === 'recommend' ? 'recommend-news' : 'positive-news';
    const url = `http://www.aastocks.com/tc/stocks/news/aafn/${typePath}/`;

    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });

    if (!resp.ok) {
      return [];
    }

    const html = await resp.text();
    const items: { rank: number; title: string; source: string; time: string; url: string }[] = [];

    let match;
    let rank = 0;
    const contentAreaMatch = html.match(/<div[^>]*id="[^"]*content[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*id="[^"]*(?:footer|sidebar))/i);
    const contentHtml = contentAreaMatch ? contentAreaMatch[1] : html;
    const seenUrls = new Set<string>();
    const newsLinkRegex = /<a[^>]*href="([^"]+)"[^>]*>\s*([^<]+?)\s*<\/a>/gi;

    while ((match = newsLinkRegex.exec(contentHtml)) !== null && items.length < limit) {
      const href = match[1];
      const title = match[2].trim();

      if (!href || !title || title.length < 5) continue;
      if (seenUrls.has(href)) continue;
      if (!href.includes('/news/') && !href.includes('/aafn/')) continue;
      if (href.includes('javascript:') || href.includes('#')) continue;

      seenUrls.add(href);

      const contextBefore = contentHtml.substring(Math.max(0, match.index -200), match.index);
      const timeMatch = contextBefore.match(/(\d{4}-\d{2}-\d{2}|\d{1,2}:\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}|\d+分鐘前|\d+小時前|\d+天前)/);
      const sourceMatch = contextBefore.match(/(?:鉅亨|格隆匯|滙港|智通|AASTOCKS|有連|infocast)/);

      const fullUrl = href.startsWith('http') ? href : `http://www.aastocks.com${href}`;

      rank++;
      items.push({
        rank,
        title,
        source: sourceMatch ? sourceMatch[0] : '-',
        time: timeMatch ? timeMatch[1] : '-',
        url: fullUrl,
      });
    }

    if (items.length === 0) {
      const pRegex = /<(?:li|p|div)[^>]*>([\s\S]*?)<\/(?:li|p|div)>/gi;
      while ((match = pRegex.exec(contentHtml)) !== null && items.length < limit) {
        const content = match[1];
        const linkMatch = content.match(/<a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/);
        if (linkMatch && linkMatch[2].trim().length > 5) {
          const href = linkMatch[1];
          const title = linkMatch[2].trim();
          if (!seenUrls.has(href)) {
            seenUrls.add(href);
            rank++;
            items.push({
              rank,
              title,
              source: '-',
              time: '-',
              url: href.startsWith('http') ? href : `http://www.aastocks.com${href}`,
            });
          }
        }
      }
    }

    const extractContent = (articleHtml: string): string => {
      const selectors = [
        /<div[^>]*class="[^"]*news_content[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
        /<div[^>]*class="[^"]*article-body[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
        /<div[^>]*id="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
        /<article[^>]*>([\s\S]*?)<\/article>/i,
        /<div[^>]*class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
      ];

      for (const sel of selectors) {
        const m = articleHtml.match(sel);
        if (m && m[1]) {
          const text = m[1]
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/\s+/g, ' ')
            .trim();
          if (text.length > 20) {
            return text.length > 500 ? text.slice(0, 500) + '...' : text;
          }
        }
      }

      const paragraphs = articleHtml.match(/<p[^>]*>([\s\S]*?)<\/p>/gi);
      if (paragraphs) {
        const text = paragraphs
          .map(p => p.replace(/<[^>]+>/g, '').trim())
          .filter(t => t.length > 10)
          .join(' ');
        if (text.length > 20) {
          return text.length > 500 ? text.slice(0, 500) + '...' : text;
        }
      }

      return '-';
    };

    const results: { rank: number; title: string; source: string; time: string; content: string; url: string }[] = [];
    const batchSize = 3;

    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(async (item) => {
          try {
            const articleResp = await fetch(item.url, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
              },
              signal: AbortSignal.timeout(10000),
            });
            if (articleResp.ok) {
              const articleHtml = await articleResp.text();
              return { ...item, content: extractContent(articleHtml) };
            }
          } catch {
            // ignore fetch errors
          }
          return { ...item, content: '-' };
        })
      );
      results.push(...batchResults);

      if (i + batchSize < items.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    if (results.length > 0) {
      const outputPath = path.resolve(outputDir, 'aastocks_news.json');
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, JSON.stringify(results, null, 2) + '\n');
    }

    return results;
  },
});