# ArkRachnid

Search every Arknights story script for a character and read the full scene, with each hit highlighted.

A search for a name finds three kinds of hits:

- **Speaker**: lines the character says.
- **Mention**: the name shows up inside dialogue, narration, captions, choices or story summaries.
- **Portrait**: the character's sprite is on screen. Some unnamed NPC sprites get a name by inference, and those are marked with `*`.

## Requirements

- [Node.js](https://nodejs.org/) 18 or newer. No `npm install` is needed because there are no dependencies.
- A copy of the Arknights game data (see [Game data](#game-data)). It is not included in this repo.
- A modern browser (Chrome, Edge, Firefox or Safari).

## Quick start

From the project root:

```sh
# 1. Put the game data in ArknightsGamedata/ (see "Game data" below)

# 2. Build the search index  ->  data/meta.json, data/lines.json
node tools/build-index.mjs

# 3. Start the local server
node tools/serve.mjs
```

Then open <http://localhost:5173/>.

## Game data

The game data is not shipped with this project. Put it in an `ArknightsGamedata/` folder at the project root, one subfolder per language:

```
ArknightsGamedata/
  en/
    gamedata/
      excel/
        story_review_table.json   (required)
        character_table.json      (required)
        activity_table.json       (optional, gives better event names)
      story/
        ...story .txt scripts...
        [uc]info/                 (story summaries)
```

Only the `excel/` tables listed above and the `story/` folder are read.

## Project layout

```
ArknightsGamedata/   Game data (provided separately, not in the repo)
tools/
  build-index.mjs    Parses story scripts into data/*.json
  serve.mjs          Static server for web/ and data/
data/                Generated index (rebuild any time)
web/index.html       The whole app: one page, no build step
```

## Updating to a new game patch

1. Replace the contents of `ArknightsGamedata/<lang>/` with the newer data.
2. Run `node tools/build-index.mjs`.
3. Reload the browser tab. The server does not need a restart.

## Commands

### `node tools/build-index.mjs [--lang <code>]`

Reads `ArknightsGamedata/<lang>/gamedata/` and writes:

| File | Contents |
|---|---|
| `data/meta.json` (~1 MB) | Story groups, story list, portraits, speaker counts |
| `data/lines.json` (~37 MB) | Every parsed line of every story |

`--lang` defaults to `en` and must match a folder name under `ArknightsGamedata/`, for example `--lang jp`. Only one language is indexed at a time, and each build overwrites `data/`.

The build prints a summary of files scanned, stories, rows, speakers and portraits.

### `node tools/serve.mjs [port]`

Serves the app at `http://localhost:<port>/`. The default port is `5173`, and you can also set it with the `PORT` environment variable. The server listens on `127.0.0.1` only and gzips responses (`lines.json` drops to a few MB over the wire).

Opening `web/index.html` directly as a file does not work, because the page has to fetch `data/` over HTTP.

## Using the app

### Searching

- Type a character name into the search box. Suggestions come from known speaker and portrait names. Use ↑/↓ and Enter to pick one.
- **Aliases**: separate spellings with commas to search them together, for example `Kal'tsit, Kaltsit`.
- **Speaker / Mention / Portrait** chips switch each hit type on or off. At least one always stays on.
- **Category** chips (Main, Events, Mini events, Records, Other) filter by story type. The numbers show how many stories match in each category. Shift-click or Ctrl-click a chip to show only that category.
- **Whole word** (on by default) stops `Amiya` from matching `Amiyas`. Turn it off for partial matches.
- **Match case** makes the search case-sensitive.
- **Sort** shows results either in story order (grouped by chapter or event) or by most hits.

### Results

- Click a group header to collapse or expand it.
- Click a story to open it in the reader and list its hits underneath. Badges show the counts: blue for spoken, orange for mentions, purple for on-screen lines.
- Click any hit line to jump straight to it in the reader.

### Reader

- Shows the full script. Hit rows are highlighted, and a small "on screen:" line marks each change in the sprites shown. The matched character's sprite is in purple.
- **↑ hit / ↓ hit**: previous or next hit. These wrap around.
- **⟨ story / story ⟩**: previous or next story in the results.
- **Copy path** copies the source file path (`ArknightsGamedata/<lang>/gamedata/story/...`).
- On narrow screens (900px or less) the reader opens full-screen. Use **← Back** or Esc to close it.

### Keyboard shortcuts

| Key | Action |
|---|---|
| `/` | Focus the search box |
| `n` / `p` | Next / previous hit in the reader |
| `Esc` | Close suggestions or the mobile reader |

### Shareable links

The URL hash keeps the query, filters and open story, for example:

```
http://localhost:5173/#q=Amiya&t=sm&cat=main
```

| Param | Meaning |
|---|---|
| `q` | Query (comma-separated aliases) |
| `t` | Hit types: any of `s`, `m`, `p` (default `smp`) |
| `cat` | Categories: `main,event,mini,record,other` |
| `w=0` | Whole word off |
| `c=1` | Match case on |
| `s` | Path of the open story |

The theme toggle (moon icon) is saved in the browser.

## Troubleshooting

| Problem | Fix |
|---|---|
| "Couldn't load the index" / 404 on `data/` | Run `node tools/build-index.mjs`. |
| `ENOENT ... story_review_table.json` during build | The game data is missing, in the wrong place, or `--lang` is wrong. Check that `ArknightsGamedata/<lang>/gamedata/excel/` exists. |
| Port 5173 in use | Run `node tools/serve.mjs 8080`. |
| A name finds nothing | Turn off **Whole word**, try another spelling as an alias, or check that all categories are enabled. The "Similar names" links can help. |
| A portrait shows the wrong name | Names inferred for NPC sprites (marked `*`) are guesses based on who usually speaks while that sprite is focused. |
