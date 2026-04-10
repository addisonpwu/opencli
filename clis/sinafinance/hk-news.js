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
  timeoutSeconds: 180,
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
    const extractNews = (type) => `
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

        ${type === "all" || type === "research" ? `
        // \u5927\u884C\u7814\u62A5 section
        extractFromSection('\u5927\u884C\u7814\u62A5', '\u5927\u884C\u7814\u62A5');
        ` : ""}

        ${type === "all" || type === "company" ? `
        // \u516C\u53F8\u65B0\u95FB section
        extractFromSection('\u516C\u53F8\u65B0\u95FB', '\u516C\u53F8\u65B0\u95FB');
        ` : ""}

        // Fallback: try direct text matching on all .tit elements
        if (results.length === 0) {
          document.querySelectorAll('.tit, h3, .m-title').forEach(titleEl => {
            const titleText = cleanText(titleEl.textContent);
            
            ${type === "all" || type === "research" ? `
            if (titleText.includes('\u5927\u884C') || titleText.includes('\u7814\u62A5')) {
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
                      type: '\u5927\u884C\u7814\u62A5',
                      title,
                      time: timeMatch ? timeMatch[1] : '-',
                      url: fullUrl,
                    });
                  });
                }
              }
            }
            ` : ""}

            ${type === "all" || type === "company" ? `
            if (titleText.includes('\u516C\u53F8') && titleText.includes('\u65B0\u95FB')) {
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
                      type: '\u516C\u53F8\u65B0\u95FB',
                      title,
                      time: timeMatch ? timeMatch[1] : '-',
                      url: fullUrl,
                    });
                  });
                }
              }
            }
            ` : ""}
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
    const items = await page.evaluate(extractNews(newsType));
    const limitedItems = items.slice(0, limit * (newsType === "all" ? 2 : 1));
    const results = [];
    const batchSize = 3;
    for (let i = 0; i < limitedItems.length; i += batchSize) {
      const batch = limitedItems.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(async (item, idx) => {
          let content = "-";
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
            content = "-";
          }
          return {
            rank: i + idx + 1,
            type: item.type,
            title: item.title,
            time: item.time,
            content,
            url: item.url
          };
        })
      );
      results.push(...batchResults);
      if (i + batchSize < limitedItems.length) {
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
    }
    if (results.length > 0) {
      const outputPath = path.resolve(outputDir, "sinafinance_hk_news.json");
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, JSON.stringify(results, null, 2) + "\n");
    }
    return results;
  }
});
