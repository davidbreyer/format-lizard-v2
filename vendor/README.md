# Bundled XML parser

`saxes.js` bundles [saxes 6.0.0](https://github.com/lddubeau/saxes/tree/v6.0.0) and its dependency [xmlchars 2.2.0](https://github.com/lddubeau/xmlchars). The worker loads this file locally; it does not fetch a parser from a CDN.

The upstream licenses are included in `saxes-LICENSE` (ISC) and `xmlchars-LICENSE` (MIT).

To rebuild the browser bundle, run `npm ci`, then `npm run build:vendor`. Runtime deployment needs only the committed static files; GitHub Pages does not need a Node build step.
