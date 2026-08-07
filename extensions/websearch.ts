/**
 * pi-websearch
 *
 * A pi extension that gives the agent a `web_search` tool backed by a
 * self-hosted SearXNG instance. It turns SearXNG's JSON results into compact,
 * LLM-friendly markdown so the agent can gather up-to-date web context.
 *
 * Configuration:
 *   - SEARXNG_URL  env var (default: http://localhost:8181)
 *   - SEARXNG_MAX_RESULTS  env var (default: 5)
 */

import { Type } from "@sinclair/typebox";
import {
  type ExtensionAPI,
  truncateHead,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
} from "@mariozechner/pi-coding-agent";

const SEARXNG_URL = process.env.SEARXNG_URL ?? "http://localhost:8181";
const MAX_RESULTS = Math.max(1, Math.min(20, Number(process.env.SEARXNG_MAX_RESULTS ?? 5)));

interface SearXNGResult {
  url?: string;
  title?: string;
  content?: string;
  engine?: string;
  score?: number;
  category?: string;
  publishedDate?: string | null;
}

interface SearXNGResponse {
  query?: string;
  results?: SearXNGResult[];
  suggestions?: string[];
  unresponsive_engines?: Array<string | [string, string]>;
}

function stripHtml(input: string): string {
  return input
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function formatResults(query: string, data: SearXNGResponse): string {
  const results = data.results ?? [];
  const lines: string[] = [];

  lines.push(`# Web search: ${query}`);
  lines.push("");
  lines.push(`Found ${results.length} result(s).`);
  lines.push("");

  results.forEach((r, i) => {
    const title = stripHtml(r.title ?? "Untitled");
    const url = r.url ?? "";
    const content = stripHtml(r.content ?? "");

    lines.push(`${i + 1}. **${title}**`);
    if (url) lines.push(`   ${url}`);
    if (content) lines.push(`   ${content}`);
    if (r.engine || r.publishedDate) {
      const meta: string[] = [];
      if (r.engine) meta.push(`engine: ${r.engine}`);
      if (r.publishedDate) meta.push(`published: ${r.publishedDate}`);
      lines.push(`   _(${meta.join(" · ")})_`);
    }
    lines.push("");
  });

  const suggestions = data.suggestions ?? [];
  if (suggestions.length > 0) {
    lines.push(`**Suggestions:** ${suggestions.join(" · ")}`);
    lines.push("");
  }

  const unresponsive = (data.unresponsive_engines ?? [])
    .map((e) => (Array.isArray(e) ? e[0] : e))
    .filter(Boolean);
  if (unresponsive.length > 0) {
    lines.push(`*Note: ${unresponsive.length} engine(s) unavailable: ${unresponsive.join(", ")}*`);
  }

  return lines.join("\n");
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description:
      "Search the web for a query using a self-hosted SearXNG instance and return the top results with titles, URLs and snippets. Use this to fetch current, factual information from the web.",
    promptSnippet: "Search the web for current information",
    promptGuidelines: [
      "Use web_search when the user asks about recent events, current facts, or information that may not be in your training data.",
      "Use web_search to verify or find the canonical URL of a website or product.",
    ],
    parameters: Type.Object({
      query: Type.String({
        description: "The search query (keywords), like you would type into a search engine.",
      }),
      limit: Type.Optional(
        Type.Integer({
          minimum: 1,
          maximum: 20,
          description: "Maximum number of results to return (default: 5).",
        }),
      ),
    }),

    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      if (signal?.aborted) {
        return { content: [{ type: "text", text: "Search cancelled." }], details: {} };
      }

      const limit = Math.max(1, Math.min(20, params.limit ?? MAX_RESULTS));
      const url = new URL("/search", SEARXNG_URL);
      url.searchParams.set("q", params.query);
      url.searchParams.set("format", "json");
      url.searchParams.set("num_results", String(limit));

      let raw: string;
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000);
        const res = await fetch(url.toString(), { signal: controller.signal });
        clearTimeout(timeout);

        if (!res.ok) {
          throw new Error(`SearXNG returned HTTP ${res.status}`);
        }
        raw = await res.text();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text",
              text: `Web search failed: ${message}. Is SearXNG running at ${SEARXNG_URL}?`,
            },
          ],
          details: { error: message },
        };
      }

      let data: SearXNGResponse;
      try {
        data = JSON.parse(raw);
      } catch {
        return {
          content: [
            { type: "text", text: "Web search returned an invalid JSON response from SearXNG." },
          ],
          details: {},
        };
      }

      const markdown = formatResults(params.query, data);

      // Truncate to keep the LLM context small. The full response rarely needs
      // more space, but guard against overloaded engines returning huge dumps.
      const truncation = truncateHead(markdown, {
        maxLines: DEFAULT_MAX_LINES,
        maxBytes: DEFAULT_MAX_BYTES,
      });

      let text = truncation.content;
      if (truncation.truncated) {
        text += `\n\n[Output truncated: ${truncation.outputLines}/${truncation.totalLines} lines, `;
        text += `${formatSize(truncation.outputBytes)}/${formatSize(truncation.totalBytes)}]`;
      }

      return {
        content: [{ type: "text", text }],
        details: {
          query: params.query,
          resultCount: (data.results ?? []).length,
          results: (data.results ?? []).map((r) => ({
            url: r.url ?? "",
            title: stripHtml(r.title ?? ""),
          })),
        },
      };
    },
  });

  // registerTool alone is not enough: tools must be in the active set to be
  // callable by the model. Preserve existing active tools and add ours.
  pi.on("session_start", () => {
    const active = pi.getActiveTools();
    if (!active.includes("web_search")) {
      pi.setActiveTools([...new Set([...active, "web_search"])]);
    }
  });
}