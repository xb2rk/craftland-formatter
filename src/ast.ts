// Lightweight structure model for linting. The formatter itself is
// token-stream driven and does not depend on this AST.

export interface ImportInfo {
  line: number; // 1-based line of the import statement
  offset: number; // token offset in the source
  path: string; // e.g. "Map.fcc", "../Contracts/CustomEnum.fcc"
  alias: string; // e.g. "Map"
  name: string | null; // for script style: import Name as Alias from "path"
  style: "library" | "script";
}

export interface FuncSig {
  name: string;
  kind: "func" | "event";
  line: number;
  async: boolean;
  params: Array<{ name: string; typeText: string; out: boolean }>;
  returnType: string | null;
}

export interface GraphInfo {
  name: string;
  line: number;
  isStatic: boolean;
  platform: string | null; // "client" | "server" | null
  isDeclare: boolean;
}

export interface TopLevelDecl {
  kind:
    | "graph"
    | "enum"
    | "tuple"
    | "component"
    | "alias"
    | "define"
    | "event"
    | "func";
  name: string | null;
  line: number;
}

export interface EnumMember {
  name: string;
  value: string | null;
  line: number;
}

export interface FileModel {
  source: string;
  imports: ImportInfo[];
  graphs: GraphInfo[];
  topLevelDecls: TopLevelDecl[];
  enums: Array<{ name: string; members: EnumMember[] }>;
  funcs: FuncSig[];
  // Raw token offsets of decorators `[platform_xxx]` and where they live
  // (whether inside a graph body vs on the graph declaration).
  platformDecorators: Array<{ line: number; platform: string; insideGraph: boolean; onGraph: boolean }>;
}