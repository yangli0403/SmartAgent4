/**
 * tests/eval/harness/runSmartAgentClassify.ts
 *
 * 调用 classifyNode 的薄封装。
 *
 * 设计：
 * - 接收一个 TestCase + MockLLM 实例
 * - 构造 SupervisorStateType，注入 GT 块
 * - 调用 classifyNode，返回 taskClassification
 * - 不做 metric 计算（那是 eval_classify.ts 的事）
 *
 * 注意：mock LLM 注入通过 vi.mock 在 vitest 上下文完成
 */

import { classifyNode } from "../../../server/agent/supervisor/classifyNode";
import type {
  SupervisorStateType,
  TaskClassification,
  UserContext,
} from "../../../server/agent/supervisor/state";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { injectGroundTruth } from "./mockLLM";
import type { TestCase } from "../generate_testset";

export interface ClassifyResult {
  id: string;
  expected: TaskClassification;
  got: TaskClassification;
  durationMs: number;
  reasoning: string;
  triggeredRules: string[];
  triggeredShortCircuit: boolean;
  triggeredSceneActivation: boolean;
}

/**
 * 把 TestCase 转成 SupervisorStateType
 */
function buildState(testCase: TestCase): SupervisorStateType {
  const messages: BaseMessage[] = [];

  // dialogue_history
  for (const turn of testCase.dialogue_history ?? []) {
    if (turn.role === "user" || turn.role === "human") {
      messages.push(new HumanMessage(turn.content));
    } else {
      messages.push(new AIMessage(turn.content));
    }
  }

  // 当前用户消息
  // 把 ground truth 注入到 user message 中，让 mock LLM 能解析
  const userMessage = injectGroundTruth(testCase.query, testCase.label);
  messages.push(new HumanMessage(userMessage));

  const context: UserContext = {
    userId: testCase.context.userId,
    sessionId: testCase.context.sessionId,
    location: testCase.context.location
      ? {
          latitude: testCase.context.location.latitude ?? 0,
          longitude: testCase.context.location.longitude ?? 0,
          city: testCase.context.location.city,
        }
      : undefined,
    currentTime: testCase.context.currentTime,
    timezone: "Asia/Shanghai",
    platform: testCase.context.platform,
    personality: "default",
    responseStyle: "balanced",
  };

  return {
    messages,
    taskClassification: null,
    plan: [],
    currentStepIndex: 0,
    stepResults: [],
    finalResponse: "",
    context,
    dynamicSystemPrompt: "",
    retrievedMemories: [],
    characterId: "xiaozhi",
    dialogueSlots: undefined,
  };
}

/**
 * 调用 classifyNode，处理结果
 */
export async function runClassifyForTestCase(
  testCase: TestCase
): Promise<ClassifyResult> {
  const state = buildState(testCase);
  const start = Date.now();

  let result: Partial<SupervisorStateType>;
  try {
    result = await classifyNode(state);
  } catch (e) {
    return {
      id: testCase.id,
      expected: testCase.label,
      got: {
        domain: "general",
        complexity: "simple",
        reasoning: `[eval-error] ${(e as Error).message}`,
        requiredAgents: ["generalAgent"],
      },
      durationMs: Date.now() - start,
      reasoning: (e as Error).message,
      triggeredRules: [],
      triggeredShortCircuit: false,
      triggeredSceneActivation: false,
    };
  }

  const durationMs = Date.now() - start;
  const got: TaskClassification =
    result.taskClassification ??
    ({
      domain: "general",
      complexity: "simple",
      reasoning: "[no-classification-returned]",
      requiredAgents: ["generalAgent"],
    } as TaskClassification);

  // 从 reasoning 中提取触发的规则
  const ruleMatches = got.reasoning?.match(/\[rule:([a-z_]+)\]/g) ?? [];
  const triggeredRules = ruleMatches.map((m) =>
    m.replace(/\[rule:|\]/g, "")
  );

  // 检测是否走短路（reasoning 含 similarity_short_circuit）
  const triggeredShortCircuit = triggeredRules.includes(
    "similarity_short_circuit"
  );

  // 检测场景激活（reasoning 含 scene_activation）
  const triggeredSceneActivation = triggeredRules.includes("scene_activation");

  return {
    id: testCase.id,
    expected: testCase.label,
    got,
    durationMs,
    reasoning: got.reasoning ?? "",
    triggeredRules,
    triggeredShortCircuit,
    triggeredSceneActivation,
  };
}
