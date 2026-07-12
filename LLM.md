# Websites Plugin — LLM Coding Primer

Supplement to the Q Framework and Streams primers. Covers URL scraping,
webpage streams, articles, permalinks, theme extraction, and news aggregation.

---

## 1. Scraping URLs into Streams

```php
// Scrape a URL and create a Websites/webpage stream (or Streams/video, Streams/audio)
$stream = Websites_Webpage::createStream(array(
    'url'         => 'https://example.com/page',
    'asUserId'    => $userId,      // null = logged-in user
    'publisherId' => $publisherId  // null = logged-in user
), 'Websites/webpage/chat', false);
// Returns existing stream if URL was already scraped
// Quota name: 'Websites/webpage/chat' or 'Websites/webpage/conversation'
// Third arg: $skipAccess

// Stream attributes after creation:
// url, urlParsed, host, port, copyright, contentType, lang,
// interest: {publisherId, streamName}
// Stream icon is imported from the page's og:image or apple-touch-icon

// Just scrape without creating a stream
$data = Websites_Webpage::scrape('https://example.com');
// Returns: title, url, description, keywords, iconBig, iconSmall,
//          image, host, port, headers, lang, type, ...

// Check if stream already exists for a URL
$stream = Websites_Webpage::fetchStream('https://example.com/page');
// Returns Streams_Stream or null
```

**URL → stream type detection:**
```php
$type = Websites_Webpage::getStreamType($url);
// 'Streams/video'   — youtube.com, vimeo.com, .mp4, .avi, etc.
// 'Streams/audio'   — soundcloud.com, .mp3, .wav, etc.
// 'Websites/webpage' — everything else
```

**Stream name convention:**
```php
$name = $streamType . '/' . Websites_Webpage::normalizeUrl($url);
// e.g. "Websites/webpage/https___example_com_page"
// normalizeUrl: Q_Utils::normalize(), truncated to 200 chars
```

---

## 2. Scrape Caching

```php
// Check cache (30-day TTL by default)
$cached = Websites_Webpage::cacheGet($url);
// Returns array or false

// Write to cache
Websites_Webpage::cacheSet($url, $resultArray, $durationSeconds);
// $duration defaults to 2592000 (30 days)

// Cache is stored in websites_webpage table:
// PK: url (varchar 191)
// results: JSON text
// duration: int (TTL in seconds)
```

---

## 3. YouTube Integration

```php
// Get info about a single video
$videos = Websites_Webpage::youtube(array(
    'videoId' => 'dQw4w9WgXcQ'
));
// Returns array of: platform, videoId, title, icon, iconBig,
//   description, keywords, publishTime, url

// Search videos
$results = Websites_Webpage::youtube(array(
    'query'      => 'qbix framework tutorial',
    'channel'    => $channelId,    // optional
    'maxResults' => 10,
    'order'      => 'date'         // date, rating, relevance, viewCount
));

// Get raw API response
$raw = Websites_Webpage::youtube(array(
    'videoId'    => 'dQw4w9WgXcQ',
    'pureResult' => true
));

// Requires config: Websites.youtube.keys.server
```

---

## 4. Articles

```php
// Articles use stream type "Websites/article" with extended table
// The Websites_Article class extends the stream via the 'extend' mechanism

// Create an article stream
$article = Streams::create($asUserId, $publisherId, 'Websites/article', array(
    'title'   => 'My Article',
    'content' => 'Summary/teaser'
));
// The full HTML body goes in the article table:
$wa = new Websites_Article();
$wa->publisherId = $article->publisherId;
$wa->streamName  = $article->name;
$wa->userId      = $asUserId;
$wa->article      = '<h1>Full HTML content...</h1>';
$wa->getintouch   = Q::json_encode(array('emailSubject' => 'Re: My Article'));
$wa->save();

// Article defaults: readLevel 10 (see only), writeLevel 0, adminLevel 10
// Relate to category: type 'Websites/articles' or 'Websites/announcements'
```

---

## 5. Permalinks

```php
// Create a permalink (vanity URL → internal URI)
$p = new Websites_Permalink();
$p->uri = 'Streams/stream publisherId=abc streamName=MyPlugin/thing/123';
$p->url = 'my-cool-page';
$p->save();
// beforeSave sets stream attribute 'Websites/url' on the target stream

// Lookup: the Q_Uri_fromUrl / Q_Uri_toUrl hooks resolve
// https://app.example/my-cool-page → internal Qbix URI automatically

// Config to enable:
// "Websites": { "permalinks": { "enabled": true } }
```

---

## 6. Theme Extraction (Headless Chrome)

```php
// Analyze a website's visual design
$analysis = Websites_Webpage::analyze('https://example.com', array(
    'viewport' => array('width' => 1440, 'height' => 900),
    'waitMs'   => 3000  // wait for fonts/async CSS
));
// Returns: title, url, stylesBySelector, fonts, dominantColors,
//   rootThemeColors, navCandidates, detectedNav, colorRoles,
//   _assets {cssUrls, fontFaces, fontFiles}, largestBlocks

// Generate CSS variables from analysis
$css = Websites_Webpage::generateThemeCss($analysis, array(
    'scope'        => ':root',
    'includeFonts' => true,
    'maxFonts'     => 6
));
// Returns CSS string with:
//   --theme-fg, --theme-bg, --theme-brand, --theme-link,
//   --theme-nav-bg, --theme-nav-fg,
//   --theme-font-body, --theme-font-heading,
//   --theme-font-weight-body, --theme-font-weight-heading,
//   --theme-accent-1, --theme-accent-2,
//   plus @font-face blocks

// Get cached theme CSS path (auto-generates if missing)
$path = Websites_Webpage::getThemeCssPath(
    'https://example.com',
    'desktop',                    // 'mobile', 'tablet', 'desktop'
    array('reanalyze' => false)   // true = force re-scrape
);
// Files stored at: $uploads/Websites/theme/{host}/{formFactor}.css

// Theme directory for a URL
$dir = Websites_Webpage::themeDir('https://example.com');
// Override via 'Websites/Webpage/themeDir' {before} hook

// Requires: headless Chrome running (CHROME_HOST:CHROME_PORT or local)
// and composer require chrome-php/chrome
```

---

## 7. News Aggregation

```php
// Fetch news from configured provider
// Provider set in config: Websites.news.provider = "newsapi" | "gnews" | "eventregistry"
// Each provider class: Websites_News_Newsapi, Websites_News_Gnews, Websites_News_Eventregistry

// News articles create Websites/news streams with the same structure
// as Websites/webpage streams (chat-enabled, readLevel 40)
```

---

## 8. Metadata (SEO) Streams

```php
// Websites/metadata streams store per-page SEO config
// One per route/page, controlled by Websites/admins role
// Attributes: title, description, keywords, og:* tags

// The before/Q_responseExtras hook reads the metadata stream
// for the current route and sets <meta> tags accordingly
```

---

## 9. Utility Methods

```php
// Normalize a URL for use in stream names
$normalized = Websites_Webpage::normalizeUrl($url);
// Calls Q_Utils::normalize(), truncates to 200 chars

// Normalize relative href against a base URL
$abs = Websites_Webpage::normalizeHref('//cdn.example.com/img.png', 'https://example.com/page');
// Handles: //protocol-relative, /root-relative, ./relative

// Read limited data from remote URL
$data = Websites_Webpage::readURL('https://example.com/big-file.pdf', 65536);
// Reads up to $dataLimit bytes (default 64KB)

// Get remote file metadata (title, artist, format)
$info = Websites_Webpage::getRemoteFileInfo($url, 65536, true);
// Uses getID3 for audio/video metadata

// Haversine distance (from Places, but used by Websites for geo-tagged content)
$meters = Places::distance($lat1, $lon1, $lat2, $lon2);
```

---

## 10. Common Mistakes

| Wrong | Right |
|-------|-------|
| Creating Websites/webpage stream directly with `Streams::create` | Use `Websites_Webpage::createStream()` — handles scraping, caching, icons, interests, quotas |
| Storing article HTML in stream `content` | `content` is the teaser/summary; full HTML goes in `websites_article.article` column |
| Calling `analyze()` without headless Chrome running | Requires Chrome on `CHROME_HOST:CHROME_PORT` (default 127.0.0.1:9222) |
| Setting permalinks without enabling them | Set `Websites.permalinks.enabled = true` in config |
| Using `Websites_Webpage::scrape()` for YouTube URLs | It works but `Websites_Webpage::youtube()` gives richer data via the API |
| Expecting `createStream()` to re-scrape an existing URL | Returns the existing stream; delete the stream + cache row first to re-scrape |
| Writing to `websites_webpage` cache directly | Use `cacheGet`/`cacheSet` — they handle TTL, slash normalization, and JSON encoding |

---

## 11. Key Schema

### websites_article (extends Websites/article streams)
```sql
publisherId  varbinary(31)   PK
streamName   varbinary(255)  PK
userId       varbinary(31)       -- article author
article      text                -- full HTML body
getintouch   varchar(255)    DEFAULT '{}'  -- JSON contact config
```

### websites_permalink
```sql
uri           varbinary(255)  PK  -- Qbix internal URI string
url           varbinary(255)  KEY -- vanity URL slug
insertedTime  timestamp
updatedTime   timestamp
```

### websites_webpage (scrape cache)
```sql
url           varchar(191)  PK
cache         varchar(255)  KEY
results       text              -- JSON scraped metadata
duration      int           DEFAULT 2592000  -- cache TTL seconds
insertedTime  timestamp
updatedTime   timestamp
```

---

## 12. Configuration Reference

```
Websites.permalinks.enabled         — enable vanity URL routing (default false)
Websites.news.provider              — 'newsapi', 'gnews', or 'eventregistry'
Websites.youtube.keys.server        — YouTube Data API v3 key
Websites.videoHosts                 — array of hostnames treated as video
Websites.audioHosts                 — array of hostnames treated as audio
Websites.cacheFileLimit             — max bytes per cached scrape (5MB)
Websites.cacheDirectoryLimit        — max total cache bytes (50MB)
Websites.theme.scope                — CSS scope for variables (default ':root')
Websites.theme.maxFonts             — max @font-face blocks (default 6)
Websites.theme.browserCacheSeconds  — HTTP cache for theme.css (default 300)
Websites.theme.viewports            — viewport dimensions per form factor
Websites.metadataReload             — whether to reload metadata on save
```