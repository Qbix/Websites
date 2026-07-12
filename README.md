# Websites Plugin

Web scraping, article publishing, permalink management, advertising, news aggregation, and automated theme extraction for the Qbix platform. Websites turns external URLs into first-class Qbix streams — scraping metadata, importing icons, creating chat-enabled discussion streams, and extracting visual themes via headless Chrome.

## Core Concepts

The plugin handles four concerns: turning URLs into content streams (web scraping), publishing long-form articles, managing SEO/permalinks, and extracting visual themes from external websites.

### Web Page Streams

When a URL is shared, `Websites_Webpage::createStream()` scrapes the page, extracts OpenGraph/meta tags, title, icons, and description, then creates a `Websites/webpage` stream (or `Streams/video`/`Streams/audio` for media URLs). The stream stores the extracted metadata in its attributes and the scraped icon as its stream icon.

The scraping pipeline: resolve redirects (up to 5 hops), detect content type, parse HTML with DOMDocument, extract `<meta>` tags (og:* and standard), find icon links (`apple-touch-icon`, `shortcut icon`, `favicon`), locate canonical URL, and handle YouTube URLs specially via the YouTube Data API. Non-HTML URLs (PDFs, images, audio) get file-type icons and metadata via getID3.

Each webpage stream is related to an interest stream for its domain (e.g. `Websites: example.com`), enabling topic-based discovery. Keywords from meta tags create additional interest relations.

Scrape results are cached in the `webpage` table with a configurable TTL (default 30 days, stored in the `duration` column). The cache respects a file-size limit (5MB per entry, 50MB total directory).

### URL Type Detection

`Websites_Webpage::getStreamType($url)` inspects the URL host and file extension to classify URLs:

Video hosts (youtube.com, youtu.be, vimeo.com) and video extensions (MP4, AVI, MOV, etc.) → `Streams/video`. Audio hosts (soundcloud.com) and audio extensions (MP3, WAV) → `Streams/audio`. Everything else → `Websites/webpage`.

### Articles

`Websites/article` is a stream type for long-form content with a companion `article` table storing the full HTML body. Articles support Froala WYSIWYG editing, "get in touch" contact widgets, and relation to announcement/article category streams. The `Websites_Article` class extends the stream via the `extend` mechanism.

Articles are published under routes like `Websites/article/{articleId}` and can be related to category streams via `Websites/articles` and `Websites/announcements` relation types.

### Metadata (SEO)

The `Websites/metadata` stream type stores per-page SEO metadata (title, description, keywords, Open Graph tags). The `Websites/before/Streams_Stream_save_Websites_metadata` hook intercepts saves to validate and process metadata changes.

### Permalinks

The `permalink` table maps Qbix internal URIs to vanity URLs. When a permalink is saved, its `beforeSave` hook sets the `Websites/url` attribute on the target stream, enabling slug-based URL routing. The `Q_Uri_fromUrl` and `Q_Uri_toUrl` hooks intercept URL resolution to transparently rewrite between pretty URLs and internal URIs.

### Advertising System

The plugin defines stream types for a complete ad serving pipeline: `Websites/advert/unit` (ad placements on pages), `Websites/advert/placement` (category of placements), `Websites/advert/creative` (the ad content itself), and `Websites/advert/campaign` (campaign management grouping creatives and placements).

### News Aggregation

`Websites_News` provides adapters for external news APIs. Three providers are supported: `Websites_News_Newsapi` (newsapi.org), `Websites_News_Gnews` (gnews.io), and `Websites_News_Eventregistry` (eventregistry.org). The active provider is configured via `Websites.news.provider`. News articles are stored as `Websites/news` stream type.

### Theme Extraction

`Websites_Webpage::analyze($url)` launches headless Chrome (via chrome-php), navigates to the URL, injects `analyze.js` and `cssprobe.js`, and extracts computed styles, fonts, dominant colors, navigation structure, and CSS variables. It then crawls linked stylesheets server-side to collect `@font-face` blocks and font file URLs.

`Websites_Webpage::generateThemeCss($analysis)` converts the analysis into a CSS file with `:root` variables: `--theme-fg`, `--theme-bg`, `--theme-brand`, `--theme-link`, `--theme-nav-bg`, `--theme-nav-fg`, `--theme-font-body`, `--theme-font-heading`, plus `@font-face` declarations. This lets Qbix apps adopt the visual identity of a customer's existing website.

Theme CSS is cached per host in `$uploads/Websites/theme/{host}/{formFactor}.css` with per-viewport variants (mobile 375×812, tablet 768×1024, desktop 1440×900). The `Websites/theme.css` route serves the generated CSS with browser caching.

### YouTube Integration

`Websites_Webpage::youtube($options)` wraps the YouTube Data API v3 for video info and search. Requires `Websites.youtube.keys.server` config. Results are cached in the webpage table. Supports searching by query, channel, and fetching by videoId, with configurable cache durations.

## Database Schema

### article
```
publisherId  varbinary(31)   PK
streamName   varbinary(255)  PK
userId       varbinary(31)        — article author
article      text                 — full HTML body
getintouch   varchar(255)    DEFAULT '{}'  — JSON contact config
```

### permalink
```
uri           varbinary(255)  PK   — Qbix internal URI
url           varbinary(255)  KEY  — vanity URL slug
insertedTime  timestamp
updatedTime   timestamp
```

### webpage (scrape cache)
```
url           varchar(191)  PK
cache         varchar(255)  KEY
results       text               — JSON scraped data
duration      int           DEFAULT 2592000  — cache TTL in seconds (30 days)
insertedTime  timestamp
updatedTime   timestamp
```

## Stream Types

| Type | Purpose |
|---|---|
| `Websites/webpage` | External web page with chat (readLevel 40, writeLevel 23) |
| `Websites/news` | Aggregated news article with chat |
| `Websites/article` | Long-form authored article (readLevel 10) |
| `Websites/metadata` | Per-page SEO metadata |
| `Websites/advert/unit` | Ad placement slot |
| `Websites/advert/placement` | Category of ad slots |
| `Websites/advert/creative` | Ad creative content |
| `Websites/advert/campaign` | Ad campaign grouping |

## Configuration

```json
{
    "Websites": {
        "permalinks": { "enabled": false },
        "news": { "provider": "newsapi" },
        "videoHosts": ["youtube.com", "youtu.be", "vimeo.com"],
        "audioHosts": ["soundcloud.com"],
        "cacheFileLimit": 5242880,
        "cacheDirectoryLimit": 52428800,
        "theme": {
            "scope": ":root",
            "maxFonts": 6,
            "browserCacheSeconds": 300,
            "viewports": {
                "mobile":  { "width": 375,  "height": 812 },
                "tablet":  { "width": 768,  "height": 1024 },
                "desktop": { "width": 1440, "height": 900 }
            }
        }
    }
}
```

## Client-Side Tools

`Websites/webpage/preview` — Rich link preview card with icon, title, description. `Websites/webpage/chat` — Chat interface for discussing a web page. `Websites/webpage/composer` — URL input that scrapes and creates webpage streams. `Websites/lookup` — URL autocomplete/search. `Websites/metadata` — SEO metadata editor. `Websites/article` — Article viewer with get-in-touch widget. `Websites/citations` — Citation/bibliography formatter. `Websites/advert/campaign/preview` — Ad campaign preview card. `Websites/announcement/preview` — Announcement preview card.

## Routes

| Route | Handler |
|---|---|
| `Websites/theme.css` | `Websites/theme` — serves generated theme CSS |
| `Websites/:action/:articleId` | Generic action routing with article ID |