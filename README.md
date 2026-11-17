# Format Lizard v2

This repository is the separate development home for Format Lizard v2, copied from the original project with its commit history preserved. The original repository and live site remain independent.

XML formatting and minifying now run in a background worker, with progress and Cancel. Files over 2 MiB use a read-only input preview. Output over 2,097,152 characters shows a 65,536-character preview; **Save** downloads the complete result, and **Copy** is disabled for partial previews.

The complete input remains available to Format and Minify in the current tab. Large workspaces are not written to browser storage; save the result before closing the tab. Small workspaces use a v2-specific storage key, separate from v1.

XML is checked and written in two incremental passes without constructing a DOM. Mixed content, CDATA, namespace bindings, and `xml:space="preserve"` are retained. Output uses UTF-8. The parser is non-validating: it does not validate against a DTD or fetch external entities, and references to custom DTD entities report an error. JSON, YAML and CSS keep the existing engines; large inputs use a worker but still require their full parsed data in memory.

Output Blobs and individual XML tokens still require memory. Performance depends on document structure and hardware; this is not a guarantee that every file size can be processed.

A small JavaScript formatter app for JSON, XML, YAML, and CSS.

Open the hosted website, paste compact or messy data into the left editor, or use `Open` to load a local `.json`, `.xml`, `.config`, `.yaml`, `.yml`, or `.css` file.
Then format or minify it into the right editor.
Use `Save` to download the formatted output as a `.json`, `.xml`, `.yaml`, or `.css` file.

For small workspaces, the browser remembers the last input, output, format, indentation, key sorting, and text or tree view. **Clear** empties the saved editors. JSON tree rendering is disabled above 100,000 output characters.

For logo, color, versioning, and publishing details, see [BRAND_AND_DEPLOYMENT.md](BRAND_AND_DEPLOYMENT.md).

## Supported Formats

- JSON
- XML
- YAML
- CSS

JSON tools:

- Auto-detect JSON/XML/YAML/CSS from pasted content.
- View formatted JSON as an expandable tree.
- Sort object keys before formatting or minifying JSON.
- Unescape JSON strings, such as `"{\"name\":\"Ada\"}"`, into editable JSON.
- Convert JSON to XML.

YAML support covers common configuration-file shapes: mappings, lists, nested values, strings, booleans, nulls, and numbers.

CSS support covers standard stylesheets, including comments, selectors, declarations, `@media`, and `@keyframes`.

Good next candidates:

- CSV, for table-shaped data.
- HTML, for markup snippets.
- SQL, for database queries.
- Markdown, for prose cleanup.

## GitHub Pages

This repository uses `main` for source and history. Its `origin` must point to:

```text
https://github.com/davidbreyer/format-lizard-v2.git
```

To enable its own GitHub Pages site, open this repository's **Settings > Pages**, select **Deploy from a branch**, choose **main** and **/(root)**, then save.

The expected Pages URL is `https://davidbreyer.github.io/format-lizard-v2/`; the account's custom domain may redirect it to `https://www.davidbreyer.com/format-lizard-v2/`. Creating or pushing the repository does not enable Pages by itself.

Normal update flow after enabling Pages:

```powershell
git add -- ...
git commit -m "Some change"
git push origin main
```

Publish v2 only from this repository. Do not push v2 changes to the original `format-lizard` repository or its `gh-pages` branch.

## Release Stamp

The footer displays the current version:

```text
Version: YYYYMMDD-HHMM
```

The value lives in `script.js`:

```js
const appRelease = "YYYYMMDD-HHMM";
```

The same value is used for cache-busting query strings in `index.html` for CSS and JavaScript files.

## Git Hooks

The repo includes a pre-commit hook that updates the release stamp automatically before each commit.

Enable it once per local clone:

```powershell
git config core.hooksPath .githooks
```

After that, every `git commit` runs:

```powershell
scripts/update-release.ps1
```

The script updates:

- `const appRelease` in `script.js`
- the visible footer version in `index.html`
- all `?v=...` cache-busting query strings in `index.html`

The hook stages `index.html` and `script.js` so the generated release stamp is included in the commit.

## Development and validation

Use a current Node.js release (20 or later). Run `npm ci`, then `npm test` for worker and DOM integration checks. The DOM checks use jsdom and real Node worker threads; they do not verify browser rendering.

Serve the repository over HTTP for local worker testing, for example `python -m http.server 8765`, then open `http://localhost:8765/`. Workers require an HTTP(S) origin; opening the HTML directly from disk is not supported for XML processing. `tests/browser.html` runs the integration checks in an actual browser when served from the same origin.

To benchmark generated XML around 140 MB in PowerShell:

```powershell
$env:LIZARD_BENCHMARK = '1'
node --test --test-name-pattern='140 MB' tests/worker.test.cjs
```

This is a synthetic worker benchmark, not a browser performance guarantee. The large fixture is generated in memory and is not committed.
