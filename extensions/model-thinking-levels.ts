import { join } from "node:path";
import {
  getAgentDir,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import {
  ModelThinkingLevelMemory,
  ThinkingLevelStore,
} from "../src/model-thinking-levels.js";

const STATE_DIRECTORY_NAME = "model-thinking-levels";
type ThinkingLevel = ReturnType<ExtensionAPI["getThinkingLevel"]>;

export default function modelThinkingLevelsExtension(pi: ExtensionAPI) {
  const statePath = join(getAgentDir(), STATE_DIRECTORY_NAME);
  const store = new ThinkingLevelStore(statePath);
  let memory: ModelThinkingLevelMemory | undefined;
  let compatible: boolean | undefined;
  let lastReportedError: string | undefined;

  function reportError(error: unknown, ctx: ExtensionContext): void {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[model-thinking-levels] ${message}`);
    if (ctx.hasUI && message !== lastReportedError) {
      ctx.ui.notify(`Could not update model thinking-level memory: ${message}`, "warning");
    }
    lastReportedError = message;
  }

  function ensureMemory(): ModelThinkingLevelMemory {
    memory ??= new ModelThinkingLevelMemory(store);
    return memory;
  }

  function checkCompatibility(ctx: ExtensionContext): boolean {
    if (compatible !== undefined) return compatible;
    compatible = Array.isArray((ctx as Partial<ExtensionContext>).scopedModels);
    if (!compatible) {
      const message = "model thinking-level memory requires Pi 0.84.2 or newer";
      console.error(`[model-thinking-levels] ${message}`);
      if (ctx.hasUI) ctx.ui.notify(message, "error");
    }
    return compatible;
  }

  function getPinnedScopedLevel(
    ctx: ExtensionContext,
    model: { provider: string; id: string },
  ): ThinkingLevel | undefined {
    return ctx.scopedModels.find(
      (scoped) =>
        scoped.model.provider === model.provider &&
        scoped.model.id === model.id &&
        scoped.thinkingLevel !== undefined,
    )?.thinkingLevel;
  }

  function activateModel(
    model: { provider: string; id: string },
    ctx: ExtensionContext,
  ): void {
    if (!checkCompatibility(ctx)) return;
    try {
      const modelMemory = ensureMemory();
      const currentLevel = pi.getThinkingLevel();
      const pinnedLevel = getPinnedScopedLevel(ctx, model);
      const desiredLevel = modelMemory.activate(model, pinnedLevel ?? currentLevel, {
        restore: pinnedLevel === undefined,
      });

      if (desiredLevel !== currentLevel) {
        pi.setThinkingLevel(desiredLevel);
        // Persist Pi's effective value in case model capabilities clamped a
        // previously saved level and no change event was emitted.
        modelMemory.recordChange(model, pi.getThinkingLevel());
      }
      lastReportedError = undefined;
    } catch (error) {
      reportError(error, ctx);
    }
  }

  pi.on("session_start", (_event, ctx) => {
    if (ctx.model) activateModel(ctx.model, ctx);
  });

  pi.on("thinking_level_select", (event, ctx) => {
    if (!ctx.model || event.level !== pi.getThinkingLevel()) return;
    try {
      // During a model switch Pi changes ctx.model and clamps thinking before
      // emitting model_select. The memory still points at the announced model,
      // so recordChange deliberately ignores that interim clamp. Comparing the
      // event with Pi's live value also ignores delayed events from other models.
      if (!checkCompatibility(ctx)) return;
      ensureMemory().recordChange(ctx.model, event.level);
      lastReportedError = undefined;
    } catch (error) {
      reportError(error, ctx);
    }
  });

  pi.on("model_select", (event, ctx) => {
    if (
      !ctx.model ||
      ctx.model.provider !== event.model.provider ||
      ctx.model.id !== event.model.id
    ) {
      return;
    }
    activateModel(event.model, ctx);
  });
}
