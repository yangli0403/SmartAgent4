/**
 * 占位符解析：根据已执行步骤的 outputs 解析 step 参数中的占位符
 * 供 execute 节点与 runCrossDomain / runComplexConditional 复用
 */

import type { TaskStep } from "./types";

export interface ResolutionContext {
  outputs: unknown[];
  firstPath?: string;
  lastCreateFolderPath?: string;
}

/**
 * 从 outputs 中推导 firstPath（最近一次 search_files 结果的第一个 path）
 */
export function getFirstPathFromOutputs(outputs: unknown[]): string | undefined {
  for (let i = outputs.length - 1; i >= 0; i--) {
    const out = outputs[i];
    const list = Array.isArray(out) ? out : (out as any)?.files ?? (out as any)?.list;
    const first = Array.isArray(list) ? list[0] : null;
    if (first) return first?.path ?? first?.filePath ?? (typeof first === "string" ? first : undefined);
  }
  return undefined;
}

/**
 * 从 outputs 中推导 lastCreateFolderPath（最近一次 create_folder 的 path）
 */
export function getLastCreateFolderPathFromOutputs(outputs: unknown[]): string | undefined {
  for (let i = outputs.length - 1; i >= 0; i--) {
    const out = outputs[i];
    if (out && typeof out === "object") {
      const p = (out as any).dirPath ?? (out as any).path;
      if (p) return p;
    }
  }
  return undefined;
}

/**
 * 从 outputs 中取最近一次“列表型”结果（如 search_files）的 path 数组
 */
export function getSearchResultPathsFromOutputs(outputs: unknown[]): string[] {
  for (let i = outputs.length - 1; i >= 0; i--) {
    const last = outputs[i];
    const list = Array.isArray(last) ? last : (last as any)?.files ?? (last as any)?.list;
    if (Array.isArray(list)) {
      return list.map((f: any) => f?.path ?? f?.filePath ?? (typeof f === "string" ? f : null)).filter(Boolean);
    }
  }
  return [];
}

/**
 * 解析单步参数：将 __FIRST_RESULT_PATH__、__SEARCH_RESULT_PATHS__、__LAST_CREATE_FOLDER_PATH__ 等替换为实际值
 */
export function resolveStepParameters(
  step: TaskStep,
  ctx: ResolutionContext
): Record<string, unknown> {
  const params = { ...step.parameters } as Record<string, unknown>;

  if (
    (step.tool === "open_file" && params.filePath === "__FIRST_RESULT_PATH__") ||
    (step.tool === "open_file" && !params.filePath)
  ) {
    const first = ctx.firstPath ?? getFirstPathFromOutputs(ctx.outputs);
    params.filePath = first ?? "";
  }

  if (step.tool === "copy_files" && params.destinationDir === "__LAST_CREATE_FOLDER_PATH__") {
    params.destinationDir = ctx.lastCreateFolderPath ?? getLastCreateFolderPathFromOutputs(ctx.outputs) ?? "";
  }

  if (step.tool === "copy_files" && params.sourcePaths === "__SEARCH_RESULT_PATHS__") {
    params.sourcePaths = getSearchResultPathsFromOutputs(ctx.outputs);
  }

  return params;
}

/**
 * 执行一步后更新 context（firstPath、lastCreateFolderPath）
 */
export function updateContextAfterStep(
  ctx: ResolutionContext,
  tool: string,
  out: unknown
): void {
  if (tool === "search_files" && out && typeof out === "object") {
    const list = (out as any).files ?? (out as any).list ?? (Array.isArray(out) ? out : []);
    const first = list[0];
    if (first) ctx.firstPath = first.path ?? first.filePath ?? first;
  }
  if (tool === "create_folder" && out && typeof out === "object") {
    const p = (out as any).dirPath ?? (out as any).path;
    if (p) ctx.lastCreateFolderPath = p;
  }
}
