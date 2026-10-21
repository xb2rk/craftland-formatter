import { TokenId } from "../grammar/token-vocabulary.generated.js";
import type { Token } from "../lex/token.js";
import { isTrivia } from "../lex/trivia.js";

export interface CursorToken {
  readonly index: number;
  readonly token: Token;
}

/** Cursor over significant tokens while retaining indices into the full stream. */
export class ParserCursor {
  private position = 0;
  private readonly significantIndices: readonly number[];

  public constructor(private readonly tokens: readonly Token[]) {
    this.significantIndices = tokens.flatMap((token, index) =>
      token.kind === TokenId.EOF || !isTrivia(token) ? [index] : [],
    );
  }

  public at(kind: number): boolean {
    return this.current().token.kind === kind;
  }

  public checkpoint(): number {
    return this.position;
  }

  public current(): CursorToken {
    const index = this.significantIndices[this.position] ?? this.tokens.length - 1;
    const token = this.tokens[index];
    if (!token) throw new Error("ParserCursor requires an EOF token.");
    return { index, token };
  }

  public advance(): CursorToken {
    const current = this.current();
    if (current.token.kind !== TokenId.EOF) this.position += 1;
    return current;
  }

  public peek(distance = 0): CursorToken {
    const index = this.significantIndices[this.position + distance] ?? this.tokens.length - 1;
    const token = this.tokens[index];
    if (!token) throw new Error("ParserCursor requires an EOF token.");
    return { index, token };
  }

  public restore(checkpoint: number): void {
    this.position = checkpoint;
  }
}
