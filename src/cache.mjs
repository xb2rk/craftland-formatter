/**
 * @fileoverview Caching engine for FC Formatter CLI executions.
 *
 * Provides persistent hash-based and metadata-based caching of format results
 * across CLI invocations, eliminating redundant reading, lexing, and parsing on clean files.
 */

import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

/**
 * Maximum timestamp discrepancy (in milliseconds) tolerated between stat calls.
 * Necessary due to filesystem mtime sub-millisecond truncation jitter across OS platforms.
 */
const MTIME_TOLERANCE_MS = 1;

/**
 * @typedef {Object} CacheEntry
 * @property {number} size File size in bytes.
 * @property {number} mtimeMs File last modified timestamp in milliseconds.
 * @property {string} hash SHA-1 content hash of the clean/formatted file.
 * @property {string} configHash SHA-1 hash of the effective resolved configuration leaves.
 */

/**
 * @typedef {"metadata" | "content"} CacheStrategy
 */

/**
 * @typedef {Object} CacheLoadOptions
 * @property {CacheStrategy} [strategy="metadata"] Comparison strategy.
 * @property {string} [version] Expected formatter version string.
 */

/**
 * Computes SHA-1 hexadecimal digest of a buffer or string.
 *
 * @param {Buffer | string} content
 * @returns {string} Hexadecimal SHA-1 hash.
 */
export function hashContent(content) {
  return createHash("sha1").update(content).digest("hex");
}

/**
 * Computes a deterministic SHA-1 hash of configuration leaves.
 * Keys are sorted to ensure invariant representation regardless of insertion order.
 *
 * @param {Record<string, unknown>} leaves
 * @returns {string} Hexadecimal SHA-1 hash.
 */
export function hashConfigLeaves(leaves) {
  const sortedKeys = Object.keys(leaves ?? {}).sort();
  const normalized = {};

  for (const key of sortedKeys) {
    normalized[key] = leaves[key];
  }

  return createHash("sha1").update(JSON.stringify(normalized)).digest("hex");
}

/**
 * Persistent formatter cache mapping file paths to their last known clean state.
 */
export class FormatCache {
  /**
   * Constructs an in-memory FormatCache instance.
   *
   * @param {string} cachePath Absolute path to the on-disk cache file.
   * @param {CacheStrategy} [strategy="metadata"] Cache validation strategy.
   * @param {string} [version="0.0.0"] Formatter package version.
   */
  constructor(cachePath, strategy = "metadata", version = "0.0.0") {
    /** @type {string} */
    this.cachePath = resolve(cachePath);

    /** @type {CacheStrategy} */
    this.strategy = strategy;

    /** @type {string} */
    this.version = version;

    /** @type {Map<string, CacheEntry>} */
    this.entries = new Map();

    /** @type {boolean} */
    this.dirty = false;
  }

  /**
   * Loads a cache from disk, or initializes a clean instance if absent or corrupt.
   *
   * @param {string} cachePath
   * @param {CacheLoadOptions} [options={}]
   * @returns {FormatCache}
   */
  static load(cachePath, options = {}) {
    let pkgVersion = options.version;
    const strategy = options.strategy ?? "metadata";
    const absolutePath = resolve(cachePath);

    if (!pkgVersion) {
      try {
        const pkgData = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
        pkgVersion = pkgData.version;
      } catch {
        pkgVersion = "0.0.0";
      }
    }

    const cache = new FormatCache(absolutePath, strategy, pkgVersion);

    if (!fs.existsSync(absolutePath)) {
      return cache;
    }

    try {
      const raw = fs.readFileSync(absolutePath, "utf8");
      const parsed = JSON.parse(raw);

      if (!parsed || parsed.version !== pkgVersion || typeof parsed.entries !== "object") {
        return cache;
      }

      for (const [filePath, entry] of Object.entries(parsed.entries)) {
        if (
          entry &&
          typeof entry.size === "number" &&
          typeof entry.mtimeMs === "number" &&
          typeof entry.hash === "string" &&
          typeof entry.configHash === "string"
        ) {
          cache.entries.set(filePath, entry);
        }
      }
    } catch {
      // Ignore corrupt JSON and start fresh without crashing.
    }

    return cache;
  }

  /**
   * Checks whether a file matches the cached clean state.
   *
   * @param {string} filePath Absolute path of the file.
   * @param {Record<string, unknown>} leaves Resolved configuration leaves.
   * @param {Buffer} [currentBuffer] Optional pre-read file content buffer.
   * @returns {boolean} True if file is confirmed clean and unchanged.
   */
  isHit(filePath, leaves, currentBuffer) {
    const normalizedPath = resolve(filePath);
    const entry = this.entries.get(normalizedPath);
    let stats;
    let bytes;
    let currentHash;

    if (!entry) {
      return false;
    }

    const expectedConfigHash = hashConfigLeaves(leaves);
    if (entry.configHash !== expectedConfigHash) {
      return false;
    }

    try {
      stats = fs.statSync(normalizedPath);
    } catch {
      return false;
    }

    // Fast-path: When strategy is metadata, match size and modification time.
    if (this.strategy === "metadata") {
      if (stats.size === entry.size && Math.abs(stats.mtimeMs - entry.mtimeMs) < MTIME_TOLERANCE_MS) {
        return true;
      }
    }

    // Content verification path: compare content hash.
    try {
      bytes = currentBuffer ?? fs.readFileSync(normalizedPath);
      currentHash = hashContent(bytes);
    } catch {
      return false;
    }

    if (entry.hash === currentHash) {
      // Content is identical despite timestamp change (e.g. git touch).
      entry.size = stats.size;
      entry.mtimeMs = stats.mtimeMs;
      this.dirty = true;
      return true;
    }

    return false;
  }

  /**
   * Records or updates a clean file entry in the cache.
   *
   * @param {string} filePath Absolute path of the file.
   * @param {Record<string, unknown>} leaves Resolved configuration leaves.
   * @param {Buffer} contentBytes Clean formatted bytes of the file.
   * @param {fs.Stats} [stats] Optional pre-acquired file stats.
   */
  set(filePath, leaves, contentBytes, stats) {
    const normalizedPath = resolve(filePath);
    let fileStats = stats;

    if (!fileStats) {
      try {
        fileStats = fs.statSync(normalizedPath);
      } catch {
        fileStats = { size: contentBytes.length, mtimeMs: Date.now() };
      }
    }

    const entry = {
      size: fileStats.size,
      mtimeMs: fileStats.mtimeMs,
      hash: hashContent(contentBytes),
      configHash: hashConfigLeaves(leaves),
    };

    this.entries.set(normalizedPath, entry);
    this.dirty = true;
  }

  /**
   * Removes a file entry from the cache.
   *
   * @param {string} filePath
   */
  delete(filePath) {
    const normalizedPath = resolve(filePath);

    if (this.entries.delete(normalizedPath)) {
      this.dirty = true;
    }
  }

  /**
   * Removes cached entries whose files no longer exist on disk.
   */
  prune() {
    for (const filePath of this.entries.keys()) {
      if (!fs.existsSync(filePath)) {
        this.entries.delete(filePath);
        this.dirty = true;
      }
    }
  }

  /**
   * Atomically saves the cache file to disk if modifications were made.
   */
  save() {
    if (!this.dirty) {
      return;
    }

    const parent = dirname(this.cachePath);
    const temporary = join(parent, `.${basename(this.cachePath)}.${randomUUID()}.tmp`);
    const payload = {
      version: this.version,
      strategy: this.strategy,
      entries: Object.fromEntries(this.entries),
    };

    try {
      fs.mkdirSync(parent, { recursive: true });
      fs.writeFileSync(temporary, JSON.stringify(payload, null, 2) + "\n", "utf8");
      fs.renameSync(temporary, this.cachePath);
      this.dirty = false;
    } catch {
      // Writing cache is non-fatal: cleanup temporary file if left over.
      if (fs.existsSync(temporary)) {
        try {
          fs.unlinkSync(temporary);
        } catch {
          // Ignore unlink errors.
        }
      }
    }
  }
}
