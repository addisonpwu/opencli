/**
 * 通达信 - 投行评级
 * 抓取 https://fk.tdx.com.cn/ 中的投行评级数据
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'tdx',
  name: 'broker-rating',
  description: '通达信投行评级 - 按评级/股票筛选',
  domain: 'fk.tdx.com.cn',
  strategy: Strategy.PUBLIC,
  browser: true,
  timeoutSeconds: 300,
  args: [
    {
      name: 'rating',
      type: 'str',
      default: '强烈推荐',
      required: false,
      help: '评级类型: 强烈推荐, 推荐, 中性, 减持',
      choices: ['强烈推荐', '推荐', '中性', '减持'],
    },
    {
      name: 'sort',
      type: 'str',
      default: '按评级',
      required: false,
      help: '排序方式: 按评级, 按股票',
      choices: ['按评级', '按股票'],
    },
    {
      name: 'limit',
      type: 'int',
      default: 50,
      required: false,
      help: 'Number of items (max 100)',
    },
    {
      name: 'output',
      type: 'str',
      default: '.',
      required: false,
      help: 'Output directory for tdx_broker_rating.json',
    },
    {
      name: 'apiUrl',
      type: 'str',
      default: '',
      required: false,
      help: 'API endpoint to import broker ratings (e.g., http://localhost:8000/api/v1/broker-ratings/import)',
    },
  ],
  columns: ['rank', 'date', 'code', 'name', 'rating', 'lastRating', 'broker', 'reason'],
  func: async (page, kwargs) => {
    const rating = kwargs.rating || '强烈推荐';
    const sort = kwargs.sort || '按评级';
    const limit = Math.min(kwargs.limit || 50, 100);
    const outputDir = (kwargs.output as string) || '.';
    const apiUrl = (kwargs.apiUrl as string) || process.env.BROKER_RATING_API_URL || '';

    // Navigate to the page
    await page.goto('https://fk.tdx.com.cn/site/tdxsj/html/tdxsj_ggsj_ggsj.html?from=www&webfrom=1&pc=0');
    await page.wait(3);

    // Click 投行评级 tab
    await page.evaluate(`
      (() => {
        const li = document.querySelector('li[svalue="thpj"][boxid="thpj"]');
        if (li) li.click();
      })()
    `);
    await page.wait(1);

    // Click 按评级 or 按股票
    const sortValue = sort === '按评级' ? '2' : '1';
    await page.evaluate(`
      ((sortValue) => {
        const li = document.querySelector('li[svalue="' + sortValue + '"]');
        if (li) li.click();
      })('${sortValue}')
    `);
    await page.wait(1);

    // Select rating dropdown - TDX uses custom combo component
    await page.evaluate(`
      ((rating) => {
        // Find the rating combo component
        const combos = document.querySelectorAll('tdx-combo, .combo-text');
        for (const combo of combos) {
          const input = combo.querySelector('input[type="text"], .combo-text');
          if (input) {
            // Click to open dropdown
            input.click();
            input.focus();
            break;
          }
        }
        
        // Try alternative: find by value attribute
        setTimeout(() => {
          const comboValue = document.querySelector('input.combo-value');
          if (comboValue) {
            // Find the arrow and click it
            const arrow = comboValue.parentElement?.querySelector('.combo-arrow');
            if (arrow) arrow.click();
          }
        }, 200);
        
        // Select the rating option
        setTimeout(() => {
          const options = document.querySelectorAll('.combo-list .combo-item, .combo-option, [class*="item"]');
          for (const opt of options) {
            if (opt.textContent.trim() === rating) {
              opt.click();
              break;
            }
          }
        }, 500);
      })('${rating}')
    `);
    await page.wait(2);

    // Extract data from #thpj
    const items = await page.evaluate(`
      (() => {
        const cleanText = (v) => (v || '').replace(/\\s+/g, ' ').trim();
        const results = [];
        const container = document.querySelector('#thpj');
        if (!container) return results;

        // Table structure: 序号 | 证券代码 | 证券简称 | 评级日期 | 最新评级 | 上次评级 | 评级机构 | 评级原因
        const table = container.querySelector('table');
        if (table) {
          const rows = table.querySelectorAll('tbody tr');
          rows.forEach(tr => {
            const cells = tr.querySelectorAll('td');
            if (cells.length < 6) return;

            const getText = (idx) => {
              const cell = cells[idx];
              if (!cell) return '';
              const div = cell.querySelector('.fixtd');
              return div ? cleanText(div.textContent) : cleanText(cell.textContent);
            };

            results.push({
              date: getText(3),           // 评级日期
              code: getText(1),           // 证券代码
              name: getText(2),           // 证券简称
              rating: getText(4),         // 最新评级
              lastRating: getText(5),     // 上次评级
              broker: getText(6),         // 评级机构
              reason: getText(7),         // 评级原因
            });
          });
        }

        // Fallback: try grid/list structure
        if (results.length === 0) {
          const rows = container.querySelectorAll('.data-row, .grid-row, .list-item, tbody tr, tr');
          rows.forEach((row, idx) => {
            const text = cleanText(row.textContent);
            if (!text || text.length < 10) return;
            results.push({
              date: '',
              code: '',
              name: '',
              rating: '',
              broker: '',
              targetPrice: '',
              url: '',
              rawText: text,
            });
          });
        }

        return results;
      })()
    `);

    if (!Array.isArray(items)) return [];

    // Limit results
    const limited = items.slice(0, limit);

    // Add rank
    const results = limited.map((item: any, idx: number) => ({
      rank: idx + 1,
      ...item,
    }));

    // Save to file
    if (results.length > 0) {
      const outputPath = path.resolve(outputDir, 'tdx_broker_rating.json');
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, JSON.stringify(results, null, 2) + '\n');
    }

    // Import to API if URL is provided
    if (apiUrl && results.length > 0) {
      console.error(`Importing ${results.length} ratings to ${apiUrl}...`);

      // Transform data for API
      const importData = results.map(item => {
        let code = item.code || '';
        // Convert to XXXX.HK format
        // e.g., '01873' -> '1873.HK', '00552' -> '0552.HK', '09988' -> '9988.HK'
        // Remove leading zeros, then pad to 4 digits
        code = code.replace(/^0+/, '') || '0';
        code = code.padStart(4, '0');
        if (!code.includes('.')) {
          code = `${code}.HK`;
        }

        return {
          rank: item.rank,
          broker: item.broker,
          code,
          date: item.date,
          lastRating: item.lastRating,
          name: item.name,
          rating: item.rating,
          reason: item.reason || '',
        };
      });

      const resp = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(importData),
        signal: AbortSignal.timeout(30000),
      });

      if (!resp.ok) {
        const errorText = await resp.text();
        console.error(`⚠  Import failed: ${resp.status} ${errorText}`);
        console.error('💡 Check API validation rules or ensure server is running correctly.');
        // Don't throw - allow JSON file to still be saved
      } else {
        const importResult = await resp.json();
        console.error(`✅ Import success: ${JSON.stringify(importResult)}`);
      }
    }

    return results;
  },
});
