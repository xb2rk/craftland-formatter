import { tokenize, Token, TokenKind } from "./tokenizer.js";
import type { FileModel, FuncSig, ImportInfo } from "./ast.js";

// Builds a lightweight structural model of a FC source file for linting.
// The parser is deliberately tolerant: it skips over body statements it does
// not need to fully interpret, since the goal is signal extraction (imports,
// graph metadata, top-level decls, function signatures, enums), not a full
// type-checked AST.

export function parse(source: string): FileModel {
  const all = tokenize(source);
  // Keep significant tokens + synthesized EOS for newline-triggered statement
  // terminator (Go-style NLSEMI). Whitespace and comments are dropped.
  const toks: Token[] = [];
  for (const t of all) {
    if (
      t.kind === TokenKind.WS ||
      t.kind === TokenKind.WS_NLSEMI ||
      t.kind === TokenKind.COMMENT ||
      t.kind === TokenKind.COMMENT_NLSEMI ||
      t.kind === TokenKind.LINE_COMMENT ||
      t.kind === TokenKind.LINE_COMMENT_NLSEMI
    ) {
      continue;
    }
    const push = { ...t };
    toks.push(push);
    if (t.newlineAfter === true) {
      toks.push({
        kind: TokenKind.EOS,
        text: "\n",
        line: t.line,
        column: t.column,
        offset: t.offset,
      });
    }
  }

  const model: FileModel = {
    source,
    imports: [],
    graphs: [],
    topLevelDecls: [],
    enums: [],
    funcs: [],
    platformDecorators: [],
  };

  let i = 0;
  const n = toks.length;
  const peek = (k = 0): Token => toks[Math.min(i + k, n - 1)];
  const at = (kind: TokenKind): boolean => peek().kind === kind;

  // Consume tokens until we hit a top-level terminator (EOS/`;`/`}`/EOF).
  // Returns tokens consumed text for potential re-scan.
  const skipToTopLevelBoundary = (): void => {
    // We are at statement level; advance one statement.
    let depth = 0;
    while (i < n) {
      const t = peek();
      if (t.kind === TokenKind.EOF) return;
      if (t.kind === TokenKind.L_CURLY) {
        depth++;
        i++;
        continue;
      }
      if (t.kind === TokenKind.R_CURLY) {
        if (depth === 0) return; // close of enclosing graph block
        depth--;
        i++;
        continue;
      }
      if (
        depth === 0 &&
        (t.kind === TokenKind.SEMI ||
          t.kind === TokenKind.EOS ||
          t.kind === TokenKind.TERMINATOR)
      ) {
        return;
      }
      i++;
    }
  };

  const skipToGraphBodyEnd = (): void => {
    // Called after consuming a graph declaration header; finds matching '}'.
    let depth = 0;
    while (i < n) {
      const t = peek();
      if (t.kind === TokenKind.EOF) return;
      if (t.kind === TokenKind.L_CURLY) {
        depth++;
        i++;
        continue;
      }
      if (t.kind === TokenKind.R_CURLY) {
        depth--;
        if (depth <= 0) {
          i++; // consume closing brace
          return;
        }
      }
      i++;
    }
  };

  const isEOS = (t: Token): boolean =>
    t.kind === TokenKind.SEMI ||
    t.kind === TokenKind.EOS ||
    t.kind === TokenKind.TERMINATOR ||
    t.newlineAfter === true;

  // scan from top level
  while (i < n) {
    const t = peek();
    if (t.kind === TokenKind.EOF) break;

    if (t.kind === TokenKind.IMPORT) {
      const imp = parseImport();
      if (imp) model.imports.push(imp);
      continue;
    }

    if (t.kind === TokenKind.L_BRACKET) {
      // Possible decorator. Scan for `[platform_client]` / `[platform_server]`.
      const platform = tryParsePlatformDecorator();
      if (platform !== null) {
        const graphStart = findGraphAfterDecorator();
        model.platformDecorators.push({
          line: t.line,
          platform,
          insideGraph: false, // refined below
          onGraph: graphStart,
        });
        if (graphStart) {
          // Parse the graph that follows.
          parseGraph(platform);
          continue;
        }
        // Otherwise the decorator applies to something else; skip.
        skipToTopLevelBoundary();
        continue;
      } else {
        // non-platform decorator; skip the decorator token list.
        i++; // consume '['
        let d = 1;
        while (i < n && d > 0) {
          if (at(TokenKind.L_BRACKET)) d++;
          if (at(TokenKind.R_BRACKET)) d--;
          i++;
        }
        continue;
      }
    }

    if (t.kind === TokenKind.GRAPH || t.kind === TokenKind.DECLARE || t.kind === TokenKind.STATIC) {
      if (t.kind === TokenKind.DECLARE && peek(1).kind === TokenKind.GRAPH) {
        parseGraph(null);
        continue;
      }
      parseGraph(null);
      continue;
    }

    if (t.kind === TokenKind.ENUM) {
      parseEnum();
      continue;
    }
    if (t.kind === TokenKind.TUPLE) {
      model.topLevelDecls.push({ kind: "tuple", name: captureNameAfter(), line: t.line });
      skipToTopLevelBoundary();
      continue;
    }
    if (t.kind === TokenKind.COMPONENT) {
      model.topLevelDecls.push({ kind: "component", name: captureNameAfter(), line: t.line });
      skipToTopLevelBoundary();
      continue;
    }
    if (t.kind === TokenKind.ALIAS) {
      model.topLevelDecls.push({ kind: "alias", name: captureNameAfter(), line: t.line });
      skipToTopLevelBoundary();
      continue;
    }
    if (t.kind === TokenKind.DEFINE) {
      model.topLevelDecls.push({ kind: "define", name: captureNameAfter(), line: t.line });
      skipToTopLevelBoundary();
      continue;
    }
    if (t.kind === TokenKind.EVENT) {
      const fsig = parseEventSig();
      if (fsig) model.funcs.push(fsig);
      continue;
    }
    if (t.kind === TokenKind.FUNC || t.kind === TokenKind.ASYNC) {
      const fsig = parseFuncSig();
      if (fsig) model.funcs.push(fsig);
      continue;
    }

    // Anything else at top-level (decorator-line remnants, etc.) skip.
    skipToTopLevelBoundary();
    if (at(TokenKind.SEMI) || at(TokenKind.EOS) || at(TokenKind.TERMINATOR)) i++;
  }

  return model;

  function parseImport(): ImportInfo | null {
    const line = peek().line;
    i++; // import
    // Peek: library form `import "X" as Y` OR script form `import Name as Alias from "path"`
    // Actually grammar: importFile => IMPORT STRING AS ident
    //                  importPartFile => IMPORT IDENT AS ident FROM STRING
    // Determine by looking at the token after import.
    const afterImport = peek();
    if (afterImport.kind === TokenKind.INTERPRETED_STRING_LIT) {
      const path = afterImport.text.slice(1, -1);
      i++; // string
      const alias = consumeAlias();
      return { line, offset: line, path, alias, name: null, style: "library" };
    }
    if (afterImport.kind === TokenKind.IDENTIFIER) {
      const name = afterImport.text;
      i++; // name
      const alias = consumeAlias();
      // expect FROM then string
      let path = "";
      if (at(TokenKind.FROM)) {
        i++;
        if (peek().kind === TokenKind.INTERPRETED_STRING_LIT) {
          path = peek().text.slice(1, -1);
          i++;
        }
      }
      // skip to EOS
      while (i < n && !isEOS(peek())) i++;
      return { line, offset: line, path, alias, name, style: "script" };
    }
    // unknown import form; skip line
    while (i < n && !isEOS(peek())) i++;
    return null;
  }

  function consumeAlias(): string {
    if (at(TokenKind.AS)) {
      i++; // as
      if (at(TokenKind.IDENTIFIER)) {
        const a = peek().text;
        i++;
        return a;
      }
    }
    return "";
  }

  // Returns the identifier immediately following the current keyword
  // (peek() is the keyword, so look at peek(1)).
  function captureNameAfter(): string | null {
    if (peek(1).kind === TokenKind.IDENTIFIER) {
      return peek(1).text;
    }
    return null;
  }

  function tryParsePlatformDecorator(): string | null {
    // Assumes peek() is '['
    i++; // [
    if (at(TokenKind.IDENTIFIER)) {
      const txt = peek().text;
      if (txt === "platform_client" || txt === "platform_server") {
        i++; // ident
        if (at(TokenKind.R_BRACKET)) {
          i++;
          return txt === "platform_client" ? "client" : "server";
        }
      }
    }
    return null;
  }

  function findGraphAfterDecorator(): boolean {
    // Look ahead past consecutive synthesized EOS tokens (blank lines) only.
    // The decorator's target is the immediately following declaration. If the
    // next real token is `graph`/`static`/`declare`, the decorator applies to a
    // graph. Otherwise (e.g. `[platform_client]` on an `event`) it does not.
    let j = i;
    while (j < n && toks[j].kind === TokenKind.EOS) j++;
    const t = toks[j];
    if (!t) return false;
    if (t.kind === TokenKind.GRAPH) return true;
    if (t.kind === TokenKind.STATIC && toks[j + 1]?.kind === TokenKind.GRAPH) return true;
    if (t.kind === TokenKind.DECLARE && toks[j + 1]?.kind === TokenKind.GRAPH) return true;
    return false;
  }

  function parseGraph(platform: string | null): void {
    // Skip any synthesized EOS tokens between a decorator and the graph header.
    while (i < n && at(TokenKind.EOS)) i++;
    // Parse graph header, then skip body.
    const line = peek().line;
    let isStatic = false;
    let isDeclare = false;
    if (at(TokenKind.DECLARE)) {
      isDeclare = true;
      i++;
    }
    if (at(TokenKind.STATIC)) {
      isStatic = true;
      i++;
    }
    if (at(TokenKind.GRAPH)) i++;
    let name: string | null = null;
    if (at(TokenKind.IDENTIFIER)) {
      name = peek().text;
      i++;
    }
    model.graphs.push({ name: name ?? "", line, isStatic, platform, isDeclare });
    model.topLevelDecls.push({ kind: "graph", name, line });

    // Skip to body. If the next significant token is '{', we will walk into it
    // to find nested functions/events for function-signature collection.
    // Find '{'
    while (i < n && !at(TokenKind.L_CURLY) && !at(TokenKind.EOF)) {
      if (isEOS(peek())) {
        // declare graph without body
        return;
      }
      i++;
    }
    if (!at(TokenKind.L_CURLY)) return;
    const bodyStart = i; // at '{'
    i++; // consume '{'

    // Walk inside body to collect funcs/events and detect nested platform decorators.
    scanGraphBodyMembers();

    // Now skip to matching closing brace (scanGraphBodyMembers may not have fully consumed).
    // Re-scan from bodyStart via brace matching to be safe.
    i = bodyStart;
    skipToGraphBodyEnd();
  }

  function scanGraphBodyMembers(): void {
    // Scan tokens inside a graph body (after '{' consumed) collecting func/event
    // sigs and noting any platform decorators that appear on nested listeners.
    let depth = 1;
    while (i < n && depth > 0) {
      const t = peek();
      if (t.kind === TokenKind.EOF) return;
      if (t.kind === TokenKind.L_CURLY) {
        depth++;
        i++;
        continue;
      }
      if (t.kind === TokenKind.R_CURLY) {
        depth--;
        if (depth === 0) return; // do not consume
        i++;
        continue;
      }
      if (t.kind === TokenKind.FUNC || t.kind === TokenKind.ASYNC) {
        const fsig = parseFuncSig();
        if (fsig) model.funcs.push(fsig);
        continue;
      }
      if (t.kind === TokenKind.EVENT) {
        const fsig = parseEventSig();
        if (fsig) model.funcs.push(fsig);
        continue;
      }
      if (t.kind === TokenKind.L_BRACKET) {
        const p = tryParsePlatformDecorator();
        if (p !== null) {
          model.platformDecorators.push({
            line: t.line,
            platform: p,
            insideGraph: true,
            onGraph: false,
          });
          continue;
        }
      }
      i++;
    }
  }

  function parseFuncSig(): FuncSig | null {
    const line = peek().line;
    let async = false;
    if (at(TokenKind.ASYNC)) {
      async = true;
      i++;
    }
    if (at(TokenKind.FUNC)) i++;
    if (at(TokenKind.IDENTIFIER)) {
      const name = peek().text;
      i++;
      const { params } = parseParams();
      let returnType: string | null = null;
      // return type is a type_ after the parens; loosely capture until '{' or EOS
      let rt = "";
      while (i < n && !at(TokenKind.L_CURLY) && !isEOS(peek()) && !at(TokenKind.EOF)) {
        rt += peek().text;
        i++;
      }
      returnType = rt.trim() || null;
      return { name, kind: "func", line, async, params, returnType };
    }
    // anonymous func: skip
    skipToTopLevelBoundary();
    return null;
  }

  function parseEventSig(): FuncSig | null {
    const line = peek().line;
    i++; // event
    let name = "";
    // event Name(args)  OR  event NS.Name(args) ; the name may be qualified
    if (at(TokenKind.IDENTIFIER)) {
      name = peek().text;
      i++;
      if (at(TokenKind.DOT)) {
        i++;
        if (at(TokenKind.IDENTIFIER)) {
          name = peek().text;
          i++;
        }
      }
    }
    const { params } = parseParams();
    return {
      name,
      kind: "event",
      line,
      async: false,
      params,
      returnType: null,
    };
  }

  function parseParams(): { params: FuncSig["params"] } {
    const params: FuncSig["params"] = [];
    if (!at(TokenKind.L_PAREN)) return { params };
    i++; // (
    while (i < n && !at(TokenKind.R_PAREN) && !at(TokenKind.EOF)) {
      if (at(TokenKind.COMMA)) {
        i++;
        continue;
      }
      if (at(TokenKind.OUT)) {
        i++; // out
        if (at(TokenKind.VAR)) i++; // var
        if (at(TokenKind.IDENTIFIER)) {
          const pname = peek().text;
          i++;
          const ptype = readTypeText();
          params.push({ name: pname, typeText: ptype, out: true });
        }
        continue;
      }
      if (at(TokenKind.IDENTIFIER)) {
        const pname = peek().text;
        i++;
        const ptype = readTypeText();
        params.push({ name: pname, typeText: ptype, out: false });
        continue;
      }
      i++;
    }
    if (at(TokenKind.R_PAREN)) i++;
    return { params };
  }

  function readTypeText(): string {
    let out = "";
    let depth = 0;
    while (i < n) {
      const t = peek();
      if (t.kind === TokenKind.R_PAREN || t.kind === TokenKind.COMMA) {
        if (depth === 0) break;
      }
      if (t.kind === TokenKind.LESS || t.kind === TokenKind.L_PAREN) depth++;
      if (t.kind === TokenKind.GREATER) depth = Math.max(0, depth - 1);
      if (depth === 0 && (t.kind === TokenKind.R_PAREN || t.kind === TokenKind.COMMA)) break;
      if (t.kind === TokenKind.EOF) break;
      out += t.text;
      i++;
    }
    return out.trim();
  }

  function parseEnum(): void {
    const line = peek().line;
    i++; // enum
    let name = "";
    let members: Array<{ name: string; value: string | null; line: number }> = [];
    if (at(TokenKind.IDENTIFIER)) {
      name = peek().text;
      i++;
    }
    model.topLevelDecls.push({ kind: "enum", name, line });
    // consume to '{'
    while (i < n && !at(TokenKind.L_CURLY) && !at(TokenKind.EOF)) {
      if (isEOS(peek())) {
        // enum header without body (in .fcc) - just record
        model.enums.push({ name, members: [] });
        return;
      }
      i++;
    }
    if (!at(TokenKind.L_CURLY)) return;
    i++; // {
    let depth = 1;
    while (i < n && depth > 0) {
      const t = peek();
      if (t.kind === TokenKind.EOF) break;
      if (t.kind === TokenKind.L_CURLY) {
        depth++;
        i++;
        continue;
      }
      if (t.kind === TokenKind.R_CURLY) {
        depth--;
        i++;
        continue;
      }
      if (t.kind === TokenKind.L_BRACKET) {
        const p = tryParsePlatformDecorator();
        if (p !== null) {
          model.platformDecorators.push({ line: t.line, platform: p, insideGraph: false, onGraph: false });
          continue;
        }
      }
      if (t.kind === TokenKind.IDENTIFIER) {
        const mname = t.text;
        const mline = t.line;
        let mval: string | null = null;
        i++;
        if (at(TokenKind.ASSIGN)) {
          i++;
          // capture value until ',' '}' or EOS
          let v = "";
          while (i < n && !at(TokenKind.COMMA) && !at(TokenKind.R_CURLY) && !isEOS(peek())) {
            v += peek().text;
            i++;
          }
          mval = v.trim();
        }
        members.push({ name: mname, value: mval, line: mline });
        continue;
      }
      i++;
    }
    model.enums.push({ name, members });
  }
}