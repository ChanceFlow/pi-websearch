# pi-websearch

A [pi](https://pi.dev) extension that gives the coding agent a **`web_search`** tool backed by a **self-hosted [SearXNG](https://docs.searxng.org/) instance**.

It queries SearXNG's JSON API and formats the results into compact, LLM-friendly markdown (titles, URLs, snippets), so the agent can fetch current, factual information from the web.

## Why SearXNG?

- **No API keys required** — SearXNG aggregates upstream engines (Google, Bing, DuckDuckGo, …) itself.
- **Self-hosted & private** — your queries don't leave your own infrastructure.
- **JSON API** — easy to integrate (`?format=json`).

## Requirements

- A running SearXNG instance (see [Deploying SearXNG](#deploying-searxng)).
- pi 0.x

## Install

From a git repo:

```bash
pi install git:github.com/yourname/pi-websearch
```

Or from a local path while developing:

```bash
pi install ./pi-websearch
```

Or try it without installing:

```bash
pi -e ./pi-websearch/extensions/websearch.ts
```

## Configuration

The extension reads two environment variables:

| Variable | Default | Description |
|---|---|---|
| `SEARXNG_URL` | `http://localhost:8181` | Base URL of your SearXNG instance. |
| `SEARXNG_MAX_RESULTS` | `5` | Default max results per search (1–20). |

Set them in your shell or in pi's environment before starting pi, for example:

```bash
export SEARXNG_URL=http://searxng.local
export SEARXNG_MAX_RESULTS=8
pi
```

## Usage

Once installed, the agent can call `web_search` automatically. You can also invoke it directly:

```text
Search the web for "Tabby terminal" and return the top results.
```

The tool returns results as:

```markdown
# Web search: Tabby terminal
Found 20 result(s).

1. **Tabby - a terminal for a more modern age**
   https://tabby.sh/
   A terminal for the modern age...
   _(engine: google cse)_

2. **Eugeny/tabby: A terminal for the modern age - GitHub**
   https://github.com/eugeny/tabby
   What Tabby is and isn't...
```

## Deploying SearXNG

A minimal SearXNG setup with Docker Compose (already configured for JSON output):

```yaml
services:
  searxng:
    image: searxng/searxng:latest
    container_name: searxng
    restart: unless-stopped
    ports:
      - "8181:8080"
    volumes:
      - ./settings.yml:/etc/searxng/settings.yml:ro

networks:
  default:
    driver: bridge
```

with `settings.yml`:

```yaml
use_default_settings: true

server:
  secret_key: "change-me"
  image_proxy: true

search:
  formats:
    - html
    - json
```

> **Note:** If your container cannot reach the internet directly (e.g. you're behind a proxy), add an `outgoing.proxies` block to `settings.yml` pointing at a reachable HTTP proxy.

## License

MIT