# JSON2HTML Feature Documentation

## Overview

JSON2HTML is an out-of-the-box (OOTB) overlay for AEM Edge Delivery Services that dynamically converts JSON data from any endpoint into server-side rendered HTML pages optimized for edge delivery.

**Official Documentation:** https://www.aem.live/developer/json2html

---

## Core Concept

```
JSON Data (from any endpoint) → JSON2HTML Service → Semantic HTML (edge-optimized)
```

The service:
1. Matches incoming URLs against configured path patterns
2. Fetches JSON data from specified endpoints
3. Transforms the data into HTML using templates
4. Returns server-side rendered, SEO-friendly HTML

---

## Configuration Structure

JSON2HTML configurations are stored per `org/site/branch` and consist of an array of configuration objects.

### Minimal Configuration

```json
{
  "path": "/events/",
  "endpoint": "https://api.example.com/events"
}
```

### Complete Configuration

```json
{
  "path": "/events/",
  "endpoint": "https://api.example.com/events/{{id}}",
  "regex": "/[^/]+$/",
  "template": "/templates/event-template.html",
  "headers": {
    "X-API-Key": "your-api-key",
    "Accept": "application/json"
  },
  "forwardHeaders": ["Authorization", "X-User-ID"],
  "relativeURLPrefix": "https://cdn.example.com",
  "schemaBasedTemplate": true,
  "arrayKey": "data",
  "pathKey": "slug",
  "useAEMMapping": false
}
```

---

## Configuration Properties

### Required Properties

| Property | Type | Description |
|----------|------|-------------|
| `path` | string | URL path pattern to match (e.g., `/events/`, `/products/`) |
| `endpoint` | string | API endpoint URL to fetch JSON data from |

### Optional Properties

| Property | Type | Description |
|----------|------|-------------|
| `regex` | string | Regular expression to extract ID from URL (e.g., `/[^/]+$/`) |
| `template` | string | Path to HTML template file for rendering |
| `headers` | object | Custom HTTP headers to send with API request |
| `forwardHeaders` | array | Headers to forward from incoming request to API |
| `relativeURLPrefix` | string | Prefix to prepend to relative media URLs (e.g., CDN domain) |
| `schemaBasedTemplate` | boolean | Use `schema` field from JSON to select template |
| `arrayKey` | string | Key to access array in JSON response (empty string for root) |
| `pathKey` | string | Key to match against URL path (supports dot notation) |
| `useAEMMapping` | boolean | Enable AEM-specific URL mapping |
| `templateApiKey` | string | API key for template retrieval |

---

## Feature Details

### 1. Basic Path and Endpoint Matching

**Use Case:** Convert any JSON endpoint to HTML with default structure

```json
{
  "path": "/api/data/",
  "endpoint": "https://api.example.com/data"
}
```

- Requests to `/api/data/*` fetch from the endpoint
- Generates default HTML structure from JSON
- No template required

### 2. Dynamic ID Extraction with Regex

**Use Case:** Extract identifiers from URLs and inject into API calls

```json
{
  "path": "/products/",
  "endpoint": "https://api.example.com/products/{{id}}",
  "regex": "/[^/]+$/"
}
```

- URL: `/products/abc-123` → extracts `abc-123`
- Calls: `https://api.example.com/products/abc-123`
- The `{{id}}` placeholder is replaced with extracted value

### 3. Custom HTML Templates

**Use Case:** Control exactly how JSON renders as HTML

```json
{
  "path": "/events/",
  "endpoint": "https://api.example.com/events/{{id}}",
  "regex": "/[^/]+$/",
  "template": "/templates/event-page.html"
}
```

Templates can use:
- Standard HTML structure
- Placeholders for JSON data
- Semantic markup for SEO

### 4. Custom Headers and Header Forwarding

**Use Case:** Authenticated API calls and user-specific content

```json
{
  "path": "/secure/data/",
  "endpoint": "https://api.example.com/secure/data",
  "headers": {
    "X-API-Key": "static-key-123",
    "Accept": "application/json"
  },
  "forwardHeaders": ["Authorization", "X-User-ID"]
}
```

- `headers`: Static headers sent with every API request
- `forwardHeaders`: Dynamic headers forwarded from incoming request
- Supports header placeholders in endpoint URLs: `{{headers.headerName}}`

### 5. Relative URL Rewriting

**Use Case:** Serve media assets from CDN while keeping content URLs relative

```json
{
  "path": "/content/",
  "endpoint": "https://api.example.com/content",
  "template": "/templates/content.html",
  "relativeURLPrefix": "https://cdn.example.com"
}
```

**What it does:**
- Rewrites relative URLs: `/image.jpg` → `https://cdn.example.com/image.jpg`
- Only affects URLs starting with `/`
- Only affects media extensions: `.mp4`, `.pdf`, `.svg`, `.jpg`, `.jpeg`, `.png`
- Does NOT modify absolute or protocol-relative URLs

**Example transformation:**
```html
<!-- Before -->
<img src="/assets/photo.jpg">
<a href="https://example.com/external.jpg">External</a>

<!-- After (with relativeURLPrefix: "https://cdn.example.com") -->
<img src="https://cdn.example.com/assets/photo.jpg">
<a href="https://example.com/external.jpg">External</a>
```

### 6. Schema-Based Template Selection

**Use Case:** Different content types need different templates

```json
{
  "path": "/content/",
  "endpoint": "https://api.example.com/content/{{id}}",
  "regex": "/[^/]+$/",
  "schemaBasedTemplate": true
}
```

**How it works:**
1. JSON response includes a `schema` field: `"schema": "product"`
2. System looks for template at: `/schemas/product/product.html`
3. If not found, falls back to: `/schemas/generic.html`

**Example JSON response:**
```json
{
  "schema": "economic-event",
  "title": "Federal Reserve Meeting",
  "date": "2024-03-15",
  "description": "..."
}
```

Template path: `/schemas/economic-event/economic-event.html`

### 7. Array Filtering with arrayKey and pathKey

**Use Case:** Filter specific items from JSON arrays based on URL path

```json
{
  "path": "/us/en/products/",
  "endpoint": "https://api.example.com/all-products",
  "arrayKey": "data",
  "pathKey": "URL"
}
```

**Example JSON:**
```json
{
  "data": [
    { "URL": "/us/en/products/widget", "name": "Widget", "price": 19.99 },
    { "URL": "/us/en/products/gadget", "name": "Gadget", "price": 29.99 }
  ]
}
```

**Request:** `/us/en/products/widget`
**Result:** Returns only the "Widget" object

**Supports nested properties:**
```json
{
  "arrayKey": "products",
  "pathKey": "metadata.slug"
}
```

**Root-level arrays:**
```json
{
  "arrayKey": "",
  "pathKey": "path"
}
```

---

## Request Flow

```
1. Incoming Request
   ↓
2. Match URL against configured paths
   ↓
3. Extract ID using regex (if configured)
   ↓
4. Replace {{id}} and {{headers.*}} in endpoint URL
   ↓
5. Fetch JSON from endpoint with headers
   ↓
6. Filter data using arrayKey/pathKey (if configured)
   ↓
7. Select template (schema-based, configured, or default)
   ↓
8. Generate HTML from template + data
   ↓
9. Rewrite relative URLs (if configured)
   ↓
10. Return HTML response
```

---

## Common Use Cases

### Product Detail Pages (PDPs)

```json
{
  "path": "/products/",
  "endpoint": "https://api.shop.com/products/{{id}}",
  "regex": "/[^/]+$/",
  "template": "/templates/product.html",
  "relativeURLPrefix": "https://cdn.shop.com"
}
```

### Dynamic Event Pages

```json
{
  "path": "/events/",
  "endpoint": "https://cms.example.com/events/{{id}}",
  "regex": "/[^/]+$/",
  "schemaBasedTemplate": true
}
```

### Multi-locale Product Catalog

```json
{
  "path": "/us/en/products/",
  "endpoint": "https://api.shop.com/products-catalog",
  "arrayKey": "products",
  "pathKey": "localizedURL",
  "template": "/templates/product.html"
}
```

### Authenticated Content

```json
{
  "path": "/members/content/",
  "endpoint": "https://api.members.com/content/{{id}}",
  "regex": "/[^/]+$/",
  "headers": {
    "X-API-Key": "service-key"
  },
  "forwardHeaders": ["Authorization"],
  "template": "/templates/member-content.html"
}
```

---

## Configuration Management

### Create/Update Configuration

**Endpoint:** `POST /config/:org/:site/:branch`

**Headers:**
- `Authorization: Bearer <token>`
- `Content-Type: application/json`

**Body:**
```json
[
  {
    "path": "/events/",
    "endpoint": "https://api.example.com/events"
  },
  {
    "path": "/products/",
    "endpoint": "https://api.example.com/products"
  }
]
```

### Retrieve Configuration

**Endpoint:** `GET /config/:org/:site/:branch`

**Headers:**
- `Authorization: Bearer <token>`

**Response:** Array of configuration objects

### Branch Fallback

If configuration not found for a branch, the system automatically falls back to the `main` branch configuration.

---

## Media Extensions

URLs are only rewritten when they end with these extensions:

- `.mp4`
- `.pdf`
- `.svg`
- `.jpg`
- `.jpeg`
- `.png`

---

## Best Practices

### 1. Design JSON Structure First
Plan the structure of your JSON before creating templates. The JSON structure is your contract.

### 2. Use Semantic HTML
Generate semantic HTML for better SEO and accessibility:
- Proper heading hierarchy (`<h1>`, `<h2>`, etc.)
- Alt text for images
- ARIA labels where appropriate

### 3. Optimize for Performance
- Use `relativeURLPrefix` to serve media from CDN
- Keep templates focused and minimal
- Consider caching strategies

### 4. Security Considerations
- Never expose API keys in public templates
- Use `headers` for static API keys
- Use `forwardHeaders` for user-specific authentication
- Validate data in templates

### 5. Testing Strategy
- Test with minimal config first
- Add features incrementally
- Verify URL rewriting with different media types
- Test branch fallback behavior

---

## Limitations and Considerations

1. **Media Extensions Only:** URL rewriting only affects specific file extensions
2. **Relative URLs Only:** Only URLs starting with `/` are rewritten
3. **Server-Side Only:** Rendering happens on the server, not client-side
4. **Authorization Required:** Configuration changes require authentication
5. **KV Storage:** Configurations stored in Cloudflare KV (eventual consistency)

---

## Examples from Test Suite

### Example 1: Minimal Configuration
```json
{
  "path": "/minimal/",
  "endpoint": "/test/event-550127.json"
}
```

### Example 2: Complete Configuration
```json
{
  "path": "/complete/events/",
  "endpoint": "/test/event-550127.json",
  "regex": "/[^/]+$/",
  "template": "/test/test-template.html",
  "headers": {
    "X-API-Key": "complete-test-key",
    "Accept": "application/json",
    "Cache-Control": "no-cache"
  },
  "forwardHeaders": ["Authorization", "X-User-ID", "X-Session-ID"],
  "relativeURLPrefix": "https://assets.example.com",
  "schemaBasedTemplate": false
}
```

### Example 3: Nested Path Keys
```json
{
  "path": "/nested/products/",
  "endpoint": "/test/nested-products-data.json",
  "arrayKey": "products",
  "pathKey": "metadata.slug"
}
```

---

## References

- **Official Documentation:** https://www.aem.live/developer/json2html
- **Content Fragment Overlay:** https://www.aem.live/developer/content-fragment-overlay
- **Hands-on Exercise:** https://github.com/cloudadoption/eds-masterclass/blob/main/docs/json2html/json2html.md
- **Feature Lifecycle:** https://www.aem.live/docs/lifecycle

---

## Implementation Notes

The current implementation:
- Runs on Cloudflare Workers
- Uses Cloudflare KV for configuration storage
- Deployed at edge locations globally
- Supports branch-specific configurations with main fallback
- Includes 13+ test scenarios covering all features

---

*Last Updated: December 2025*

