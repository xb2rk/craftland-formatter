// Generated from src/config-registry.mjs. Do not edit directly.
export interface FormatterSettings {
  printWidth?: number;
  endOfLine?: "lf" | "crlf" | "preserve";
  finalNewline?: boolean;
  lineBreaks?: "canonical" | "preserve";
  indent?: {
    style?: "space" | "tab";
    size?: number;
    continuation?: number;
  };
  alignment?: {
    collections?: boolean;
    enums?: boolean;
    fields?: boolean;
  };
  wrap?: {
    calls?: "auto" | "always" | "never";
    parameters?: "preserve" | "auto" | "always" | "never";
    collections?: "auto" | "always" | "never";
    conditions?: "auto" | "always" | "never";
  };
  spacing?: {
    operators?: "spaced" | "compact";
    assignment?: "inherit" | "spaced" | "compact";
    comma?: "spaced" | "compact";
    brackets?: "tight" | "spaced";
  };
  imports?: {
    sort?: boolean;
  };
  blankLines?: {
    maxConsecutive?: number;
    afterImports?: "always" | "preserve" | "never";
    betweenMembers?: "preserve" | "always" | "never";
    betweenFunctions?: "always" | "preserve" | "never";
  };
  syntax?: {
    canonicalHeaders?: "preserve" | "canonical";
  };
}
export type ConfigFile = FormatterSettings & {
  $schema?: string;
  ignore?: string[];
  overrides?: Array<{ files: string | string[]; options: FormatterSettings }>;
};
