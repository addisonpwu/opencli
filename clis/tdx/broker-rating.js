import * as fs from "node:fs";
import * as path from "node:path";
import { cli, Strategy } from "@jackwener/opencli/registry";
cli({
  site: "tdx",
  name: "broker-rating",
  description: "\u901A\u8FBE\u4FE1\u6295\u884C\u8BC4\u7EA7 - \u6309\u8BC4\u7EA7/\u80A1\u7968\u7B5B\u9009",
  domain: "fk.tdx.com.cn",
  strategy: Strategy.PUBLIC,
  browser: true,
  timeoutSeconds: 300,
  args: [
    {
      name: "rating",
      type: "str",
      default: "\u5F3A\u70C8\u63A8\u8350",
      required: false,
      help: "\u8BC4\u7EA7\u7C7B\u578B: \u5F3A\u70C8\u63A8\u8350, \u63A8\u8350, \u4E2D\u6027, \u51CF\u6301",
      choices: ["\u5F3A\u70C8\u63A8\u8350", "\u63A8\u8350", "\u4E2D\u6027", "\u51CF\u6301"]
    },
    {
      name: "sort",
      type: "str",
      default: "\u6309\u8BC4\u7EA7",
      required: false,
      help: "\u6392\u5E8F\u65B9\u5F0F: \u6309\u8BC4\u7EA7, \u6309\u80A1\u7968",
      choices: ["\u6309\u8BC4\u7EA7", "\u6309\u80A1\u7968"]
    },
    {
      name: "limit",
      type: "int",
      default: 50,
      required: false,
      help: "Number of items (max 100)"
    },
    {
      name: "output",
      type: "str",
      default: ".",
      required: false,
      help: "Output directory for tdx_broker_rating.json"
    },
    {
      name: "apiUrl",
      type: "str",
      default: "",
      required: false,
      help: "API endpoint to import broker ratings (e.g., http://localhost:8000/api/v1/broker-ratings/import)"
    }
  ],
  columns: ["rank", "date", "code", "name", "rating", "lastRating", "broker", "reason"],
  func: async (page, kwargs) => {
    const rating = kwargs.rating || "\u5F3A\u70C8\u63A8\u8350";
    const sort = kwargs.sort || "\u6309\u8BC4\u7EA7";
    const limit = Math.min(kwargs.limit || 50, 100);
    const outputDir = kwargs.output || ".";
    const apiUrl = kwargs.apiUrl || process.env.BROKER_RATING_API_URL || "";
    await page.goto("https://fk.tdx.com.cn/site/tdxsj/html/tdxsj_ggsj_ggsj.html?from=www&webfrom=1&pc=0");
    await page.wait(3);
    await page.evaluate(`
      (() => {
        const li = document.querySelector('li[svalue="thpj"][boxid="thpj"]');
        if (li) li.click();
      })()
    `);
    await page.wait(1);
    const sortValue = sort === "\u6309\u8BC4\u7EA7" ? "2" : "1";
    await page.evaluate(`
      ((sortValue) => {
        const li = document.querySelector('li[svalue="' + sortValue + '"]');
        if (li) li.click();
      })('${sortValue}')
    `);
    await page.wait(1);
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
    const items = await page.evaluate(`
      (() => {
        const cleanText = (v) => (v || '').replace(/\\s+/g, ' ').trim();
        const results = [];
        const container = document.querySelector('#thpj');
        if (!container) return results;

        // Table structure: \u5E8F\u53F7 | \u8BC1\u5238\u4EE3\u7801 | \u8BC1\u5238\u7B80\u79F0 | \u8BC4\u7EA7\u65E5\u671F | \u6700\u65B0\u8BC4\u7EA7 | \u4E0A\u6B21\u8BC4\u7EA7 | \u8BC4\u7EA7\u673A\u6784 | \u8BC4\u7EA7\u539F\u56E0
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
              date: getText(3),           // \u8BC4\u7EA7\u65E5\u671F
              code: getText(1),           // \u8BC1\u5238\u4EE3\u7801
              name: getText(2),           // \u8BC1\u5238\u7B80\u79F0
              rating: getText(4),         // \u6700\u65B0\u8BC4\u7EA7
              lastRating: getText(5),     // \u4E0A\u6B21\u8BC4\u7EA7
              broker: getText(6),         // \u8BC4\u7EA7\u673A\u6784
              reason: getText(7),         // \u8BC4\u7EA7\u539F\u56E0
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
    const limited = items.slice(0, limit);
    const results = limited.map((item, idx) => ({
      rank: idx + 1,
      ...item
    }));
    if (results.length > 0) {
      const outputPath = path.resolve(outputDir, "tdx_broker_rating.json");
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, JSON.stringify(results, null, 2) + "\n");
    }
    if (apiUrl && results.length > 0) {
      console.error(`Importing ${results.length} ratings to ${apiUrl}...`);
      const importData = results.map((item) => {
        let code = item.code || "";
        code = code.replace(/^0+/, "") || "0";
        code = code.padStart(4, "0");
        if (!code.includes(".")) {
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
          reason: item.reason || ""
        };
      });
      const resp = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(importData),
        signal: AbortSignal.timeout(3e4)
      });
      if (!resp.ok) {
        const errorText = await resp.text();
        console.error(`\u26A0  Import failed: ${resp.status} ${errorText}`);
        console.error("\u{1F4A1} Check API validation rules or ensure server is running correctly.");
      } else {
        const importResult = await resp.json();
        console.error(`\u2705 Import success: ${JSON.stringify(importResult)}`);
      }
    }
    return results;
  }
});
