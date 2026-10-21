# Grammar Module

The committed `token-vocabulary.generated.ts` records numeric token ids and provenance from the
installed Craftland Studio extension. Regenerate it with `npm run grammar:generate`; verify it
against the installed extension with `npm run verify:grammar`. Do not edit it by hand.

`lexical.ts` contains the authored spelling and token-category rules. Parser productions remain
in `src/parser/`; this directory does not contain a second handwritten `.g4` grammar.
