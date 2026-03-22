/**
 * 复杂条件约束搜索任务模块
 * 示例：打开昨天下载的 PDF 中最新的一个
 * 可单独迁移到其他系统，仅依赖 ToolExecutor 抽象
 */

import type {
  ToolExecutor,
  TaskStep,
  ComplexConditionalInput,
  ComplexConditionalResult,
} from "./types";

/** 从用户输入解析出的搜索条件（规则/关键词，迁移时可改为 NLU 或 LLM） */
interface ParsedCondition {
  extension?: string;
  modifiedAfter?: string; // ISO
  modifiedBefore?: string;
  sortBy?: "modified" | "created" | "size" | "name";
  sortOrder?: "asc" | "desc";
  limit: number;
  directory?: string;
  pattern?: string;
}

const EXTENSION_MAP: Record<string, string> = {
  pdf: "pdf",
  ppt: "pptx",
  pptx: "pptx",
  word: "docx",
  docx: "docx",
  excel: "xlsx",
  xlsx: "xlsx",
};

/**
 * 简单规则解析：从自然语言中提取「时间范围」「扩展名」「最新/最早」
 * 迁移时可替换为 LLM 或外部 NLU
 */
function parseCondition(userInput: string): ParsedCondition | null {
  const input = userInput.toLowerCase();
  const cond: ParsedCondition = { limit: 1 };

  // 扩展名
  for (const [key, ext] of Object.entries(EXTENSION_MAP)) {
    if (input.includes(key)) {
      cond.extension = ext;
      break;
    }
  }

  // 时间：昨天
  if (input.includes("昨天")) {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    cond.modifiedAfter = new Date(d.setHours(0, 0, 0, 0)).toISOString();
    cond.modifiedBefore = new Date(d.setHours(23, 59, 59, 999)).toISOString();
  }
  // 今天
  if (input.includes("今天")) {
    const d = new Date();
    cond.modifiedAfter = new Date(d.setHours(0, 0, 0, 0)).toISOString();
    cond.modifiedBefore = new Date().toISOString();
  }

  // 排序：最新 / 最早的
  if (input.includes("最新") || input.includes(" newest ") || input.includes("最近")) {
    cond.sortBy = "modified";
    cond.sortOrder = "desc";
  } else if (input.includes("最早") || input.includes("最旧")) {
    cond.sortBy = "modified";
    cond.sortOrder = "asc";
  } else if (input.includes("最大")) {
    cond.sortBy = "size";
    cond.sortOrder = "desc";
  } else if (input.includes("最小")) {
    cond.sortBy = "size";
    cond.sortOrder = "asc";
  } else {
    cond.sortBy = "modified";
    cond.sortOrder = "desc";
  }

  // 目录：下载 / 桌面
  if (input.includes("下载")) cond.directory = "~/Downloads";
  if (input.includes("桌面")) cond.directory = "~/Desktop";

  return cond;
}

/**
 * 根据解析结果生成工具步骤（不执行）
 * 迁移时可由外部传入已规划好的步骤，或在此处接入 LLM 规划
 */
export function planComplexConditional(
  input: ComplexConditionalInput
): TaskStep[] {
  const cond = parseCondition(input.userInput);
  if (!cond || !cond.extension) {
    console.log("[Task] 链路-复杂条件规划: 未解析到条件或扩展名，返回空步骤");
    return [];
  }

  const steps: TaskStep[] = [];
  const lower = input.userInput.toLowerCase();

  // 若用户同时提到新建/创建文件夹，先加入 create_folder（复杂条件场景较少，仅做可选扩展）
  if (/新建文件夹|创建文件夹|创建文档/.test(lower)) {
    steps.push({
      tool: "create_folder",
      parameters: { dirPath: "~/Downloads/新建文件夹" },
      description: "新建目标文件夹",
    });
    console.log("[Task] 链路-复杂条件规划: 已加入 create_folder 步骤");
  }

  // 若涉及相对时间（昨天/今天），先取时间再搜索；此处步骤中不强制 get_current_time，由 search_files 直接用 ISO
  steps.push({
    tool: "search_files",
    parameters: {
      directory: input.defaultSearchDirectory ?? cond.directory ?? "~/Downloads",
      extension: cond.extension,
      modifiedAfter: cond.modifiedAfter,
      modifiedBefore: cond.modifiedBefore,
      sortBy: cond.sortBy ?? "modified",
      sortOrder: cond.sortOrder ?? "desc",
      limit: cond.limit,
      ...(cond.pattern && { pattern: cond.pattern }),
    },
    description: "按条件搜索文件",
  });

  // 打开：由执行层从上一步结果中取第一个 path，再调用 open_file
  steps.push({
    tool: "open_file",
    parameters: { filePath: "__FIRST_RESULT_PATH__" },
    description: "打开搜索结果中的第一个文件",
  });

  console.log("[Task] 链路-复杂条件规划输出步骤:", steps.map(s => s.tool).join(", "));
  return steps;
}

/**
 * 执行复杂条件约束搜索：规划步骤后通过 executor 依次执行
 * 执行时会将 open_file 的 filePath 替换为上一步 search_files 返回的第一个路径
 */
export async function runComplexConditional(
  input: ComplexConditionalInput,
  executor: ToolExecutor
): Promise<ComplexConditionalResult> {
  const steps = planComplexConditional(input);
  console.log("[Task] 链路-复杂条件执行: 开始，步骤数:", steps.length);
  if (steps.length === 0) {
    return {
      success: false,
      steps: [],
      outputs: [],
      error: "无法从输入中解析出可执行的搜索条件（需包含文件类型如 pdf/ppt）",
    };
  }

  const outputs: unknown[] = [];
  let firstPath: string | undefined;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    let params = { ...step.parameters } as Record<string, unknown>;

    if (step.tool === "open_file" && params.filePath === "__FIRST_RESULT_PATH__") {
      if (firstPath === undefined) {
        const last = outputs[outputs.length - 1];
        const list = Array.isArray(last) ? last : (last as any)?.files ?? (last as any)?.list;
        const first = Array.isArray(list) ? list[0] : null;
        firstPath = first?.path ?? first?.filePath ?? (typeof first === "string" ? first : undefined);
      }
      params.filePath = firstPath ?? "";
    }

    console.log("[Task] 链路-复杂条件执行步骤", i + 1, "/", steps.length, ":", step.tool, JSON.stringify(params));
    try {
      const out = await executor.executeTool(step.tool, params);
      outputs.push(out);
      if (step.tool === "search_files" && out && typeof out === "object") {
        const list = (out as any).files ?? (out as any).list ?? (Array.isArray(out) ? out : []);
        const first = list[0];
        if (first) firstPath = first.path ?? first.filePath ?? first;
      }
      console.log("[Task] 链路-复杂条件步骤", i + 1, "结果: 成功");
    } catch (e: any) {
      console.log("[Task] 链路-复杂条件步骤", i + 1, "结果: 失败", e?.message ?? String(e));
      return {
        success: false,
        steps: steps.slice(0, i + 1),
        outputs,
        error: e?.message ?? String(e),
      };
    }
  }

  return {
    success: true,
    steps,
    outputs,
    summary: firstPath ? `已打开：${firstPath}` : "已按条件执行搜索与打开",
  };
}
