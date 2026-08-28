import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

export const THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

const THINKING_LEVEL_SET = new Set(THINKING_LEVELS);
let temporaryFileCounter = 0;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertModel(model) {
  if (!model || typeof model.provider !== "string" || model.provider.length === 0) {
    throw new Error("Model provider must be a non-empty string");
  }
  if (typeof model.id !== "string" || model.id.length === 0) {
    throw new Error("Model id must be a non-empty string");
  }
}

function assertThinkingLevel(level) {
  if (!THINKING_LEVEL_SET.has(level)) {
    throw new Error(`Invalid thinking level: ${String(level)}`);
  }
}

function encodePathSegment(value) {
  return Buffer.from(value, "utf8").toString("hex");
}

function entryPath(root, model) {
  return join(
    root,
    encodePathSegment(model.provider),
    `${encodePathSegment(model.id)}.json`,
  );
}

function validateEntry(value, model, path) {
  if (!isRecord(value) || value.version !== 1) {
    throw new Error(`${path} must use thinking-level entry version 1`);
  }
  if (value.provider !== model.provider || value.modelId !== model.id) {
    throw new Error(`${path} does not match ${model.provider}/${model.id}`);
  }
  if (!THINKING_LEVEL_SET.has(value.level)) {
    throw new Error(`${path} has an invalid thinking level`);
  }
  return value.level;
}

function readEntry(root, model) {
  const path = entryPath(root, model);
  let content;
  try {
    content = readFileSync(path, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") return undefined;
    throw error;
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error(`${path} must contain valid JSON`, { cause: error });
  }
  return validateEntry(parsed, model, path);
}

function writeEntry(root, model, level) {
  const path = entryPath(root, model);
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}-${temporaryFileCounter++}`;
  const entry = {
    version: 1,
    provider: model.provider,
    modelId: model.id,
    level,
  };

  try {
    writeFileSync(temporaryPath, `${JSON.stringify(entry, null, 2)}\n`, "utf8");
    renameSync(temporaryPath, path);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

export class ThinkingLevelStore {
  #root;

  constructor(root) {
    this.#root = root;
  }

  get(model) {
    assertModel(model);
    return readEntry(this.#root, model);
  }

  set(model, level) {
    assertModel(model);
    assertThinkingLevel(level);
    writeEntry(this.#root, model, level);
  }
}

export class ModelThinkingLevelMemory {
  #store;
  #activeModel;

  constructor(store) {
    this.#store = store;
  }

  activate(model, currentLevel, options = {}) {
    const restore = options.restore ?? true;
    this.#activeModel = { provider: model.provider, id: model.id };

    if (!restore) {
      this.#store.set(model, currentLevel);
      return currentLevel;
    }

    const remembered = this.#store.get(model);
    if (remembered !== undefined) return remembered;

    this.#store.set(model, currentLevel);
    return currentLevel;
  }

  recordChange(model, level) {
    if (
      !this.#activeModel ||
      this.#activeModel.provider !== model.provider ||
      this.#activeModel.id !== model.id
    ) {
      return false;
    }

    this.#store.set(model, level);
    return true;
  }
}
