# Format Lizard v2

This repository is the separate development home for Format Lizard v2, copied from the original project with its commit history preserved. The original repository and live site remain independent.

The app currently matches the original formatter. Background processing, progress and cancellation, incremental XML processing, and large-file previews are planned; they are not implemented yet.

A small JavaScript formatter app for JSON, XML, YAML, and CSS.

Open `index.html` in a browser, paste compact or messy data into the left editor, or use `Open` to load a local `.json`, `.xml`, `.config`, `.yaml`, `.yml`, or `.css` file.
Then format or minify it into the right editor.
Use `Save` to download the formatted output as a `.json`, `.xml`, `.yaml`, or `.css` file.

The browser remembers the last input, output, format, indentation, key sorting, and text or tree view. **Clear** empties the saved editors.

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
