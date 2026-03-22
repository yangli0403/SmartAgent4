/**
 * 任务模块统一入口
 * 支持：1）复杂条件约束搜索  2）跨域任务
 * 可单独迁移到其他系统，仅依赖 ToolExecutor 抽象
 */

import type { TaskType, ToolExecutor } from "./types";
import { planComplexConditional, runComplexConditional } from "./complexConditionalTask";
import { runCrossDomain, planCrossDomainOnly } from "./crossDomainTask";
import type { ComplexConditionalInput, ComplexConditionalResult } from "./types";
import type { CrossDomainInput, CrossDomainResult } from "./types";

export type {
  TaskType,
  ToolExecutor,
  TaskStep,
  ComplexConditionalInput,
  ComplexConditionalResult,
  CrossDomainInput,
  CrossDomainResult,
  TaskDomain,
} from "./types";

export { planComplexConditional, runComplexConditional } from "./complexConditionalTask";
export { runCrossDomain, planCrossDomainOnly } from "./crossDomainTask";
export { DEFAULT_DOMAINS } from "./crossDomainTask";

/**
 * 检测用户输入属于哪种任务类型（规则/关键词，迁移时可改为 NLU 或 LLM）
 */
export function detectTaskType(userInput: string): TaskType {
  const input = userInput.toLowerCase();

  // 拷贝/复制：交给主 Agent 用 copy_files，不走固定「搜索→打开」的复杂条件模块
  if (/拷贝|复制|复制到|拷贝到|移到|移动到/.test(input)) {
    console.log("[Task] 链路-任务类型检测: 命中 拷贝/复制 → simple");
    return "simple";
  }

  // 跨域：同时涉及「文件/下载」和「浏览器/应用」
  const hasFile = /下载|桌面|文件|pdf|ppt|搜索|找|打开.*(pdf|ppt)/.test(input);
  const hasBrowser = /浏览器|chrome|edge|无痕|窗口|标签|网址|url/.test(input);
  if (hasFile && hasBrowser) {
    console.log("[Task] 链路-任务类型检测: 命中 文件+浏览器 → cross_domain");
    return "cross_domain";
  }

  // 复杂条件：时间 + 类型 + 最新/最早 + 打开（不包含拷贝/复制）
  const hasTime = /昨天|今天|上周|这周|最近/.test(input);
  const hasType = /pdf|ppt|doc|excel|文件/.test(input);
  const hasOrder = /最新|最早|最大|最小|第一个/.test(input);
  const hasOpen = /打开|打开来|打开它/.test(input);
  if ((hasTime || hasOrder) && (hasType || hasOpen)) {
    console.log("[Task] 链路-任务类型检测: 命中 复杂条件 → complex_conditional");
    return "complex_conditional";
  }

  console.log("[Task] 链路-任务类型检测: 默认 → simple");
  return "simple";
}

/**
 * 根据检测到的任务类型，路由到对应模块执行
 * 迁移时在目标系统实现 executor 即可
 */
export async function runTask(
  userInput: string,
  executor: ToolExecutor,
  options?: {
    defaultSearchDirectory?: string;
    domains?: string[];
  }
): Promise<
  | { type: "complex_conditional"; result: ComplexConditionalResult }
  | { type: "cross_domain"; result: CrossDomainResult }
  | { type: "simple"; result: null }
> {
  const type = detectTaskType(userInput);
  console.log("[Task] 链路-runTask 入口:", { type, userInput: userInput.slice(0, 80) });

  if (type === "complex_conditional") {
    console.log("[Task] 链路-进入 complex_conditional 模块");
    const result = await runComplexConditional(
      { userInput, defaultSearchDirectory: options?.defaultSearchDirectory },
      executor
    );
    console.log("[Task] 链路-complex_conditional 完成:", { success: result.success, stepsCount: result.steps.length });
    return { type: "complex_conditional", result };
  }

  if (type === "cross_domain") {
    console.log("[Task] 链路-进入 cross_domain 模块");
    const result = await runCrossDomain(
      { userInput, domains: options?.domains as any },
      executor
    );
    console.log("[Task] 链路-cross_domain 完成:", { success: result.success, stepsCount: result.steps?.length ?? 0 });
    return { type: "cross_domain", result };
  }

  console.log("[Task] 链路-runTask 走 simple，不执行任务模块");
  return { type: "simple", result: null };
}

export default {
  detectTaskType,
  runTask,
  planComplexConditional,
  runComplexConditional,
  runCrossDomain,
  planCrossDomainOnly,
};
