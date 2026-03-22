/**
 * 跨域任务模块
 * 示例：一句话里同时涉及文件 + 浏览器/应用（当前 MCP）；迁移后可扩展为导航 + 车控 + 多媒体
 * 可单独迁移到其他系统，仅依赖 ToolExecutor 抽象
 */

import type {
  ToolExecutor,
  TaskStep,
  TaskDomain,
  CrossDomainInput,
  CrossDomainResult,
} from "./types";

/** 当前 MCP 支持的域 */
export const DEFAULT_DOMAINS: TaskDomain[] = ["fileSystem", "appBrowser"];

/** 从用户输入识别涉及的域（规则/关键词，迁移时可改为 NLU 或 LLM） */
function detectDomains(userInput: string, domains: TaskDomain[]): TaskDomain[] {
  const input = userInput.toLowerCase();
  const hit: TaskDomain[] = [];

  if (domains.includes("fileSystem")) {
    if (
      /下载|桌面|文件|搜索|找|打开.*(pdf|ppt|doc)|pdf|ppt|docx|xlsx/.test(input) ||
      /file|download|desktop|search.*file/.test(input)
    ) {
      hit.push("fileSystem");
    }
  }

  if (domains.includes("appBrowser")) {
    if (
      /浏览器|chrome|edge|firefox|无痕|窗口|标签|打开.*(网址|url|网页)/.test(input) ||
      /browser|incognito|window|tab|navigate/.test(input)
    ) {
      hit.push("appBrowser");
    }
  }

  return hit.length ? hit : ["fileSystem"];
}

/**
 * 为跨域输入生成步骤（当前为启发式：先文件域再应用/浏览器域）
 * 迁移时可改为 LLM 或外部规划器，按域产出步骤
 * 当用户提到「新建文件夹/创建文档/复制到」时，规划中会加入 create_folder（及 copy_files）步骤
 */
function planCrossDomain(input: CrossDomainInput): TaskStep[] {
  const domains = detectDomains(input.userInput, input.domains ?? DEFAULT_DOMAINS);
  const steps: TaskStep[] = [];
  const lower = input.userInput.toLowerCase();

  // 新建/创建：先建文件夹，便于后续复制或创建文档
  if (/新建文件夹|创建文件夹|创建文档|新建文档/.test(lower)) {
    steps.push({
      tool: "create_folder",
      parameters: { dirPath: "~/Downloads/新建文件夹" },
      description: "新建目标文件夹",
    });
    console.log("[Task] 链路-跨域规划: 已加入 create_folder 步骤（新建/创建）");
  }

  // 复制到/拷贝到（跨域场景下，若同时有文件+浏览器会进此模块）：先建目标文件夹再搜索再复制
  if (/复制到|拷贝到|移到|移动到/.test(lower) && domains.includes("fileSystem")) {
    const hasCreate = steps.some(s => s.tool === "create_folder");
    if (!hasCreate) {
      steps.push({
        tool: "create_folder",
        parameters: { dirPath: "~/Downloads/备份" },
        description: "创建目标文件夹",
      });
      console.log("[Task] 链路-跨域规划: 已加入 create_folder 步骤（复制到）");
    }
    steps.push({
      tool: "search_files",
      parameters: {
        directory: "~/Downloads",
        sortBy: "modified",
        sortOrder: "desc",
        limit: 10,
      },
      description: "搜索要复制的文件",
    });
    steps.push({
      tool: "copy_files",
      parameters: {
        sourcePaths: "__SEARCH_RESULT_PATHS__",
        destinationDir: "__LAST_CREATE_FOLDER_PATH__",
      },
      description: "复制到目标文件夹",
    });
    console.log("[Task] 链路-跨域规划: 已加入 search_files + copy_files 步骤");
  }

  // 文件域：若涉及「下载/最新/打开」等（且未因复制到已加过 search），加入 search_files + open_file
  const alreadyHasSearch = steps.some(s => s.tool === "search_files");
  if (domains.includes("fileSystem") && !alreadyHasSearch && /下载|最新|打开|搜索|找/.test(lower)) {
    steps.push({
      tool: "search_files",
      parameters: {
        directory: "~/Downloads",
        sortBy: "modified",
        sortOrder: "desc",
        limit: 5,
      },
      description: "在下载目录搜索文件",
    });
    steps.push({
      tool: "open_file",
      parameters: { filePath: "__FIRST_RESULT_PATH__" },
      description: "打开第一个结果",
    });
  }

  // 应用/浏览器域：无痕、多窗口等
  if (domains.includes("appBrowser")) {
    if (/无痕|incognito|隐私/.test(input.userInput.toLowerCase())) {
      steps.push({
        tool: "browser_control",
        parameters: {
          browser: "chrome",
          action: "open_incognito",
          incognito: true,
        },
        description: "打开无痕浏览器",
      });
    }
    if (/窗口|window|个.*打开/.test(input.userInput)) {
      const m = input.userInput.match(/(\d+)\s*个/);
      const n = m ? Math.min(parseInt(m[1], 10), 10) : 1;
      steps.push({
        tool: "browser_control",
        parameters: {
          browser: "chrome",
          action: "new_window",
          windowCount: n,
        },
        description: `打开 ${n} 个窗口`,
      });
    }
  }

  console.log("[Task] 链路-跨域规划输出步骤:", steps.map(s => s.tool).join(", ") || "(无)");
  return steps;
}

/**
 * 按域分组步骤（便于展示或按域并行，当前实现为顺序执行）
 * 导出供 Plan-Execute 图 plan 节点使用
 */
export function groupStepsByDomain(
  steps: TaskStep[],
  domains: TaskDomain[]
): Partial<Record<TaskDomain, TaskStep[]>> {
  const fileTools = ["search_files", "get_file_info", "open_file", "list_directory", "create_folder", "create_file", "copy_files"];
  const appTools = ["launch_app", "browser_control", "list_running_apps", "close_app", "window_control"];
  const byDomain: Partial<Record<TaskDomain, TaskStep[]>> = {};

  for (const step of steps) {
    if (fileTools.includes(step.tool)) {
      if (!byDomain.fileSystem) byDomain.fileSystem = [];
      byDomain.fileSystem.push(step);
    } else if (appTools.includes(step.tool)) {
      if (!byDomain.appBrowser) byDomain.appBrowser = [];
      byDomain.appBrowser.push(step);
    }
  }
  return byDomain;
}

/**
 * 执行跨域任务：规划步骤后通过 executor 依次执行
 */
export async function runCrossDomain(
  input: CrossDomainInput,
  executor: ToolExecutor
): Promise<CrossDomainResult> {
  const steps = planCrossDomain(input);
  const domains = input.domains ?? DEFAULT_DOMAINS;
  const stepsByDomain = groupStepsByDomain(steps, domains);
  console.log("[Task] 链路-跨域执行: 开始，步骤数:", steps.length);

  const outputs: unknown[] = [];
  let firstPath: string | undefined;
  let lastCreateFolderPath: string | undefined;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    let params = { ...step.parameters } as Record<string, unknown>;

    if (
      (step.tool === "open_file" && params.filePath === "__FIRST_RESULT_PATH__") ||
      (step.tool === "open_file" && !params.filePath)
    ) {
      const last = outputs[outputs.length - 1];
      const list = Array.isArray(last) ? last : (last as any)?.files ?? (last as any)?.list;
      const first = Array.isArray(list) ? list[0] : null;
      firstPath = first?.path ?? first?.filePath ?? (typeof first === "string" ? first : undefined);
      params.filePath = firstPath ?? "";
    }
    if (step.tool === "copy_files" && params.destinationDir === "__LAST_CREATE_FOLDER_PATH__") {
      params.destinationDir = lastCreateFolderPath ?? "";
    }
    if (step.tool === "copy_files" && params.sourcePaths === "__SEARCH_RESULT_PATHS__") {
      const last = outputs[outputs.length - 1];
      const list = Array.isArray(last) ? last : (last as any)?.files ?? (last as any)?.list ?? (Array.isArray(last) ? last : []);
      const paths = Array.isArray(list) ? list.map((f: any) => f?.path ?? f?.filePath ?? f).filter(Boolean) : [];
      params.sourcePaths = paths;
    }

    console.log("[Task] 链路-跨域执行步骤", i + 1, "/", steps.length, ":", step.tool, JSON.stringify(params));
    try {
      const out = await executor.executeTool(step.tool, params);
      outputs.push(out);
      if (step.tool === "search_files" && out && typeof out === "object") {
        const list = (out as any).files ?? (out as any).list ?? (Array.isArray(out) ? out : []);
        const first = list[0];
        if (first) firstPath = first.path ?? first.filePath ?? first;
      }
      if (step.tool === "create_folder" && out && typeof out === "object") {
        const p = (out as any).dirPath ?? (out as any).path;
        if (p) lastCreateFolderPath = p;
      }
      console.log("[Task] 链路-跨域步骤", i + 1, "结果: 成功");
    } catch (e: any) {
      console.log("[Task] 链路-跨域步骤", i + 1, "结果: 失败", e?.message ?? String(e));
      return {
        success: false,
        stepsByDomain,
        steps: steps.slice(0, i + 1),
        outputs,
        error: e?.message ?? String(e),
      };
    }
  }

  return {
    success: true,
    stepsByDomain,
    steps,
    outputs,
    summary: "跨域任务已按顺序执行",
  };
}

/**
 * 仅做跨域规划，不执行（供外部或 LLM 二次编排）
 */
export function planCrossDomainOnly(input: CrossDomainInput): TaskStep[] {
  return planCrossDomain(input);
}
