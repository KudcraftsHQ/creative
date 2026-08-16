# creative

A headless Canva. Marketplace creatives as JSON documents, rendered by Skia, driven
from a CLI and an MCP server — so an agent can make them without a human opening a
browser.

The work it replaces is not design. It is data entry against a layout you decided
months ago: swap the photo, retype the price, nudge the yellow block because the new
headline is two characters longer. That is a function call wearing a GUI.

```bash
creative font add Anton                                  # Google Fonts, no API key
creative fill promo-band \
  --set photo=./babybreath.jpg \
  --set headline="HARGA GROSIR CUMA" --set price=57 --set kicker="RIBUAN!" \
  -o promo.jpg --max-kb 300
```

## Install

```bash
brew install KudcraftsHQ/tap/creative
```

Or grab a binary from [releases](https://github.com/KudcraftsHQ/creative/releases). To
run from source you need [Bun](https://bun.sh):

```bash
git clone https://github.com/KudcraftsHQ/creative && cd creative
bun install
bun run cli --help
```

## What it does

**Text that fits.** A text layer is a list of styled runs, not a string. Wrapping
happens across run boundaries, the tallest run sets its line's height, and auto-fit
finds one scale factor applied to every run — so the 3× ratio between the price and
the words around it survives at any copy length.

**Boxes that follow the copy.** `box.mode: "grow"` grows the highlight block around
the text; `"fit"` scales the text into a fixed frame. `perLine` gives each wrapped
line its own rounded bar, hugging its own width, overlapping by the vertical padding
so they read as one shape. That effect is most of what makes an image look "made in
Canva".

**Layout that moves together.** Layers anchor to the canvas (`anchor`, `inset`) or to
each other (`below`, `gap`, `align`). A headline that grows by a line pushes the fine
print down instead of colliding with it.

**A feedback loop an agent can close.** `inspect` returns every layer's resolved box
and chosen font size. `lint` returns defects — overflow, off-canvas, contrast sampled
against the pixels actually behind the text, missing or personal-only fonts, safe-area
violations — each with a suggested fix. Over MCP the render comes back as an image, so
the final check is a visual one.

## Commands

| | |
|---|---|
| `creative init [file]` | a starting document that already renders |
| `creative render <doc> -o out.png` | draw it |
| `creative inspect <doc>` | every layer's geometry, as JSON |
| `creative lint <doc>` | defects, with fixes |
| `creative templates` / `describe <t>` | what exists, and what it takes |
| `creative fill <t> --set k=v -o out.jpg` | the 90% command |
| `creative batch <t> rows.csv --out ./dist` | one image per row |
| `creative edit <doc> --layer headline --move 0,-40` | patch without rewriting |
| `creative font add Anton` | install from Google Fonts |
| `creative font add ./Bought.ttf --license commercial --source "invoice #12"` | anything else |
| `creative rmbg photo.jpg` | cut out to transparent PNG |
| `creative color photo.jpg --saturation 1.2 --tint "#F5C518"` | grade |
| `creative export out.png --max-kb 300 --sizes 1080,800,400` | fit a budget |
| `creative login` | OAuth through the browser, for the shared library |

Everything except `login` and `rmbg` works offline.

## Documents

```json
{
  "canvas": { "w": 1080, "h": 1080, "bg": "#ffffff" },
  "vars": { "block": "#F5C518", "ink": "#3B1E0A" },
  "layers": [
    { "type": "image", "id": "photo", "src": "photo.jpg",
      "frame": "full", "fit": "cover", "focal": [0.5, 0.45] },

    { "type": "text", "id": "headline",
      "frame": { "anchor": "top-right", "inset": [40, 40], "w": 580 },
      "box": { "mode": "grow", "fill": "@block", "radius": 16, "pad": [30, 20] },
      "autofit": { "min": 40, "max": 110 },
      "runs": [
        { "text": "HARGA GROSIR CUMA", "font": "Anton", "size": 88, "color": "@ink" },
        { "text": "57", "font": "Anton", "size": 122, "color": "#B3261E" },
        { "text": "RIBUAN!", "font": "Anton", "size": 88, "color": "@ink" }
      ] },

    { "type": "text", "id": "fine", "text": "* MIN 6 IKAT",
      "frame": { "below": "headline", "gap": 14, "align": "end" },
      "font": "Archivo Black", "size": 30, "color": "@ink", "align": "right",
      "box": { "mode": "grow", "fill": "@block", "radius": 10, "pad": [20, 13] } }
  ]
}
```

Same document plus same assets renders to the same bytes, always. That is what makes
caching, review and "re-render all 200 listings" possible.

## Templates

A template is a document with `{{slot}}` holes and a schema describing them, including
`maxChars` — how long copy can run before auto-fit starts shrinking it. `describe`
hands that to the agent, so it writes copy that fits rather than copy that gets mangled.

Two ship with the tool: `promo-band` (photo-first promo) and `spec-poster` (parts
listing). Author more by iterating: propose one from a reference image, fill it, render,
compare, adjust, save.

## MCP

```json
{
  "mcpServers": {
    "creative": {
      "command": "creative-mcp",
      "env": { "CREATIVE_TEMPLATES": "/path/to/templates" }
    }
  }
}
```

Tools: `render_document`, `lint_document`, `edit_document`, `list_templates`,
`describe_template`, `fill_template`, `save_template`, `compare_images`, `list_fonts`,
`add_font`, `preview_font`, `remove_background`, `export_image`.

`render_document`, `fill_template`, `preview_font` and `compare_images` return images,
because a design decision that is never looked at is not a design decision.

## Fonts and licences

Google's catalogue is a git repository of font files, so `font add <family>` needs no
API key. Everything else — purchased, or downloaded by hand from somewhere like DaFont,
where the default licence is personal-use-only — comes in through `font add <file>`
with `--license` and `--source` recorded. `lint` refuses to render commercial work with
a `personal-only` face. These images sell things; that rule costs nothing now and a
great deal later.

## What it will not do for you

Auto-fit is arithmetic. It can shrink a headline until it fits and the result can still
be weak next to the rest of the composition. `lint` reports `autofit-floor` when a layer
only fitted by going to its minimum — treat that as "rewrite the copy shorter", which is
what a designer would do, rather than as a pass.

## Licence

MIT.
