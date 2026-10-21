# Collection alignment and logical continuations

## Design review

The v4 precedent is `alignCompositeSeparators` (enabled by default) and one
additional indent level on broken logical headers. V5 already owns group
fitting in `render.mjs`, syntax roles in the parser, layout in the printer and
public settings in the option registry. CLI and editor share the service.

Preserving source padding is viable, but gives different results for equivalent
inputs and cannot align newly authored rows. Computing padding from formatted
keys gives a canonical result. Padding therefore belongs to the collection
printer and appears only in broken groups. Flat groups retain normal spacing.
Homogeneous map/struct entries align `:`/`=`; lists have no alignment target.
Comments and multiline literals retain the existing protected-group policy.

For continuations, aligning to the first operand's character column is viable
but produces deep indentation for long declaration heads. Indenting by levels
is simpler with spaces or tabs. `indent.continuation` defaults to 1 and accepts
0–4 levels; it applies to logical tails in conditions and value expressions.
Nested parenthesized expressions form independent groups. `wrap.conditions`
controls logical chains in headers, assignments, returns and group items;
`wrap.calls` continues to control argument lists only.

`alignment.collections` defaults to true and can be disabled in config,
overrides or CLI flags. Adjacent standalone assignments are not aligned.
The registry owns validation, generated schema/types/docs and precedence.
The printer adapts the public indent setting to `continuationIndent`.

Each eligible key is printed/measured once using the renderer's display-column
calculation. Alignment takes linear work in the keys; no extra parse pass or
runtime dependency is introduced. Immutable indentation Docs carry a level
count. Reparse and token identity continue to guard punctuation and spelling.

## Expected layout

```fc
var colors = Map<int, Color>{
  Rarity.Common   : #B0BEC5,
  Rarity.Uncommon : #81C784,
  Rarity.Legendary: #FFD54F,
}

if first ||
  second ||
  third {}

var valid bool = first &&
  (second ||
    third)
```

The examples show broken groups. In `auto`, a chain that fits stays flat.
`always` breaks after each direct logical operator; `never` keeps its logical
boundaries flat. Existing hard breaks still win in `lineBreaks: "preserve"`.
The opening parenthesis stays beside its first operand and the closing one
beside its last, respecting FC's virtual statement-ending rules.

This document records the 0.7.0 design. See
[continuation design](CONTINUATION_DESIGN.md) for the 0.9.0 parameter default,
comment-section boundaries and arithmetic/bitwise expression layout.
