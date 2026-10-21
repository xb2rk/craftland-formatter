# FC Grammar Specification

> Functional Consistency (FC) language - the scripting/type language for Craftland Studio
> `.fcg` (graph) and `.fcc` (contract/header) source files.

This document is the **single source of truth** for the FC grammar as consumed by the
`fc-format` formatter. A parser, a formatter, and (later) a linter are intended to be derived
directly from this document. It is written to be *complete*: every lexical unit, every parse
rule, every precedence and associativity decision, and every syntactic ambiguity the
implementation must resolve is stated here so that no edge case needs to be rediscovered by
trial and error during implementation.

---

## 0. Scope and purpose

1. **Formatter authority.** This grammar defines *what is syntactically valid* FC and *how it is
   structured*. The layout rules in §12 are derived from this grammar and define how valid FC is
   rendered.
2. **No `.g4` is available.** The language server ships only the **compiled** ANTLR lexer/parser
   bundle; the human-readable reference is `fc-syntax.md`. This document reconciles both into a
   single, implementation-ready form.
3. **Linter out of scope.** Structural naming/convention checks (a separate concern) are not part
   of this grammar.
4. **Completeness requirement.** A construct mentioned by any source (compiled bundle, reference
   doc, or real corpus) must appear here. Any construct *not* listed here is presumed invalid and
   must be re-checked against the compiler before being accepted.

---

## 1. Provenance & verification

Every rule below is traceable to one or more authoritative artifacts. Where sources disagree, the
compiled ANTLR bundle wins; the discrepancy and its evidence are recorded inline.

### 1.1 Authoritative artifacts

| ID | Artifact | Role | How it is used here |
|---|---|---|---|
| A1 | `%VSCEXT%/dist/server_syntax.js` | Compiled ANTLR `FCGLexer`/`FCGParser` (the shipped parser) | Token IDs, vocabulary, and the full rule list (§2.3, §13) |
| A2 | `.craftland/agents/references/fc-syntax.md` | Human-readable grammar reference | Statement forms, types, literals, precedence |
| A3 | `%VSCEXT%/language-configuration.json` | Editor comment/bracket/indent config | Confirms `//`, `/* */`, brackets `{}` `[]` `()`, indent rules |
| A4 | `Assets/Scripts/**/*.{fcg,fcc}` (repo corpus, 164 files) | Real, compiler-accepted source | Verified examples cross-referenced inline |
| A5 | Existing formatter test suite (fixtures + 118 unit tests) | Accepted behavioral spec | Concordance appendix §14; must remain green |

`%VSCEXT%` resolves to `C:\Users\N0BODY\.vscode\extensions\craftlandstudio.ffugclanguage-1.10.1`.

### 1.2 Compiled-rule vocabulary (from `FCGParser.ruleNames`, A1)

The shipped parser exposes exactly these rule names. They are the canonical production names used
in §3–§10. (Verified: no `switchStmt`/`caseStmt` statement rule exists - the lexer has a
`SWITCH`/`CASE` token but the parser has no statement rule using them.)

```
sourceFile  headerFile  headerDecl
defineType  defineTypeHeader  defineFuncPointType
decoratorForTypeDecl  decoratorCustomDecl  decoratorAcceptDecl  decoratorElementDecl
decoratorForAliasDecl  defineAlias  defineAliasHeader  aliasStmt
decoratorForEnumDecl  defineEnum  defineEnumHeader  enumBlock  decoratorForEnumElementDecl
enumStmtDecl  enumStmt
defineTuple  tupleBlock
decoratorForComponentDecl  decoratorBridgingDecl  decoratorCombineDecl
defineComponent  defineComponentHeader  componentDecl  componentFieldDecl  componentBlockDecl
decoratorForFuncDecl  defineFunc  funcHeaderDecl  anonFuncHeaderDecl
decoratorForEventDecl  defineEvent  eventHeaderDecl
defineGraph  decoratorForGraph  declareGraph  declareGraphBlock
declareGraphDefProp  declareGraphDefFunc
graphFile  importDecl  importFile  importPartFile  graphDecl  graphBlock  graphElementList
decoratorForFieldDecl  decoratorReadOnlyDecl  propertyDecl  fieldDecl  identLiteralValue
anonFuncDecl  funcDecl  eventDecl  eventListenHeaderDecl
signature  result  parametersWithOut  parameterWithOutDecl  outVar  parameters  parameterDecl
codeBlock  statementList  statement
returnStmt  breakStmt  continueStmt  expressionStmt
ifStmt  ifBranchStmt  elseBranchStmt  elseIfBranchStmt
forExpression  forExpressionStmt  forStmt  forClause  rangeClause
whileStmt
localVarDecl  varSelfModify  varModify  funcPointModify  funcCallStatement
expressionBitShiftOp  expression  primaryExpr  index  outVarArgExpr  operand
typeofExpr
literalList  colorV  vectorV  listV  listT  tupleV  tupleLiteralType
tupleNamedFieldList  tupleNamedField  mapV  mapLiteralList  mapLiteralListItem  mapT
entityT  locStrV  domainType  type_  typeReservedWord  typeNotReservedWord
general_identifier_token  qualifiedIdent  basicLit  nil_  boolV  integer  float_  string_  eos
```

### 1.3 Verified grammar findings (reconciled)

| # | Topic | Decision | Evidence |
|---|---|---|---|
| V1 | Import alias is a single, non-dotted token | `qualifiedIdent` = one identifier-like token; alias is **never** dotted (`EditorGenLib.Res` is illegal as alias) | A1 `qualifiedIdent`, `general_identifier_token` |
| V2 | Backtick `` `…` `` is a raw-string literal | Token `RAW_STRING_LIT`; `string_` accepts raw or interpreted | A1 `FCGLexer.RAW_STRING_LIT`; `string_` |
| V3 | Library import alias is **required** | `import "X.fcc" as Alias` (`importFile`) | A1 `importFile` |
| V4 | Script import alias is **optional** | `import Name [as Alias] from "path"` (`importPartFile`) | A1 `importPartFile` |
| V5 | `wait` / `start` are prefix expression statements | Both wrap a `funcCallStatement`; `_func_call_type` ∈ {`START`,`WAIT`} | A1 `expression`, `funcCallStatement` |
| V6 | No `switch`/`case` statement | parser `ruleNames` has none | A1 `FCGParser.ruleNames` |
| V7 | Lexer/NLSEMI splits `<<`/`>>` into two `<`/`>` tokens | `<<`/`>>` do **not** appear in `_LITERAL_NAMES` as single ops; `<<=`/`>>=` do | A1 `FCGLexer._LITERAL_NAMES` |
| V8 | `TERMINATOR`/`EOS` tokens exist for statement separation | Statement termination is modeled lexically (auto-semicolon), not by a visible `;` | A1 `FCGLexer.ruleNames` (`TERMINATOR`, `EOS`, `NLSEMI`) |
---

## 2. Lexical grammar

### 2.1 Whitespace

Whitespace separates tokens and is otherwise insignificant. The lexer treats U+0020 space,
U+0009 tab, U+000D CR, U+000A LF, U+00A0 NBSP, and U+000C form-feed as whitespace. Newlines are
significant only for **statement termination** (§2.7) and are preserved as trivia for the
formatter (comments and blank-line layout).

### 2.2 Comments

- **Line comment:** `// …` - runs to end of line. Never rendered across lines.
- **Block comment:** `/* … */` - may span lines; content and internal whitespace are preserved
  verbatim (never normalized). Doc comments use `/** … */` (JSDoc style).

Editor config confirms `//` line and `/* */` block pairs (A3).

### 2.3 Token categories (full vocabulary)

The complete token set is `FCGLexer._SYMBOLIC_NAMES` / `_LITERAL_NAMES` (A1). Categories:

- **Keywords** - reserved words (§2.4) mapped to a fixed token id.
- **Operators** - one or more characters with a fixed token id (§2.5). Match **longest-first**.
- **Punctuators** - single-character structural tokens (§2.6).
- **Literals** - numbers, color, strings, raw strings, runes, bool, nil (§2.8–§2.13).
- **Identifiers** - user names (§2.7).
- **Trivia** - whitespace and comment tokens, plus `TERMINATOR`/`EOS`.
- **Other** - `OTHER` fallback for an unrecognized character.

### 2.4 Keywords

Derived from `FCGLexer._LITERAL_NAMES`, indices 1–59. Every token text is canonical:

```
define  alias  enum  tuple  abstract  component  struct  export  partial  readonly
accept  bridging  combine  declare  element  import  from  static  graph  bind
event  func  start  wait  async  if  else  for  in  while  break  continue  return
switch  case  var  as  thisEntity  globalEntity  out  typeof
object  Type  bool  int  int64  float  string  Color  Vector2  Vector3  Quaternion
List  Map  LocString  entity  true  false  nil
```

Notes:
- The type grammar deliberately distinguishes `typeReservedWord` from
  `general_identifier_token` (§9). `object`, `bool`, `int`, `int64`, `float`, `string`,
  `Vector2`, `Vector3`, `Quaternion`, `LocString`, `struct`, and `export` are reserved type
  forms. `Type` and `Color` are keyword tokens accepted by the non-reserved identifier path.
  `List`, `Map`, and `entity` have their dedicated generic type forms. Their spelling is fixed
  (e.g. `Type` capital T, `LocString`, `Quaternion`).
- `switch` and `case` are lexed but have **no** statement grammar (V6); they must still
  tokenize correctly so a file containing them is not mis-tokenized.

### 2.5 Operators (longest-first match)

From `FCGLexer._LITERAL_NAMES`/operator table. Multi-char operators:

```
<<=  >>=  ++  --  :=  ||  &&  ==  !=  <=  >=  +=  -=  *=  /=  %=  &=  ^=  |=
```

Single-character operators:

```
=  <  >  |  /  %  &  ^  !  ~  +  -  *
```

**Critical lexical facts:**
- `<<` and `>>` are **not** single tokens (V7). The lexer emits two `<`/`>` tokens; the parser
  reassociates adjacent `<`/`>` as a shift in expression positions. `>>=` and `<<=` **are**
  single tokens.
- Multi-char operators are matched longest-first, so `>=` beats `>` + `=`, `:=` beats `:` + `=`,
  `++` beats `+` + `+`, etc.
- `>>=`/`<<=` are matched before a bare `>`/`<`.

### 2.6 Punctuators

```
(  )  {  }  [  ]  ,  ;  :  .  #
```

### 2.7 Identifiers & statement termination

An identifier starts with a Unicode letter or `_` and continues with letters, digits, or `_`.
Reserved keyword spellings (§2.4) are not identifiers. `qualifiedIdent` is exactly **one**
identifier-like token and may be a keyword-type name (`entity`, `List`, …) in type positions or a
plain identifier in name positions - but never a dotted sequence (V1).

**Statement termination:** the language uses automatic semicolon insertion via the lexer's
`NLSEMI` mode (V8). This is a lexer state machine, not a parser nesting heuristic: after an
EOS-capable token (identifier, literal, `)`, `]`, `}`, `++`, `--`, `break`, `continue`, `return`,
or a type/value keyword), a line terminator produces `EOS`. A line/block comment preserves that
state; a multiline block comment can itself be the `EOS` token. This can occur inside `()` or
`[]`; individual parser productions decide whether a boundary is legal there. An explicit `;` is
also a valid separator (the extension may lex it as `EOS` when already in `NLSEMI` mode). Parser
`eos` additionally accepts EOF and a closing-bracket predicate; neither is a virtual EOS token.
The formatter's lexer preserves raw trivia and does not emit EOS. Its parser derives equivalent
boundary facts through the audited `statement-boundary` module.

### 2.8 Integer literals

- **Decimal:** `[0-9](_?[0-9])*` - underscores allowed between digits.
- **Binary:** `0b`/`0B` + `[01](_?[01])*`.
- **Octal:** `0o`/`0O` + `[0-7](_?[0-7])*`.
- **Hex:** `0x`/`0X` + `[0-9a-fA-F](_?[0-9a-fA-F])*`.

Values are spelling-preserving; the formatter never rewrites a numeric literal.

### 2.9 Float literals

- Decimal digits with an optional `.` fraction and/or exponent (`e`/`E` with optional sign).
- Hex floats allow a `.` fraction and a `p`/`P` exponent.
- Fractions/exponents may contain underscores between digits.

### 2.10 Imaginary literals

A decimal or float literal suffixed with `i` (e.g. `3i`, `1.5i`).

### 2.11 Color hex literal

`#` followed by hex digits (`#RRGGBB`, optionally `#RRGGBBAA`). Tokenized as a single atom; never
split or spaced internally.

### 2.12 String literals

Three forms, each atomic (never split or reformatted internally):

- **Interpreted string:** `"…"` - double-quoted, supports escape sequences. `string_` accepts it.
- **Raw string:** `` `…` `` (backtick) - `RAW_STRING_LIT`, may span lines; interior preserved
  byte-for-byte (V2).
- **Rune literal:** `'…'` - single-quoted character/rune value.

### 2.13 Boolean & nil

`true`, `false`, `nil` are literal keywords (`boolV`/`nil_`), atomic.

---

## 3. File forms

FC has two top-level file forms.

### 3.1 `graphFile` / `sourceFile`

The body of a `.fcg` graph file:

```
imports?  [graphDecl]
```

where `graphDecl` is:

```
[decoratorForGraph]  [static]  graph  qualifiedIdent  {  graphElementList  }
```

- The graph name is a `qualifiedIdent` (single token, not dotted).
- `static graph` is allowed (verified: `static graph BigNumberLibrary {`).
- Decorators precede `graph` (e.g. `[platform_client]`).
- `graphElementList` is detailed in §5.

### 3.2 `headerFile`

The body of a `.fcc` contract/header file:

```
imports?  headerDecl*
```

where each `headerDecl` is one of: `defineType`, `defineAlias`, `defineEnum`, `defineTuple`,
`defineComponent`, `defineFunc` (signature only), `defineEvent` (signature only), `defineGraph`
(declaration-only `declare graph`), each optionally preceeded by its decorator.

### 3.3 Imports (`importDecl`)

Two forms (V3/V4):

- **Library import (`importFile`):**
  ```
  import  string_  as  qualifiedIdent
  ```
  The alias is **required** (`import "List.fcc" as List`). Never render `import "X.fcc"` alone.

- **Named `from` import (`importPartFile`):**
  ```
  import  IDENTIFIER  [ as  qualifiedIdent ]  from  string_
  ```
  The imported name is one plain `IDENTIFIER`; the alias is optional
  (`import Foo as Bar from "./Foo.fcg"` or `import Foo from "./Foo.fcg"`).

- The alias is always a single non-dotted token (V1). Never emit a dotted alias.
- Reserved libraries keep their filename stem as the canonical alias (`StdLibrary`,
  `EditorGenLib`).
- Import ordering/layout is a separate formatting concern (§12.8).

---

## 4. Declarations & decorators

### 4.1 Decorators (`[ … ]`)

Decorators attach to the declaration they precede and carry one optional element:

| Rule | Form | Meaning |
|---|---|---|
| `decoratorCustomDecl` | `[platform_client]`, `[platform_server]`, `[readonly]`, any `[identifier]` | Arbitrary/legacy marker; clings to the declaration |
| `decoratorAcceptDecl` | `[accept entity<Player>]` | Accept clause |
| `decoratorElementDecl` | `[element int]` | Element kind |
| `decoratorBridgingDecl` | `[bridging]` | Bridging component |
| `decoratorCombineDecl` | `[combine Transform, Player]` | Combine type list |
| `decoratorReadOnlyDecl` | `[readonly]` | Read-only field/type |
| `decoratorFor…Decl` | per-target (type/alias/enum/component/func/event/graph/field) | Scoping wrapper around the above |

Verbatim, real examples:
- `[accept entity<Player>] define PlayerEntity: entity<Player>` (A4)
- `[element int] enum ScoreType { … }` (A4)
- `[bridging] component BridgeComponent { … }` (A4)
- `[combine Transform, Player] component PlayerView { … }` (A4)
- `[platform_client] graph Client_SeedGrowVFXEntity { … }` (A4)

Convention rules (grammar-derived constraints):
- Platform decorators live on a **graph** (`.fcg`) or a **contract event** (`.fcc`),
  **never** on a graph-body event listener handler (A4/fc-syntax).
- A decorator is a bracket group; its internal content is comma-separated tokens/arguments.

### 4.2 `define` / type (`defineType`, `defineTypeHeader`)

```
define  qualifiedIdent  :  type_
define  qualifiedIdent  =  qualifiedIdent      # alias to a type/function type
```

- `defineTypeHeader` is the header `define Name:` - the header may declare a **function-point
  type**: `define Callback: func(player entity<Player>)`.
- Real: `define MyType: int` (A2).

### 4.3 `alias` (`defineAlias`)

```
alias  qualifiedIdent  =  type_
```

- Real: `alias NumberLike = int | float`, `alias EntityAndTransform = entity<Player> & Transform` (A2).

### 4.4 `enum` (`defineEnum`, `enumBlock`)

```
[decoratorForEnumDecl]  enum  qualifiedIdent  {  enumStmtDecl*  }
```

- An `enumStmtDecl` element: `identifier  [ =  expression ]` - explicit value allowed
  (e.g. `SUCCESS = 0`), including negative values (`UnknownError = -1`) and trailing line comments (A4).
- `decoratorForEnumElementDecl` may decorate an element.

### 4.5 `tuple` (`defineTuple`, `tupleBlock`)

```
[decoratorForComponentDecl]  tuple  qualifiedIdent  {  componentFieldDecl*  }
```

- A tuple field is `name  type_` (no `var`) with an **optional default initializer**:
  `name  type_  [ =  value ]`.
- Real (A4/CustomTuple.fcc):
  - `tuple BigNumber { blocks List<int> = List<int>{0}  decimalPos int = 0  isNegative bool = false }`
  - `tuple PlayerProfileData { AppliedResetEpoch int = 0  NextInstanceId int = 1 }`
- A default may be `nil` (`StockList List<int> = nil`), a literal, or a composite
  (`List<int>{0}`).
- Reference example `tuple SpawnInfo { position Vector3  yaw float }` (A2) is the no-default form.

### 4.6 `component` (`defineComponent`, `componentBlockDecl`)

```
[decoratorForComponentDecl]  component  qualifiedIdent  {  componentDecl*  }
```

- Fields use the same body form as tuple/graph fields: `name  type_  [ =  value ]`.
- Components may hold nested declarations (`componentBlockDecl`) and field decorators
  (`[readonly]`).
- Real (A4/`AI.fcc`): `component Monster { HP int  HPMax int  [readonly] HostTeam entity<Team> … }`.
- Field defaults are permitted identically to tuple/graph fields.

### 4.7 `func` (`defineFunc`, `funcDecl`, `anonFuncDecl`)

Declaration signature (`headerFile`) or definition (in a graph body):

```
[decoratorForFuncDecl]
[async]  func  qualifiedIdent  signature  [ result ]  [ codeBlock ]
```

- `async func Name(…) { … }` - `async` immediately precedes `func` with no space.
- Parameters per §6; the return type (`result`) comes **after** the parameter list.
- **Async (`async func`) rules:**
  - An async function **must not** declare a `result` (return type) - it communicates results via
    `out var` parameters instead.
  - Results are **always** passed as `out var <name>`; writing a bare `out <name>` even when the
    variable already exists is **required to be `out var`** (FC mandates `out var` at call sites).
  - Real (A4): `async func ReadIntWithRetry(sheet string, key string, out var value int, out var statusCode StatusCode) {`.
- `anonFuncDecl`: `func` parameters `result?` `codeBlock` used where a callable value is expected
  (e.g. `var callback = func(player entity<Player>) { … }`).
- Real: `func ClampScore(score int) int`, `async func PlaySequence()` (A4).

### 4.8 `event` (`defineEvent`, `eventDecl`, `eventListenHeaderDecl`)

Two contexts:

- **Contract event declaration** (`.fcc` header): `[decoratorForEventDecl] event Nice(params)`.
- **Event listener** (in a graph body): `event Host.EventName(params) { statementList }`.
- Event-listener names are multi-segment qualified names (`A.B.C(params)`), parsed by the
  shared `parseQualifiedName` helper; the qualified-name matrix test pins the full triage.
- Platform decorators on a contract event are valid (`[platform_client] [platform_server]
  event Request_X { … }`).

### 4.9 `graph` (`defineGraph`, `declareGraph`)

- **Definition** (`.fcg`): `[decoratorForGraph] [static] graph Name { graphElementList }` (§5).
- **Declaration only** (`.fcc`): `declare graph Name { declareGraphBlock }` where the block holds
  `declareGraphDefProp` (property signatures) and `declareGraphDefFunc` (function signatures).
---

## 5. Graph body (`graphElementList`)

A graph block is a sequence of elements:

```
( propertyDecl | fieldDecl | decoratorForFieldDecl+ (propertyDecl|fieldDecl)
 | funcDecl | eventDecl | identLiteralValue )*
```

- **Property/field (`propertyDecl` / `fieldDecl`):**
  ```
  [decoratorForFieldDecl]  name  [ : type_ ]  [ =  identLiteralValue | expression ]
  ```
  Graph fields use **header declaration syntax** (no `var`): `_GACHA_POOL_KEY string =
  "GardenGrowGacha"`. An explicit `: type_` may appear in `declare graph` property signatures.
- **`identLiteralValue`:** the right-hand side of a property initializer - a literal/composite
  value (not a general expression in all contexts).
- Real (A4):
  - `_GACHA_POOL_KEY string = "GardenGrowGacha"`
  - `_MODEL_ENTITY_LIST List<entity<Entity>> = nil`
  - `_GACHA_STEPS int = 22`
- **Function (`funcDecl`)** and **event listener (`eventDecl`)** as in §4.7/§4.8.

Convention constraints:
- A graph field is never written as `var name type` (§12/grammar): `var` is a statement keyword
  (`localVarDecl`) inside a code block, not a field form.
- Decorators never sit on a graph-body event listener or function (A4/fc-syntax; oracle-verified — the compiler rejects both, only fields may carry them).

---

## 6. Signatures & parameters

### 6.1 `signature`

```
(  [ parameters | parametersWithOut ]  )
```

### 6.2 `parameters`

```
[ parameterDecl ( , parameterDecl )* [ , ] ]
```

A `parameterDecl`:

```
[ out  var ]  name  type_
```

- Parameter syntax is `name Type` (**no** `name: Type` TS/C# form).
- `out var` parameter: `func ScreenTouchRay(tp Vector2, out var startPosition Vector3, out var direction Vector3)`
  (verified corpus `Camera.fcc`). `out` and `var` cling together as one unit `out var`.

### 6.3 `parametersWithOut` / `parameterWithOutDecl` / `outVar`

Specialized forms used by declarations whose trailing params are `out var` outputs
(e.g. `TryGetScore(out var score)`); structurally identical to `parameters` with at least one
`out var` parameter.

### 6.4 `result`

The return type, placed **after** the closing `)`:

```
func  Name ( params )  result
```

- `func ClampScore(score int) int` - `int` after the parens.
- No return type ⇒ omitted.
- **Async restriction:** an `async func` must **not** have a `result` (§4.7). Only synchronous
  `func`/`anonFunc` declarations carry a return type after `)`. Omitting the return type is
  required for async.

### 6.5 Call sites with out args (`outVarArgExpr`)

An argument may be `out var name`:

```
TryGetScore(out var score)
```

`out var` is a single grammatical unit at call sites too.

---

## 7. Statements (`statementList`, `statement`)

A code block is `{ statementList }` where each `statement` is exactly one of the following.

### 7.1 `returnStmt`
```
return  [ expression ]
```
`return` clings to the expression with one space; `return Type{…}` composite literal keeps the
composite attached.

### 7.2 `breakStmt` / `continueStmt`
```
break
continue
```

### 7.3 `expressionStmt`
A bare expression - most commonly a function call (see `funcCallStatement`). Any expression may
be a statement; calls that begin with `start`/`wait` are the `funcCallStatement` prefix form.

### 7.4 `funcCallStatement` (incl. `wait`/`start`)
```
funcCallStatement := call_expression
funcCallStatement := start  call_expression
funcCallStatement := wait   call_expression
```
- `wait`/`start` are **prefix statements** (V5): `wait WaitForMillisecond(…)`,
  `start ShowBossResultTooltip(…)`. They wrap the call as one logical unit; formatting never
  breaks between `wait`/`start` and its call.
- A bare call (no assignment) may require a trailing comma when multiline (see §12).

### 7.5 `localVarDecl`
```
var  name  [ type_ ]  [ =  expression ]
```
- `var count int`, `var name string = "abc"`, `var pos = Vector3{0, 0, 0}`.
- `var` is statement-local; it never declares graph fields.

### 7.6 Assignment / modification
```
lvalue  =   expression            # varModify
lvalue  +=|-=|*=|/=|%=|&=|^=|=|  expression
lvalue  ++
lvalue  --
varSelfModify / funcPointModify
```
- Assignment `=` and compound assignments; `++`/`--` postfix self-modification.
- `funcPointModify` covers invoking/assigning a function-point variable.

### 7.7 `ifStmt`
```
if  expression  codeBlock
[ else  ifBranchStmt ]           # else { … } or else if … { … }
```
- `elseIfBranchStmt` handles `else if cond { … }` chains; `elseBranchStmt` handles final `else`.
- Condition has **no wrapping parens** in canonical style (R12 convention): `if count > 0 { … }`.
  The compiler accepts parenthesized conditions, but the canonical form is paren-free.

### 7.8 `forStmt`
Two forms:

```
# index / clause form (forClause):
for  init = start , end , step  codeBlock        # for i = 0, count, 1 { … }

# range form (rangeClause):
for  key , value  in  expression  codeBlock      # for i, item in items { … }
```
- `forExpression`/`forExpressionStmt` cover a single-expression variant.
- Either header may be wrapped in parentheses (real code parenthesizes range
  headers, e.g. `for (key, time in items) { … }`); canonical style is
  paren-free and the header still never splits after its commas.
- The header is one unit and must **never** be split after its commas (§12.7).
- Real (A4): `for playerUID, _ in _PendingCoinRewardsByUid { … }`.

### 7.9 `whileStmt`
```
while  expression  codeBlock
```
No wrapping parens in canonical style.

---

## 8. Expressions (`expression`, `expressionBitShiftOp`, `primaryExpr`)

Expression syntax is precedence-climbing. This precedence table is the *canonical* operator
binding order and is enforced **at parse time**; the formatter never re-derives it.

### 8.1 Operator precedence & associativity (weakest → strongest)

| Level | Operator(s) | Associativity |
|---|---|---|
| 1 | `\|\|` logical OR | left |
| 2 | `&&` logical AND | left |
| 3 | `==`, `!=`, `<`, `<=`, `>`, `>=` relational/equality | left |
| 4 | `\|` bitwise OR | left |
| 5 | `^` bitwise XOR | left |
| 6 | `&` bitwise AND | left |
| 7 | `<<`, `>>` shift (from `expressionBitShiftOp`) | left |
| 8 | `+`, `-` additive | left |
| 9 | `*`, `/`, `%` multiplicative | left |
| 10 | unary prefix `!`, `~`, `-`, `+` (tightest, clings to operand) | n/a (prefix) |
| 11 | postfix `[ ]`, `( )`, `.`, `name<Type>` (tightest, clings) | n/a (postfix) |
| 12 | primary: literals, identifiers, parenthesized expr | n/a |

Notes:
- Levels 4–6 (`& ^ |`) and level 7 (shift) sit **below** relational/equality and **above**
  additive. This exact order is confirmed by the compiled extension parser's precedence
  predicates; resolution happens at parse time, never in layout code.
- `as Type` cast is not a binary row in this table. The generated parser applies its cast
  predicate at binding level 16; the recursive-descent parser must model that production
  directly rather than infer it from printed text. It spaces on both sides
  (`Math.Max(durationMs, 0) as int`).
- Unary `! ~ - +` cling to their operand and never space away from it.

### 8.2 `primaryExpr` / `operand`

```
primaryExpr := basicLit | qualifiedIdent | thisEntity | globalEntity
             | ( expression ) | primaryExpr  index | primaryExpr  call
             | primaryExpr  .  identifier | typeExpr
operand     := primaryExpr  (generic access / postfix)
```

Cling rules:
- `(` call opens immediately after an identifier/`)`/`]`/`}`/generic-close (`F(`, `List.Append`).
- `[` index opens immediately after an identifier/`)`/`]`/`}`/`.` (`arr[0]`, `a.b[i]`).
- `.` member access has **no surrounding space** (`position.X`, `thisEntity<Transform>.Position`).
- `name<Type>` entity/generic access is tight (`thisEntity<Transform>`, `player<Player>.Name`).

### 8.3 `index`

```
expr  [  expression  ]
```

### 8.4 Call / call arguments

```
expr  (  [ argument ( , argument )* ]  )
argument := outVarArgExpr | expression
```
`outVarArgExpr` = `out var name` (§6.5). A trailing comma is allowed for multiline statements
(§12).

### 8.5 `typeofExpr`

```
typeof  (  type_  )
```
`typeof` attaches to its `(…)` (no space before `(`).

### 8.6 Cast

```
expression  as  domainType
```
`as` is spaced on both sides.
---

## 9. Types (`type_`, `domainType`, `typeReservedWord`, `typeNotReservedWord`)

A type is parsed by `type_`; a dotted/qualified type is `domainType`. Type names come from the
exact `general_identifier_token` vocabulary below. The critical point: **type
grammar runs in *type position*** (declarations, params, returns, generics), which is how
`List<int>` is recognized - separate from *expression* comparison `<`.

### 9.1 Type forms

```
type_            := typeReservedWord | typeNotReservedWord | func-point type
qualifiedIdent   := general_identifier_token (ONE token)   # alias / module; never dotted (V1)
domainType       := [ qualifiedIdent  . ]  type_           # Foo or StdLib.Foo
```

Built-in / reserved type forms (`typeReservedWord`): `object`, `bool`, `int`, `int64`, `float`,
`string`, `Vector2`, `Vector3`, `Quaternion`, `LocString`, `struct`, `export`, `entity<T>`,
`List<T>`, and `Map<K, V>`.

`general_identifier_token` accepts exactly `element`, `from`, `Type`, `Color`, `List`, `Map`,
`entity`, or `IDENTIFIER`. The `typeNotReservedWord` path uses that vocabulary; user type names
are normally identifiers (PascalCase by convention).

### 9.2 Generic types

```
List<T>
Map<K, V>
entity<T>
List<List<T>>
```

- Generic content is **tight**: `List<int>` never rendered as `List< int >`.
- Nested generics close as `>>` in source but are re-modeled as two `>` closes.
- Arbitrary `Foo<Bar>` is **not** a `domainType`. In expression position, postfix generic
  access is the distinct `expr<domainType>` production (§8.2); its acceptance is determined by
  the expression grammar.

### 9.3 Function-point type

```
func  signature  [ result ]
```
e.g. `func(player entity<Player>) bool`.

### 9.4 Type operators within a type (aliases)

In an alias/define RHS, type union may use `&` and `|`:
`alias NumberLike = int | float`, `alias E = entity<Player> & Transform` (A2).

---

## 10. Literals & composite values (`literalList`)

`literalList`/`basicLit` covers atomic and composite literals.

### 10.1 Composite literal forms (brace composites)

| Rule | Shape | Separator | Canonical |
|---|---|---|---|
| `vectorV` | `Vector2{…}`/`Vector3{…}`/`Quaternion{…}` | `,` | `Vector3{0, 0, 0}` |
| `listV`/`listT` | `List<T>{…}` / bare `{…}` | `,` | `List<int>{1, 2, 3}` |
| `mapV`/`mapT` | `Map<K,V>{…}` / `{k: v, …}` | `:` | `Map<string, int>{"a": 1, "b": 2}` |
| `tupleV`/`tupleNamedField` | `Type{Field = value, …}` | `=` (named) | `SpawnInfo{position = Vector3{0,0,0}, yaw = 0}` |
| `entityT` | `entity<Player>` type only | - | No `entity<Player>{…}` composite expression |
| `locStrV` | `LocString{…}` | `,` | `LocString{"key", {args}}` |
| `colorV` | `#RRGGBB[AA]` | - | `#FF00FF` |

- **Data literal** (positional): vector/list forms such as `Vector3{a, b, c}`,
  `List<int>{a, b}`, or bare `{a, b}` - no top-level `=`, `:`.
- **Struct literal**: a named tuple type has a top-level `=` (`SpawnInfo{Field = value}`).
  A struct-literal type head may itself be dotted when it names an import-alias member
  (`CustomTuple.JsonDocument{Nodes = …, RootIndex = …}`); decorator names, by contrast,
  stay a single bracketed identifier (§4.1).
- **Map literal**: has a top-level `:` (`key: value`).
- Nested composites are allowed: `Map<object, object>{ "seed_item_id": List<object>{…}, … }`.
- Composite `{` attaches to its type literal **tight** by default: `GardenPlacement{`, `Vector3{`,
  `LocString{`. A spaced `Type {` also compiles but is a style choice (§12.4).

### 10.2 Atomic literals (`basicLit`)

`nil_`, `boolV` (`true`/`false`), `integer` (§2.8), `float_` (§2.9), `string_` (§2.12),
`colorV` (§2.11), rune literal.

### 10.3 Non-brace enclosures

- Parenthesized grouping `( expr )` (§8.2).
- Bracket `[ … ]` is a declaration decorator (§4.1) or a postfix index (§8.3). It is **not** a
  standalone list literal; lists and maps use brace composites (§10.1).
---

## 11. Ambiguity resolutions

These are the lexical/syntactic ambiguities that have caused regressions in practice. Each is
resolved **once, declaratively**, at the correct grammatical layer, so layout code never has to
guess.

### 11.1 Generic angle `List<int>` vs comparison `a >= b` / `a < b`

**Decision:** resolved by *parse context*, not lexical heuristics.
- In **type position** (declaration/param/return/generic argument), `<`/`>` open/close a generic;
  the inside is a `type_` and there is **no space** around `<`/`>`.
- In **expression position**, `<`/`>`/`<=`/`>=` are relational operators and are **spaced** both
  sides.
- Consequences that must hold:
  - `List<int>` stays `List<int>` (never `List< int >`).
  - `a < b || a >= c` stays spaced (`a < b || a >= c`), never `a<b||a>=c`.
  - The lexer always emits `>=`/`<=` as single tokens and `<`/`>` as single tokens (§2.5); the
    printer **never re-splits** `>=`, and **never** merges `> =` → `>=`.
  - Adjacent `>>`/`<<`: in a *type* may be two generic closes (`List<List<int>>`); adjacent `>>`
    in an *expression* is a shift. The parser reassociates per context.

### 11.2 Composite-literal brace `Type{…}` vs statement-block `{…}`

**Decision:** an opening `{` after a **type literal / value** is a composite literal
(`GardenPlacement{`, `Vector3{`, `LocString{`); an opening `{` after a **header keyword**
(`func`, `graph`, `event`, `if`, `else`, `for`, `while`) is a statement/declaration block. This
is decided by node kind, never by scanning text.

### 11.3 Data literal vs struct literal vs map literal

For a brace composite, classify by its **first top-level separator**:
- top-level `:` → **Map** (`key: value`).
- top-level `=` (a `Field = value`) → **Struct**.
- neither → **Data** (positional `Type{a, b, c}`).

(Map vs struct matters for alignment and trailing-comma policy, §12.)

### 11.4 Import alias is one token (never dotted)

`qualifiedIdent` for an alias is exactly one identifier (V1). `import "x" as A.B` is invalid;
a dotted name in code is either a type (`domainType`) or postfix member access.

### 11.5 Unary vs binary `+` / `-`

A `+`/`-` is **unary (prefix)** when it begins a sub-expression - after `(`, `[`, `{`, `,`, `:`,
`=`, `:=`, `return`, or another operator - and clings to its operand (`-2`, `-value`, `+1`).
Otherwise it is binary and spaced (`a - b`).

### 11.6 Decorator/index bracket roles

A `[` group is a **decorator** when it prefixes a declaration and an **index** when it follows an
expression (`arr[0]`). Both roles are resolved by the parsed node kind; a standalone `[…]` value
is invalid FC syntax.

### 11.7 `<<`/`>>` as shift vs two generic closes

`<<`/`>>` are lexed as two `<`/`>` (V7). The parser reassociates them in **expression** position
as a single shift operator (level 7, §8.1). `>>=`/`<<=` are single assignment tokens.

### 11.8 `out var` is one unit

`out` + `var` always form the single unit `out var` in both parameter (§6.2) and argument
(§6.5) positions. Spacing inside `out var` is never altered.
---

## 12. Layout contract (derived from grammar)

These rules turn the grammar into deterministic, idempotent layout. The default project profile
is 2-space indentation, LF output, and one final newline. Approved style options may customize
presentation, but may never override grammatical token-boundary invariants such as unary
attachment, postfix attachment, or required keyword separation.

### 12.1 Indentation & width

- Every indentation level is exactly 2 spaces. Tabs are never emitted.
- `printWidth` (default 100) limits line length; groups that exceed it break.
- A multiline block/JSDoc comment keeps its internal bytes exactly and attaches directly to the
  following declaration when no source blank line separates them; the comment does not create an
  additional blank line by itself.

### 12.2 Spacing around operators

- Binary/assignment operators are flanked by one space (`a = b`, `a + b`, `a == b`, `a & b`,
  `a < b`, `a <= b`).
- Asymmetric `a -b` / `a- b` is **always** normalized to the symmetric choice.
- Unary signs cling (§11.5).
- `as` cast is spaced both sides (§8.6).

### 12.3 Call `(` attachment

`(` clings to an identifier/`)`/`]`/`}`/generic-close (§8.2). Keep one space before `(` only
where a keyword requires it. No wrapping parens on canonical `if`/`for`/`while` conditions
(§7.7, §7.9).

### 12.4 Composite-brace attachment

- `func F() int {`, `if a {`, `for … {`, `graph G {` - statement/declaration blocks always keep a
  **space** before `{` (K&R).
- **The opening `{` always stays on the same physical line as its header/operation** - K&R is the only
  supported brace style (`if cond { … }`, never `{` on the next line). This holds whether or not a
  wrapping parens form is used (`if cond {` or `if (cond) {` - both keep `{` on the same line; canonical
  FC omits `if`/`for`/`while` wrapping parens,§7.7).
- `Type{`, `return Type{`, `LocString{`, `GardenPlacement{` - composite literals always cling.

### 12.5 Trailing comma & closing-paren contract

Two distinct call families, decided by *how the call's value is used*:

- **Bare / statement call** (`wait`, `start`, standalone call): when multiline, **requires a
  trailing comma**, and the closing `)` sits on its **own** indented line:
  ```
  FooBar(
    a,
    b,
    c,
  )
  ```
- **Assignment / return call** (value is assigned to a variable or used by `return`/an argument):
  **forbids the trailing comma**, and the closing `)` stays on the **same line** as the final
  argument - the last argument "hugs" the `)`:
  ```
  FooBar(
    a,
    b,
    c)
  ```
  or flat: `FooBar(a, b, c)`.

Rules:
- Multiline composite literals (data/struct/map) **require** a trailing comma; flat literals never
  have one.
- Reference/collection **arguments** (`List<T>{…}`, `Vector3{…}`, nested composites) may
  break-all with a trailing comma (§10.1, §12.6).

### 12.6 Call/collection wrapping

- **Bare/statement call** broken: `breakAll` (each arg on its own indented line, trailing comma,
  `)` on its own line) or `hugFirst` (first arg stays on the opener line). The initial project
  profile uses `breakAll`; a future approved layout option cannot change the comma or `)` contract.
- **Assignment/return call** broken: each arg on its own indented line, **no** trailing comma, `)`
  hugs the last argument (`FooBar(a,\n  b,\n  c)`).
- Brace composites (`{}`) wrap automatically when needed; test-only layout coverage
  must still prove that a `never` mode, if introduced later, never introduces a line break. Args
  `Type{…}`/`Vector3{…}` may break-all with trailing comma.
- Wrapping is hierarchical but not contagious: once a call/collection breaks, each nested group
  decides independently. A nested group stays flat when its own content fits; it breaks only when
  its own width requires it or its own mode is `always`. A broken parent never turns a fitting
  child into a broken child.
- **Flat or after-operator break.** A call/collection renders either *flat*
  (`FooBar(a, b, c)`, `Vector3{0, 0, 0}`) or breaks **after** the operator/comma (the operator or
  separator stays at the end of the line, e.g. `Track(\n  a,\n  b,`). The formatter never switches
  to a before-operator style for calls/composites, and never splits flat content that fits.
- `LocString{…}` composites are kept flat (§10.1).

### 12.7 Header non-splitting

`if`/`for`/`while` headers and `for` clause/range headers are **single logical units** and must
never split at their commas (§7.8).
- Long logical conditions are **flat or breakAll at the direct header level**. Once a condition
  containing `&&`/`||` exceeds its width, every direct logical operand gets its own continuation
  line, with the operator retained at the end of the preceding line: `if a ||\n  b ||\n  c {`.
  Parenthesized child groups decide independently. Output is idempotent and identical whether the
  source was single-line, after-wrapped, or before-wrapped (§12.10).

### 12.8 Imports

- Treat all recognized imports in one safe file-header block as a single sorting region; ignore
  arbitrary blank lines inside that block. Never cross a declaration or non-import top-level
  content, and leave malformed or multiline imports untouched.
- Imports have three visual groups: Standard Library, Contracts, and project imports by relative
  depth. `StdLibrary.fcc` and `EditorGenLib.fcc` remain in the Standard Library group and sort at
  its end, in that order; they do not form separate groups.
- Insert one blank line between non-empty visual groups.
- Within Standard Library (apart from the reserved tail) and Contracts, sort import records
  alphabetically by canonical import path/name. Sort remaining project imports by descending
  leading `..` depth (`../../` before `../` before `./`), then canonical path/name. Carry each
  record's attached comments and trivia with it.
- Never render a missing library alias as `undefined`; never emit a dotted or dangling alias.
- Library alias required (V3); script alias optional (V4).

### 12.9 Alignment

Map/struct entries align their `:`/`=` columns only in multiline layouts. Flat composites stay
compact (`"key": value`, `Field = value`), without altering string/raw-string/nested content.

### 12.10 Idempotency requirement

For every `.fcg`/`.fcc` and every golden test: `format(format(x)) === format(x)`, byte-for-byte.
In particular, wrapping must produce the same result whether the input was single-line, already
after-wrapped, or before-wrapped - the two live regressions are pinned in §14.

### 12.11 Output hygiene

- Emit LF, remove a leading UTF-8 BOM, and enforce exactly one final newline.
- Trim trailing horizontal whitespace in ordinary trivia only. A run of two or more empty logical
  lines becomes one empty logical line, preserving one visual separator.
- Strings, raw strings, runes, line comments, block comments, and JSDoc content are protected
  ranges: their bytes, including internal line endings and trailing spaces, are never normalized.
---

## 13. Parser rule index (complete)

One-line definition for every `FCGParser.ruleNames` entry (A1). This is the normative checklist:
nothing is implemented unless it traces to a rule here.

| Rule | Definition |
|---|---|
| `sourceFile` | Top-level: graphs + imports for a `.fcg`/library file form |
| `headerFile` | Top-level: contract/header file form |
| `headerDecl` | A top-level declaration in a header file |
| `defineType`/`defineTypeHeader` | `define Name:` type/header declaration |
| `defineFuncPointType` | Headless function-point type in a `define` RHS |
| `decoratorForTypeDecl` | Decorator wrapper for a type declaration |
| `decoratorCustomDecl` | Arbitrary `[identifier]` decorator (e.g. `[platform_client]`) |
| `decoratorAcceptDecl` | `[accept entity<T>]` |
| `decoratorElementDecl` | `[element T]` |
| `decoratorForAliasDecl`/`defineAlias`/`defineAliasHeader`/`aliasStmt` | `alias Name = type` |
| `decoratorForEnumDecl`/`defineEnum`/`defineEnumHeader` | `enum Name {` header |
| `enumBlock`/`enumStmtDecl`/`enumStmt` | enum body + member with optional `= value` |
| `decoratorForEnumElementDecl` | Decorator on an enum member |
| `defineTuple`/`tupleBlock` | `tuple Name {` declaration and its field body |
| `decoratorForComponentDecl` | Decorator wrapper for component/tuple |
| `decoratorBridgingDecl` | `[bridging]` |
| `decoratorCombineDecl` | `[combine T, U]` |
| `defineComponent`/`defineComponentHeader` | `component Name {` header |
| `componentDecl`/`componentFieldDecl`/`componentBlockDecl` | Component body fields/blocks |
| `decoratorForFuncDecl`/`defineFunc`/`funcHeaderDecl` | `func` header/declaration |
| `anonFuncHeaderDecl`/`anonFuncDecl` | Anonymous function value |
| `decoratorForEventDecl`/`defineEvent`/`eventHeaderDecl` | `event` header declaration |
| `eventDecl`/`eventListenHeaderDecl` | Event listener in a graph body |
| `defineGraph`/`decoratorForGraph` | `graph` definition + decorator |
| `declareGraph`/`declareGraphBlock`/`declareGraphDefProp`/`declareGraphDefFunc` | `declare graph` signature body |
| `graphFile`/`graphDecl`/`graphBlock`/`graphElementList` | `.fcg` file, graph decl, body |
| `importDecl`/`importFile`/`importPartFile` | Imports: library (alias req) / script (alias opt) |
| `decoratorForFieldDecl`/`decoratorReadOnlyDecl` | Field decorator / `[readonly]` |
| `propertyDecl`/`fieldDecl`/`identLiteralValue` | Graph field + literal initializer |
| `funcDecl` | Function definition in a graph body |
| `signature`/`result` | `(params)` and return type after `)` |
| `parametersWithOut`/`parameterWithOutDecl`/`outVar`/`parameters`/`parameterDecl` | Parameter lists incl. `out var` |
| `codeBlock`/`statementList`/`statement` | `{ statements }` block |
| `returnStmt`/`breakStmt`/`continueStmt`/`expressionStmt` | Flow + expression statements |
| `ifStmt`/`ifBranchStmt`/`elseBranchStmt`/`elseIfBranchStmt` | `if`/`else if`/`else` |
| `forExpression`/`forExpressionStmt`/`forStmt`/`forClause`/`rangeClause` | `for` index & range forms |
| `whileStmt` | `while` loop |
| `localVarDecl`/`varSelfModify`/`varModify`/`funcPointModify` | Local var, self-mod `++/--`, assignment, func-point |
| `funcCallStatement` | Statement call incl. `start`/`wait` prefix |
| `expressionBitShiftOp`/`expression`/`primaryExpr` | Expression grammar (shift level + postfix primary) |
| `index` | `expr[i]` index access |
| `outVarArgExpr` | `out var name` call argument |
| `operand`/`typeofExpr` | Operand atom / `typeof(T)` |
| `literalList` | Set of literal/composite producers |
| `colorV`/`vectorV`/`listV`/`listT`/`tupleV`/`tupleLiteralType`/`tupleNamedFieldList`/`tupleNamedField`/`mapV`/`mapLiteralList`/`mapLiteralListItem`/`mapT`/`entityT`/`locStrV` | Composite/typed literal producers (colors §2.11, composites §10) |
| `domainType`/`type_`/`typeReservedWord`/`typeNotReservedWord`/`general_identifier_token`/`qualifiedIdent` | Type grammar + module names |
| `basicLit`/`nil_`/`boolV`/`integer`/`float_`/`string_`/`eos` | Atomic literals + statement terminator |
---

## 14. Concordance - tests & corpus (the other source of truth)

The existing test suite (fixtures + unit tests) and the real corpus are part of the grammar's
definition: they encode accepted behavior the new implementation must not regress. Every construct
below is pinned by a fixture and/or a corpus file.

### 14.1 Corpus (A4) anchors

| Construct | Example (file) |
|---|---|
| Library import | `import "List.fcc" as List` (`Components/Client_SeedGrowVFXEntity.fcg`) |
| String-path import | `import "../Global/Client_EntityPool.fcg" as ClientEntityPool` (same) |
| Named `from` import | `import Res from "EditorGenLib.fcc"` (corpus) |
| `static graph` | `static graph BigNumberLibrary` (`BigNumber.fcg`) |
| Graph + decorator | `[platform_client] graph Client_SeedGrowVFXEntity` |
| Graph fields w/ init | `_GACHA_POOL_KEY string = "GardenGrowGacha"`, `_MODEL_ENTITY_LIST List<entity<Entity>> = nil` |
| Enum w/ value | `SUCCESS = 0`, `UnknownError = -1` + trailing comments (`Contracts/CustomEnum.fcc`) |
| Tuple w/ defaults | `tuple BigNumber { blocks List<int> = List<int>{0}  decimalPos int = 0  isNegative bool = false }`; `AppliedResetEpoch int = 0` (`Contracts/CustomTuple.fcc`) |
| Component fields | `component Monster { HP int  HPMax int  … }`; field decorator `[readonly] HostTeam entity<Team>` (`AI.fcc`, extension lib) |
| `out var` params | `func ScreenTouchRay(tp Vector2, out var startPosition Vector3, …)` (`Camera.fcc`) |
| `wait` statement | `wait WaitForMillisecond(…)` (`UIUtil.fcg`) |
| `start` multiline | `start ShowBossResultTooltip(\n  title,\n  description,\n)` (`UIBoss2.fcg`) |
| `for` range no-split | `for playerUID, _ in _PendingCoinRewardsByUid {` (`Server_WalletManager.fcg`) |
| Data literal | `LocString{"[b]{0}[/b] - {1}", {skillName, skillDesc}}` (`Server_UIPlantDetail.fcg`) |
| Struct multiline | `plan = GameplayActionPlan{\n  SourceType = …,\n}` (`Server_UpgradeManager.fcg`) |
| Nested composite | `Map<object, object>{ "seed_item_id": List<object>{…}, … }` (`Telemetry.fcg`) |
| Empty composite | `var m Map<UUID, entity<Player>> = {}` |
| Cast | `Math.Max(durationMs, 0) as int` (`UIUtil.fcg`) |
| Async func | `async func PlaySequence()`; `async func ReadIntWithRetry(sheet string,key string, out var value int, out var statusCode StatusCode)` - no `result`, results via `out var` (`Client_SeedGrowVFXEntity.fcg` / `LiveOpsControlStore.fcg`) |

### 14.2 Fixtures & unit tests (A5)

- Fixture files cover: imports, graphs, enums, collections, flow, operators, comments, vectors.
- Invariants enforced over fixtures and the whole corpus: **idempotency** and
  **lossless tokenization**.
- Regression pins that the grammar's §11 resolutions produce:
  1. `List<int>` never becomes `List< int >`; `var x List<int> = …` keeps `List<int> =` spacing
     while `d > =` merges to `>=`.
  2. `a < b || a >= c` stays spaced; `>=`/`<=` are never split to `> =`/`< =`.
  3. `if a || b || c {` wraps after-style with indent (`a ||\n  b`) and is idempotent.
  4. Already-wrapped (`if a ||\n  b ||\n  c {`) and before-wrapped (`if a\n  || b\n  || c {`)
     inputs produce the **same** output as the single-line form, and are idempotent. *(These two
     are the known regressions this grammar is written to eliminate; they become red-to-green
     tests before implementation.)*
  5. `Type{`/`LocString{` cling; statement blocks keep a space (`func F() int {`).
  6. Multiline statement calls require a trailing comma; assignment/`return` calls forbid it and
     keep `)` with the final arg.
  7. `for i, item in items {` never splits after the comma.

### 14.3 Using this concordance

When implementing, each §13 rule should be exercisable by at least one fixture or corpus example
listed above. A construct with no anchor here is under-specified and must be added to §14 before
it is considered complete.
