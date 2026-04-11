import * as fs from "node:fs";
import * as path from "node:path";
import { cli, Strategy } from "@jackwener/opencli/registry";
cli({
  site: "sinafinance",
  name: "hk-news",
  description: "\u65B0\u6D6A\u8D22\u7ECF\u6E2F\u80A1\u4E2D\u5FC3 - \u5927\u884C\u7814\u62A5\u548C\u516C\u53F8\u65B0\u95FB",
  domain: "finance.sina.com.cn",
  strategy: Strategy.PUBLIC,
  browser: false,
  timeoutSeconds: 60,
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
  func: async (_page, kwargs) => {
    const newsType = kwargs.type || "all";
    const limit = Math.min(kwargs.limit || 20, 50);
    const outputDir = kwargs.output || ".";
    const resp = await fetch("https://finance.sina.com.cn/stock/hkstock/", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9"
      }
    });
    if (!resp.ok) return [];
    const html = await resp.text();
    const results = [];
    if (newsType === "all" || newsType === "research") {
      const dxybMatch = html.match(/<div class="dxyb"[^>]*>([\s\S]*?)<div class="[^"]*" data-sudaclick="comnews_p">/i);
      if (dxybMatch) {
        const dxybHtml = dxybMatch[1];
        const itemRegex = /<li class="ywzx-item"[^>]*>\s*<a href="([^"]+)"[^>]*>([^<]+)<\/a>/gi;
        let itemMatch;
        while ((itemMatch = itemRegex.exec(dxybHtml)) !== null) {
          const url = itemMatch[1];
          const title = itemMatch[2].trim();
          if (!title || title.length < 8 || title.includes("@@=") || title.includes("$")) continue;
          if (!url || url.includes("@@=")) continue;
          results.push({ type: "\u5927\u884C\u7814\u62A5", title, time: "-", url });
        }
      }
    }
    if (newsType === "all" || newsType === "company") {
      const gsxwIdx = html.indexOf('data-sudaclick="comnews_p"');
      if (gsxwIdx > 0) {
        const gsxwSection = html.substring(gsxwIdx, gsxwIdx + 5e3);
        const itemRegex = /<span class="fr cdate">([^<]+)<\/span>\s*<a href="([^"]+)"[^>]*>([^<]+)<\/a>/gi;
        let itemMatch;
        while ((itemMatch = itemRegex.exec(gsxwSection)) !== null) {
          const time = itemMatch[1].trim();
          const url = itemMatch[2];
          const title = itemMatch[3].trim();
          if (!title || title.length < 8) continue;
          results.push({ type: "\u516C\u53F8\u65B0\u95FB", title, time, url });
        }
      }
    }
    let filtered = results;
    if (newsType === "research") filtered = results.filter((i) => i.type === "\u5927\u884C\u7814\u62A5");
    else if (newsType === "company") filtered = results.filter((i) => i.type === "\u516C\u53F8\u65B0\u95FB");
    const limited = filtered.slice(0, limit * (newsType === "all" ? 2 : 1));
    const finalResults = limited.map((item, idx) => ({ rank: idx + 1, content: "-", ...item }));
    if (finalResults.length > 0) {
      const outputPath = path.resolve(outputDir, "sinafinance_hk_news.json");
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, JSON.stringify(finalResults, null, 2) + "\n");
    }
    return finalResults;
  }
});
