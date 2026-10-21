import { existsSync, readFileSync, readdirSync } from "node:fs";
import Module from "node:module";
import { dirname, join } from "node:path";

export interface ExtensionToken {
  readonly endOffset: number;
  readonly kind: number;
  readonly startOffset: number;
  readonly text: string;
}

interface AntlrInputStreamConstructor {
  new (source: string): unknown;
}

interface ExtensionLexer {
  nextToken(): { readonly startIndex: number; readonly stopIndex: number; readonly text: string; readonly type: number };
}

interface ExtensionLexerConstructor {
  new (input: unknown): ExtensionLexer;
}

interface ExtensionExports {
  readonly ANTLRInputStream: AntlrInputStreamConstructor;
  readonly FCGLexer: ExtensionLexerConstructor;
}

const lexerCache = new Map<string, ExtensionExports>();

/** Finds the newest locally installed Craftland Studio syntax bundle, if any. */
export function findExtensionSyntaxPath(): string | undefined {
  const homeDirectory = process.env.USERPROFILE ?? process.env.HOME;
  if (!homeDirectory) return undefined;

  const candidates: { extensionName: string; syntaxPath: string }[] = [];
  for (const extensionsDirectory of [
    join(homeDirectory, ".vscode", "extensions"),
    join(homeDirectory, ".vscode-insiders", "extensions"),
  ]) {
    if (!existsSync(extensionsDirectory)) continue;
    for (const extensionName of readdirSync(extensionsDirectory)) {
      if (!extensionName.startsWith("craftlandstudio.ffugclanguage-")) continue;
      const syntaxPath = join(extensionsDirectory, extensionName, "dist", "server_syntax.js");
      if (existsSync(syntaxPath)) candidates.push({ extensionName, syntaxPath });
    }
  }
  candidates.sort((left, right) => left.extensionName.localeCompare(right.extensionName, undefined, { numeric: true }));
  return candidates.at(-1)?.syntaxPath;
}

/**
 * Loads only the generated lexer modules from the webpack bundle. The regular
 * bundle entry starts a language server, so it is intentionally never loaded.
 */
export function lexWithExtension(source: string, syntaxPath: string): readonly ExtensionToken[] {
  const { ANTLRInputStream, FCGLexer } = loadExtensionLexer(syntaxPath);
  const lexer = new FCGLexer(new ANTLRInputStream(source));
  const tokens: ExtensionToken[] = [];

  for (;;) {
    const token = lexer.nextToken();
    tokens.push({
      kind: token.type,
      text: token.text,
      startOffset: token.startIndex,
      endOffset: token.stopIndex + 1,
    });
    if (token.type === -1) return tokens;
  }
}

function loadExtensionLexer(syntaxPath: string): ExtensionExports {
  const cached = lexerCache.get(syntaxPath);
  if (cached) return cached;

  let bundle = readFileSync(syntaxPath, "utf8");
  const lexerModuleId = findWebpackModuleId(bundle, "FCGLexer");
  const inputStreamModuleId = findWebpackModuleId(bundle, "ANTLRInputStream");
  const replacement = `module.exports = { FCGLexer: __webpack_require__(${lexerModuleId}).FCGLexer, ANTLRInputStream: __webpack_require__(${inputStreamModuleId}).ANTLRInputStream };`;
  const startupPattern = /__webpack_require__\(8762\);[\s\S]*?module\.exports = __webpack_exports__;/;
  if (!startupPattern.test(bundle)) throw new Error("Craftland syntax bundle startup shape changed");
  bundle = bundle.replace(startupPattern, replacement);

  const isolatedModule = new Module(syntaxPath);
  isolatedModule.filename = syntaxPath;
  isolatedModule.paths = (Module as unknown as { _nodeModulePaths(path: string): string[] })._nodeModulePaths(dirname(syntaxPath));
  (isolatedModule as unknown as { _compile(source: string, filename: string): void })._compile(bundle, syntaxPath);
  const exports = isolatedModule.exports as ExtensionExports;
  if (!exports.FCGLexer || !exports.ANTLRInputStream) throw new Error("Craftland syntax bundle did not expose lexer dependencies");
  lexerCache.set(syntaxPath, exports);
  return exports;
}

function findWebpackModuleId(bundle: string, exportedName: string): string {
  const modulePattern = /\/\*\*\*\/\s+(\d+):[\s\S]*?(?=\/\*\*\*\/\s+\d+:|\/\*\*\*\/\s+\}\)|\/\*\*\*\/\s+\}\s*\n)/g;
  for (let match; (match = modulePattern.exec(bundle)) !== null; ) {
    if (match[0].includes(`exports.${exportedName}`)) return match[1] ?? "";
  }
  throw new Error(`Craftland syntax bundle does not expose ${exportedName}`);
}
