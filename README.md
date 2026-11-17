# Gifty 🎁

Save anything you find online to your own wish lists, with one click from your browser toolbar.

Gifty is a small, local-only browser extension in the spirit of Amazon's old "Add to Wish List" button, which let you save any product page, with a picture, a link, and a name, even when Amazon didn't sell it. That button is gone. Gifty brings the idea back without tying it to any store: if it's on a web page, you can save it, file it under whatever lists you invent, and find it again later.

No account. No server. No tracking. Everything you save stays in your browser, and you can export it any time.

## What it does

- **One-click save.** Click the Gifty button in your toolbar. It grabs the page title, main image, description, and price (when the site publishes one), and lets you fix anything before saving.
- **Your lists, your rules.** Create as many lists as you like ("Wishlist", "Gift ideas", "Maybe later", "For the house"), rename and delete them freely. Deleting a list never deletes its items; they move to another list.
- **Tags, notes, and priorities.** Tag items, add a note (size, color, why you want it), and mark priorities. Text you select on a page is offered as the note.
- **A real dashboard.** Search, filter by list, status, or tag, and sort by date, price, or title. Mark things bought, edit anything, or remove it.
- **No duplicates.** Saving the same link again updates the existing item instead of doubling it, even if you reached it through a different tracking link.
- **Quick save.** Right-click a page or a link and choose "Save to Gifty", or press `Alt+Shift+S`, to save without opening the popup. The toolbar badge shows how many items you still want.
- **Your data, portable.** Export everything as JSON (full backup, re-importable) or CSV (spreadsheet-friendly). Import merges by link, so re-importing never duplicates.
- **Image picker.** When a page offers several images, cycle through them in the popup or paste a different image URL.

## Install (Chrome, Edge, Brave, Arc, and other Chromium browsers)

Gifty isn't on the Chrome Web Store yet, so install it unpacked. It takes about a minute:

1. Download or clone this repository, and unzip it if needed. The folder containing `manifest.json` is the extension.
2. Open `chrome://extensions` (in Edge: `edge://extensions`, in Brave: `brave://extensions`).
3. Turn on **Developer mode** (usually a toggle in the top right).
4. Click **Load unpacked** and choose the folder from step 1.
5. Pin Gifty to your toolbar with the puzzle-piece menu, so the button is always visible.

To update after pulling new changes, open `chrome://extensions` and click the reload icon on Gifty's card. Your saved items are kept.

A note on icons: the toolbar icons are PNG files (`icons/icon16.png`, `icon48.png`, `icon128.png`). If your checkout is missing them, generate them from the SVG source with `python3 tools/make-icons.py` (needs Pillow: `pip install Pillow`), then reload the extension.

Firefox and Safari are not packaged yet. The code is Manifest V3 with no build step and no Chrome-only APIs beyond the standard `chrome.*` extension APIs, so a Firefox port should be mostly packaging; see [Roadmap](#roadmap).

## How to use it

1. Find something you might want someday. A product, a book, a tool, a trip, anything with a page.
2. Click the **Gifty** toolbar button.
3. Check the title, image, and price. Pick a list (or make a new one), add tags and a note if you like, and click **Save to Gifty**.
4. To browse everything, click **View all** in the popup, right-click the toolbar button and choose **Options**, or open the dashboard from `chrome://extensions` → Gifty → **Details** → **Extension options**.

Tips:

- `Ctrl/⌘ + Enter` saves from the popup.
- `/` focuses search on the dashboard; `Esc` closes the edit window.
- The badge number on the toolbar button is your count of still-wanted items.

## Privacy

Gifty collects nothing and phones home nowhere. There is no account, no analytics, and no server. Saved items live in `chrome.storage.local` in your browser profile.

The extension asks for these permissions, and only for these reasons:

| Permission | Why |
| --- | --- |
| `storage` | To save your items and lists locally. |
| `activeTab` | To read the title and address of the tab you choose to save. |
| `scripting` + host access to all URLs | To read a page's title, image, and price when you ask to save it, including tabs that were open before you installed Gifty. It reads only when you trigger a save, and it sends nothing anywhere. |
| `contextMenus` | For the right-click "Save to Gifty" entries. |

Images in the dashboard load directly from the original sites, as your browser would load any linked image. See [PRIVACY.md](PRIVACY.md) for the full statement written for store listing.

## Files

No build step, no dependencies, plain HTML/CSS/JavaScript:

```
manifest.json       Extension manifest (Manifest V3)
background.js       Context menus, keyboard shortcut, badge count
content.js          Page scraper: title, images, description, price
popup.html/.css/.js Toolbar save dialog
dashboard.html/.css/.js  Full wish-list browser, editor, export/import
store.js            All storage reads/writes (see "Built sync-ready" below)
utils.js            Pure helpers: URL canonicalization, price parsing, tags
icons/              Toolbar/dashboard icons (SVG source + PNGs)
tools/make-icons.py Regenerates the PNG icons (needs Pillow)
```

### How the scraper finds a price

In order: structured data on the page (JSON-LD `Product` offers), product meta tags (`product:price:amount`), microdata (`itemprop="price"`), then `data-price` attributes. It deliberately does not guess prices out of visible page text, which grabs the wrong number too often. If no price is found, type it in the popup; it takes two seconds and it's right.

### Data model

Each saved item is a plain object with a stable UUID, `createdAt`/`updatedAt` timestamps, and these fields: `title`, `url`, `normalizedUrl`, `site`, `image`, `images`, `price`, `priceText`, `currency`, `description`, `listId`, `tags`, `note`, `priority` (`low`/`medium`/`high`), `status` (`want`/`bought`), and `source`. Lists are `{ id, name, createdAt }`. The JSON export is `{ app: "gifty", schemaVersion, exportedAt, lists, items }`, and import accepts that format or a bare array of items.

### Built sync-ready

This version is local-only on purpose, but it is built so a hosted, synced version with accounts can be added later without rewriting the UI: every item already has a stable ID and timestamps, and every read/write in the popup, dashboard, and background goes through `store.js`. A future sync backend would swap the storage layer inside that one file (plus sign-in and conflict handling), while the save/browse/edit flows stay as they are. Export/import already gives you a manual sync path today: export on one machine, import on another, and duplicates merge by link.

## Preview without installing

Open `dashboard.html` directly in a browser and it runs in preview mode, storing items in that browser's local storage with three labelled sample items so you can see the layout. The toolbar button and page scraping only work once the extension is installed.

## Roadmap

Ideas, roughly in order. Nothing here is promised; the local-only core comes first.

- [ ] Chrome Web Store listing (needs a store developer account and review).
- [ ] Firefox add-on packaging.
- [ ] Price history and drop alerts for saved items (opt-in, checked locally).
- [ ] Hosted/synced version with accounts: same extension, lists that follow you across browsers and devices, optional list sharing. The storage layer is already isolated for this (see above).
- [ ] Share a list as a read-only page.
- [ ] Safari packaging.
- [ ] Bulk actions on the dashboard (move several items to a list, delete several).

## Contributing

Forks and pull requests are welcome. Keep it dependency-free and local-first: no build step, no network calls from the extension itself, no new permissions without a clear reason in the README table above. Small, focused changes beat big rewrites.

## License

MIT. See [LICENSE](LICENSE).
