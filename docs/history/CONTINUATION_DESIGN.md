# Parameter preservation and expression continuations

## Design review

The user selected preservation of authored func/event parameter line breaks as
the default. Existing contracts are `wrap.parameters`, `printWidth`,
`indent.continuation` and `blankLines.maxConsecutive`. The registry owns their
validation and generated artifacts; the syntax printer owns source boundaries
and expression layout. The CLI and editor continue to share the service.

Two viable signature layouts are canonical wrapping at width, and preserving
the authored break positions while normalizing spacing/indentation. Preservation
is the default; `auto`, `always` and `never` remain explicit alternatives. This
policy also applies to function types and anonymous function signatures. It does
not enable preservation for calls or the whole document. A commented signature
or multiline literal still follows the existing byte-protection policy.

For long expressions, freezing all nested calls is viable but leaves even
breakable concatenations oversized. Offering breaks at binary operators lets
enclosing expressions wrap before a small nested call runs out of room. Logical
boundaries keep `wrap.conditions`; arithmetic/bitwise chains fit automatically.
The lowest binding direct operators form a group; their operands fit separately
at higher precedence. Prefix signs, comparisons, shifts and casts are not new
break opportunities. Tokens and evaluation order remain unchanged.

Each chain tail uses `indent.continuation`, consistent with existing logical
tails. Call-list policy still controls argument boundaries; `never` keeps auto
child layouts flat, while explicit logical `always` can still force breaks.
`lineBreaks: preserve` and source ignores retain their existing protection rules.
No additional binary-expression setting or renderer abstraction is introduced.

Commented collections must remember source spans after a comma or trailing
comment, before each leading/footer comment and before each value. Removing all
gaps is viable for canonical rows, but discards intentional sections. Preserving
gaps up to `blankLines.maxConsecutive` keeps those sections and uses the existing
blank-line contract. Mandatory row/comment breaks remain even when the cap is 0.
Padding is still computed over the entire collection's keys.

Boundary tracking is linear in collection parts. Expression grouping visits
each part at a bounded number of precedence levels, with no extra parse pass or
runtime dependency. Reparse/token identity, exact output, oracle acceptance,
idempotence, compiler fixtures and CLI/editor parity check separate properties.
