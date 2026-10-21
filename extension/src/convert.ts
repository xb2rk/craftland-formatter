/**
 * @module extension/convert - document/diagnostic ↔ VS Code type conversions.
 */

import * as vscode from "vscode";
import { formatSource, type Config, type Diagnostic } from "../../dist/index.js";
import { getConfig } from "./config.js";

/**
 * Full-document range.
 *
 * @param document - text document.
 * @returns range covering the entire document.
 */
export function fullRange(document: vscode.TextDocument): vscode.Range {
  return new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
}

/**
 * Clamp line/character to `>= 0` and convert to offset.
 *
 * @param document - text document.
 * @param line - 0-based line.
 * @param character - 0-based character.
 * @returns offset.
 */
export function offsetAt(document: vscode.TextDocument, line: number, character: number): number {
  return document.offsetAt(new vscode.Position(Math.max(0, line), Math.max(0, character)));
}

/**
 * Convert a diagnostic (1-based) to a VS Code range.
 *
 * @param document - text document.
 * @param diagnostic - linter diagnostic.
 * @returns range.
 */
export function toRange(document: vscode.TextDocument, diagnostic: Diagnostic): vscode.Range {
  const start = document.positionAt(offsetAt(document, diagnostic.line - 1, diagnostic.column - 1));
  return new vscode.Range(start, document.positionAt(Math.min(document.getText().length, document.offsetAt(start) + diagnostic.length)));
}

/**
 * Convert a linter diagnostic to a VS Code diagnostic.
 *
 * @param document - text document.
 * @param diagnostic - linter diagnostic.
 * @returns VS Code diagnostic.
 */
export function toDiagnostic(document: vscode.TextDocument, diagnostic: Diagnostic): vscode.Diagnostic {
  const severity =
    diagnostic.severity === "error"
      ? vscode.DiagnosticSeverity.Error
      : diagnostic.severity === "info"
        ? vscode.DiagnosticSeverity.Information
        : vscode.DiagnosticSeverity.Warning;
  const result = new vscode.Diagnostic(toRange(document, diagnostic), diagnostic.message, severity);
  result.source = "fc-format-v2";
  result.code = diagnostic.ruleId;
  return result;
}

/**
 * Create a full-document formatting edit.
 *
 * @param document - text document.
 * @returns text edit.
 */
export function formatEdit(document: vscode.TextDocument): vscode.TextEdit {
  return vscode.TextEdit.replace(fullRange(document), formatSource(document.getText(), getConfig()));
}
