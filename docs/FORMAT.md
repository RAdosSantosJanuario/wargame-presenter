# Wargame data format

Everything is plain JSON. A wargame lives in `data/wargames/<id>.json`, its images in
`data/media/<id>/`. Every human-readable text is bilingual: `{"en": "...", "de": "..."}`.
If one language is empty, the other one is shown as fallback.

## Wargame

```json
{
  "schema": 1,
  "id": "a1b2c3d4e5",
  "meta": {
    "title":       {"en": "Operation Nightfall", "de": "Operation Nightfall"},
    "subtitle":    {"en": "...", "de": "..."},
    "description": {"en": "...", "de": "..."},
    "author": "Blue Team Academy",
    "created": "2026-11-03T10:00:00Z",
    "updated": "2026-11-03T10:00:00Z"
  },
  "settings": {
    "theme": "dark",            // "dark" (ops room) or "light" (briefing paper)
    "accent": "#ffb000",        // accent colour used on slides
    "language": "de",           // default presentation language
    "hud": true,                // show the attribute bar during the presentation
    "banner": {"en": "EXERCISE · EXERCISE · EXERCISE", "de": "ÜBUNG · ÜBUNG · ÜBUNG"}  // marking strip, empty = none
  },
  "attributes": [ /* Attribute */ ],
  "pages": [ /* Page */ ]
}
```

## Attribute

Attributes are the values that decisions change (resources, difficulty, success chance, ...).

```json
{
  "id": "containment",          // [a-z0-9_-], unique, referenced by effects
  "icon": "🛡️",                 // emoji, optional
  "name":        {"en": "Containment", "de": "Eindämmung"},
  "description": {"en": "How well the attacker is under control", "de": "..."},
  "unit": "%",                  // free text: "%", "k€", "h", ""
  "min": 0, "max": 100, "start": 10,
  "better": "higher",           // "higher" | "lower" | "neutral" – used for green/red change arrows
  "hidden": false,              // hidden from the audience during play, revealed in the debrief
  "levels": [                   // classification, sorted by upTo ascending, last upTo == max
    {"upTo": 25,  "severity": "critical", "label": {"en": "Out of control", "de": "Außer Kontrolle"}},
    {"upTo": 50,  "severity": "bad",      "label": {"en": "Spreading",      "de": "Breitet sich aus"}},
    {"upTo": 75,  "severity": "warning",  "label": {"en": "Partly contained","de": "Teilweise eingedämmt"}},
    {"upTo": 100, "severity": "good",     "label": {"en": "Contained",      "de": "Eingedämmt"}}
  ]
}
```

A value `v` belongs to the first level with `v <= upTo` (the first level starts at `min`).
Severities: `critical`, `bad`, `warning`, `ok`, `good`, `info` (neutral).

## Page

```json
{
  "id": "p-intro",
  "type": "content",            // "content" or "decision"
  "title": {"en": "...", "de": "..."},
  "showTitle": true,            // draws the title band at the top (0–13 % of the height)
  "notes": {"en": "...", "de": "..."},   // facilitator notes (presenter console only)
  "background": {"color": "", "image": "", "dim": 0.5},   // optional
  "timer": 0,                   // countdown in seconds (0 = none), started by the facilitator
  "condition": null,            // see below – page is skipped when the condition is false
  "elements": [ /* Element */ ],
  "decision": { /* Decision – only for type "decision" */ }
}
```

### Condition

```json
{"mode": "all", "rules": [
  {"type": "attr",   "attr": "reputation", "op": "<", "value": 40},
  {"type": "choice", "choice": "c-pay-ransom", "op": "chosen"}
]}
```

`mode`: `all` | `any`. Attribute ops: `<`, `<=`, `>`, `>=`, `==`, `!=`.
Choice ops: `chosen`, `notChosen` (refers to a choice id anywhere in the wargame).

## Element

Elements are placed freely on a 16:9 stage. `x`, `y`, `w`, `h` are percentages of the stage
width / height (origin top-left). `reveal` = 0 shows the element immediately; 1, 2, 3, ...
reveals it with the 1st, 2nd, 3rd "next" press (like slide animations).

Text sizes scale with the stage: `s` ≈ 1.5 %, `m` ≈ 2 %, `l` ≈ 2.8 %, `xl` ≈ 4 %, `xxl` ≈ 6 % of
the stage width.

| kind      | fields |
|-----------|--------|
| `text`    | `text` (markdown-lite), `style: {size: s/m/l/xl/xxl, align: left/center/right, valign: top/middle/bottom, font: sans/display/mono, box: none/card/accent/warning/critical, color: ""}` |
| `image`   | `src` (file name in the media folder, or a URL), `fit: contain/cover`, `caption`, `frame: true/false` |
| `inject`  | `channel: email/phone/chat/sms/news/social/alert/memo`, `severity: info/warning/critical`, `time`, `from`, `to`, `subject`, `body` (markdown-lite) |
| `chart`   | `chart: bars/gauges/radar/timeline/deltas/cards/log`, `attrs: []` (empty = all), `includeHidden: false` |
| `choices` | renders the decision of the page (decision pages only) |

Markdown-lite: `**bold**`, `*italic*`, `` `code` ``, `==highlight==`, `# Heading`, `## Subheading`,
lines starting with `- ` (bullets) or `1. ` (numbered).

## Decision

```json
{
  "prompt": {"en": "How do you respond?", "de": "Wie reagieren Sie?"},
  "mode": "single",             // "single" | "multiple"
  "min": 1, "max": 2,           // used by "multiple"; max 0 = unlimited
  "showEffects": "after",       // "never" | "after" (after confirming) | "always" (visible on the cards)
  "choices": [
    {
      "id": "c-isolate",        // unique in the whole wargame
      "icon": "🔌",
      "label":       {"en": "Isolate the network", "de": "Netzwerk isolieren"},
      "description": {"en": "...", "de": "..."},
      "effects": {"containment": 25, "operations": -20},   // attribute id -> delta
      "outcome":     {"en": "...", "de": "..."},            // shown after confirming
      "chance": 100,            // success probability in %, 100 = no dice roll
      "goto": "",               // jump to this page id afterwards ("" = next page)
      "fail": {                 // only used when chance < 100 and the roll fails
        "effects": {"containment": 5},
        "outcome": {"en": "...", "de": "..."},
        "goto": ""
      }
    }
  ]
}
```

Values are always clamped to `min`/`max` of the attribute.

## Export file

An export is the wargame object plus embedded images, so a single `.json` file carries everything:

```json
{
  "format": "wargame-export",
  "version": 1,
  "exportedAt": "2026-11-03T10:00:00Z",
  "wargame": { /* Wargame */ },
  "media": {"ransom-note.svg": "data:image/svg+xml;base64,..."}
}
```

## Session (run)

Each presentation creates a session in `data/runs/<runId>.json` with the decisions taken, attribute
values over time and a copy of the wargame, so the debrief still works if the wargame is edited later.
