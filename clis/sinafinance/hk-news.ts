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
  timeoutSeconds: 180,
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

    await page.goto('https://finance.sina.com.cn/stock/hkstock/');
    await page.wait(3);

    // Extract both sections from the page
    const extractNews = (type: string) => `
      (() => {
        const cleanText = (v) => (v || '').replace(/\\s+/g, ' ').trim();
        const results = [];

        // Helper function to extract news from a section
        const extractFromSection = (sectionTitle, newsType) => {
          // Find all .m-tab containers
          const tabs = document.querySelectorAll('.m-tab');
          for (const tab of tabs) {
            const titleEl = tab.querySelector('.tit, h3, .m-title');
            if (!titleEl) continue;
            const titleText = cleanText(titleEl.textContent);
            if (!titleText.includes(sectionTitle)) continue;

            // Found the section, extract news items
            const listContainer = tab.querySelector('.list-01, .news-ul, ul');
            if (!listContainer) continue;

            const items = listContainer.querySelectorAll('li');
            items.forEach(li => {
              const link = li.querySelector('a[href]');
              if (!link) return;
              const title = cleanText(link.textContent);
              if (!title || title.length < 5) return;
              const href = link.getAttribute('href') || '';
              if (!href || href.includes('javascript:')) return;
              
              // Extract time if present (usually before the title)
              const fullText = cleanText(li.textContent);
              const timeMatch = fullText.match(/^(\\d{2}:\\d{2})\\s+/);
              const time = timeMatch ? timeMatch[1] : '-';
              
              const fullUrl = href.startsWith('http') ? href : 'https://finance.sina.com.cn' + href;
              results.push({
                type: newsType,
                title: title.replace(/^\\d{2}:\\d{2}\\s*/, ''), // Remove time prefix from title
                time,
                url: fullUrl,
              });
            });
            break; // Found and processed this section
          }
        };

        ${type === 'all' || type === 'research' ? `
        // 大行研报 section
        extractFromSection('大行研报', '大行研报');
        ` : ''}

        ${type === 'all' || type === 'company' ? `
        // 公司新闻 section
        extractFromSection('公司新闻', '公司新闻');
        ` : ''}

        // Fallback: try direct text matching on all .tit elements
        if (results.length === 0) {
          document.querySelectorAll('.tit, h3, .m-title').forEach(titleEl => {
            const titleText = cleanText(titleEl.textContent);
            
            ${type === 'all' || type === 'research' ? `
            if (titleText.includes('大行') || titleText.includes('研报')) {
              const parent = titleEl.closest('.m-tab, .blk-2');
              if (parent) {
                const list = parent.querySelector('.list-01, ul');
                if (list) {
                  list.querySelectorAll('li a[href]').forEach(link => {
                    const title = cleanText(link.textContent).replace(/^\\d{2}:\\d{2}\\s*/, '');
                    if (title.length < 5) return;
                    const href = link.getAttribute('href') || '';
                    if (!href || href.includes('javascript:')) return;
                    const fullText = cleanText(link.closest('li')?.textContent || '');
                    const timeMatch = fullText.match(/^(\\d{2}:\\d{2})\\s+/);
                    const fullUrl = href.startsWith('http') ? href : 'https://finance.sina.com.cn' + href;
                    results.push({
                      type: '大行研报',
                      title,
                      time: timeMatch ? timeMatch[1] : '-',
                      url: fullUrl,
                    });
                  });
                }
              }
            }
            ` : ''}

            ${type === 'all' || type === 'company' ? `
            if (titleText.includes('公司') && titleText.includes('新闻')) {
              const parent = titleEl.closest('.m-tab, .blk-2');
              if (parent) {
                const list = parent.querySelector('.list-01, ul');
                if (list) {
                  list.querySelectorAll('li a[href]').forEach(link => {
                    const title = cleanText(link.textContent).replace(/^\\d{2}:\\d{2}\\s*/, '');
                    if (title.length < 5) return;
                    const href = link.getAttribute('href') || '';
                    if (!href || href.includes('javascript:')) return;
                    const fullText = cleanText(link.closest('li')?.textContent || '');
                    const timeMatch = fullText.match(/^(\\d{2}:\\d{2})\\s+/);
                    const fullUrl = href.startsWith('http') ? href : 'https://finance.sina.com.cn' + href;
                    results.push({
                      type: '公司新闻',
                      title,
                      time: timeMatch ? timeMatch[1] : '-',
                      url: fullUrl,
                    });
                  });
                }
              }
            }
            ` : ''}
          });
        }

        // Deduplicate by URL
        const seen = new Set();
        return results.filter(item => {
          if (!item.url || seen.has(item.url)) return false;
          seen.add(item.url);
          return true;
        });
      })()
    `;

    const items: any[] = await page.evaluate(extractNews(newsType));

    // Limit results
    const limitedItems = items.slice(0, limit * (newsType === 'all' ? 2 : 1));

    // Fetch content for each article
    const results: any[] = [];
    const batchSize = 3;

    for (let i = 0; i < limitedItems.length; i += batchSize) {
      const batch = limitedItems.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(async (item, idx) => {
          let content = '-';
          try {
            await page.goto(item.url);
            await page.wait(1);

            content = await page.evaluate(`
              (() => {
                const cleanText = (v) => (v || '').replace(/\\s+/g, ' ').trim();
                
                // Try multiple selectors for article content
                const selectors = [
                  '#artibody',
                  '.article-body',
                  '.newsContent',
                  '.art_content',
                  'article',
                  '.main-content',
                  '.content',
                  '#ContentBody',
                ];
                
                for (const sel of selectors) {
                  const el = document.querySelector(sel);
                  if (el) {
                    const text = cleanText(el.textContent);
                    if (text.length > 20) {
                      return text.length > 500 ? text.slice(0, 500) + '...' : text;
                    }
                  }
                }
                
                // Fallback: get all paragraphs
                const paragraphs = document.querySelectorAll('p');
                if (paragraphs.length > 0) {
                  const text = Array.from(paragraphs)
                    .map(p => cleanText(p.textContent))
                    .filter(t => t.length > 10)
                    .join(' ');
                  if (text.length > 20) {
                    return text.length > 500 ? text.slice(0, 500) + '...' : text;
                  }
                }
                
                return '-';
              })()
            `);
          } catch {
            content = '-';
          }

          return {
            rank: i + idx + 1,
            type: item.type,
            title: item.title,
            time: item.time,
            content,
            url: item.url,
          };
        })
      );

      results.push(...batchResults);

      // Rate limiting between batches
      if (i + batchSize < limitedItems.length) {
        await new Promise(resolve => setTimeout(resolve, 800));
      }
    }

    // Save results to JSON file
    if (results.length > 0) {
      const outputPath = path.resolve(outputDir, 'sinafinance_hk_news.json');
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, JSON.stringify(results, null, 2) + '\n');
    }

    return results;
  },
});
