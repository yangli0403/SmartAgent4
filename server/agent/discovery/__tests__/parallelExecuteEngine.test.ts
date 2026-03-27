/**
 * ParallelExecuteEngine 单元测试
 *
 * 测试并行执行引擎的核心功能：
 * - analyzeDependencies()：DAG 分析和拓扑排序
 * - resolveInputMapping()：步骤间数据引用解析
 * - 循环依赖检测和降级处理
 */

import { describe, it, expect } from "vitest";
import {
  analyzeDependencies,
  resolveInputMapping,
} from "../parallelExecuteEngine";
import type { StepResult } from "../../supervisor/state";

// ==================== analyzeDependencies 测试 ====================

describe("analyzeDependencies()", () => {
  // ==================== 基本场景 ====================

  it("空步骤列表应返回空批次", () => {
    const result = analyzeDependencies([]);
    expect(result).toEqual([]);
  });

  it("单个步骤无依赖应生成一个批次", () => {
    const steps = [{ id: 1, dependsOn: [] }];
    const batches = analyzeDependencies(steps);

    expect(batches.length).toBe(1);
    expect(batches[0].batchIndex).toBe(0);
    expect(batches[0].stepIds).toEqual([1]);
  });

  it("多个独立步骤应全部在第一批次（可并行）", () => {
    const steps = [
      { id: 1, dependsOn: [] },
      { id: 2, dependsOn: [] },
      { id: 3, dependsOn: [] },
    ];
    const batches = analyzeDependencies(steps);

    expect(batches.length).toBe(1);
    expect(batches[0].stepIds.length).toBe(3);
    expect(batches[0].stepIds).toContain(1);
    expect(batches[0].stepIds).toContain(2);
    expect(batches[0].stepIds).toContain(3);
  });

  // ==================== 线性依赖 ====================

  it("线性依赖链应生成多个单步批次", () => {
    // 1 → 2 → 3
    const steps = [
      { id: 1, dependsOn: [] },
      { id: 2, dependsOn: [1] },
      { id: 3, dependsOn: [2] },
    ];
    const batches = analyzeDependencies(steps);

    expect(batches.length).toBe(3);
    expect(batches[0].stepIds).toEqual([1]);
    expect(batches[1].stepIds).toEqual([2]);
    expect(batches[2].stepIds).toEqual([3]);
  });

  // ==================== 菱形依赖（DAG） ====================

  it("菱形依赖应正确分批", () => {
    // 1 → 2, 1 → 3, 2 → 4, 3 → 4
    //     1
    //    / \
    //   2   3
    //    \ /
    //     4
    const steps = [
      { id: 1, dependsOn: [] },
      { id: 2, dependsOn: [1] },
      { id: 3, dependsOn: [1] },
      { id: 4, dependsOn: [2, 3] },
    ];
    const batches = analyzeDependencies(steps);

    expect(batches.length).toBe(3);
    expect(batches[0].stepIds).toEqual([1]);
    // 批次1：步骤2和3可并行
    expect(batches[1].stepIds.length).toBe(2);
    expect(batches[1].stepIds).toContain(2);
    expect(batches[1].stepIds).toContain(3);
    // 批次2：步骤4等待2和3完成
    expect(batches[2].stepIds).toEqual([4]);
  });

  // ==================== 混合依赖 ====================

  it("混合依赖场景应正确分批", () => {
    // 步骤1和2独立，步骤3依赖1，步骤4依赖2，步骤5依赖3和4
    const steps = [
      { id: 1, dependsOn: [] },
      { id: 2, dependsOn: [] },
      { id: 3, dependsOn: [1] },
      { id: 4, dependsOn: [2] },
      { id: 5, dependsOn: [3, 4] },
    ];
    const batches = analyzeDependencies(steps);

    expect(batches.length).toBe(3);
    // 批次0：1和2并行
    expect(batches[0].stepIds.length).toBe(2);
    expect(batches[0].stepIds).toContain(1);
    expect(batches[0].stepIds).toContain(2);
    // 批次1：3和4并行
    expect(batches[1].stepIds.length).toBe(2);
    expect(batches[1].stepIds).toContain(3);
    expect(batches[1].stepIds).toContain(4);
    // 批次2：5
    expect(batches[2].stepIds).toEqual([5]);
  });

  // ==================== 循环依赖 ====================

  it("循环依赖应检测并降级处理", () => {
    // 1 → 2 → 3 → 1（循环）
    const steps = [
      { id: 1, dependsOn: [3] },
      { id: 2, dependsOn: [1] },
      { id: 3, dependsOn: [2] },
    ];
    const batches = analyzeDependencies(steps);

    // 应该有降级批次包含所有循环步骤
    const allStepIds = batches.flatMap((b) => b.stepIds);
    expect(allStepIds).toContain(1);
    expect(allStepIds).toContain(2);
    expect(allStepIds).toContain(3);
  });

  it("部分循环依赖应正确处理非循环部分", () => {
    // 步骤1独立，步骤2和3循环依赖
    const steps = [
      { id: 1, dependsOn: [] },
      { id: 2, dependsOn: [3] },
      { id: 3, dependsOn: [2] },
    ];
    const batches = analyzeDependencies(steps);

    // 步骤1应在第一批次
    expect(batches[0].stepIds).toContain(1);
    // 步骤2和3应在降级批次中
    const allStepIds = batches.flatMap((b) => b.stepIds);
    expect(allStepIds).toContain(2);
    expect(allStepIds).toContain(3);
  });

  // ==================== 无效依赖引用 ====================

  it("依赖不存在的步骤 ID 应被忽略", () => {
    const steps = [
      { id: 1, dependsOn: [] },
      { id: 2, dependsOn: [99] }, // 99 不存在
    ];
    const batches = analyzeDependencies(steps);

    // 步骤2的无效依赖被忽略，与步骤1同批
    expect(batches.length).toBe(1);
    expect(batches[0].stepIds).toContain(1);
    expect(batches[0].stepIds).toContain(2);
  });

  // ==================== 批次索引 ====================

  it("批次索引应从 0 开始递增", () => {
    const steps = [
      { id: 1, dependsOn: [] },
      { id: 2, dependsOn: [1] },
      { id: 3, dependsOn: [2] },
    ];
    const batches = analyzeDependencies(steps);

    batches.forEach((batch, index) => {
      expect(batch.batchIndex).toBe(index);
    });
  });
});

// ==================== resolveInputMapping 测试 ====================

describe("resolveInputMapping()", () => {
  // 模拟前置步骤结果
  const previousResults: StepResult[] = [
    {
      stepId: 1,
      status: "success",
      output: "找到 5 个充电桩",
      durationMs: 1000,
    },
    {
      stepId: 2,
      status: "success",
      output: JSON.stringify({
        pois: [{ name: "充电桩A", distance: 500 }],
        count: 1,
      }),
      durationMs: 800,
    },
  ];

  it("应解析 step_N.output 引用", () => {
    const mapping = { result: "step_1.output" };
    const resolved = resolveInputMapping(mapping, previousResults);

    expect(resolved.result).toBe("找到 5 个充电桩");
  });

  it("应解析 step_N.field 从 JSON output 中提取字段", () => {
    const mapping = { poiList: "step_2.pois" };
    const resolved = resolveInputMapping(mapping, previousResults);

    expect(resolved.poiList).toEqual([{ name: "充电桩A", distance: 500 }]);
  });

  it("应解析嵌套字段路径 step_N.field.subfield", () => {
    const mapping = { firstPoi: "step_2.pois.0.name" };
    const resolved = resolveInputMapping(mapping, previousResults);

    expect(resolved.firstPoi).toBe("充电桩A");
  });

  it("引用不存在的步骤应返回 undefined", () => {
    const mapping = { data: "step_99.output" };
    const resolved = resolveInputMapping(mapping, previousResults);

    expect(resolved.data).toBeUndefined();
  });

  it("非 step_N 格式的值应原样保留", () => {
    const mapping = { keyword: "充电桩" };
    const resolved = resolveInputMapping(mapping, previousResults);

    expect(resolved.keyword).toBe("充电桩");
  });

  it("空 mapping 应返回空对象", () => {
    const resolved = resolveInputMapping({}, previousResults);
    expect(resolved).toEqual({});
  });

  it("output 非 JSON 时嵌套字段应降级为原始 output", () => {
    const mapping = { data: "step_1.someField" };
    const resolved = resolveInputMapping(mapping, previousResults);

    // step_1 的 output 是纯文本，无法 JSON.parse 嵌套字段，降级为原始 output
    expect(resolved.data).toBe("找到 5 个充电桩");
  });

  it("应能同时解析多个 mapping 条目", () => {
    const mapping = {
      text: "step_1.output",
      count: "step_2.count",
      keyword: "搜索词",
    };
    const resolved = resolveInputMapping(mapping, previousResults);

    expect(resolved.text).toBe("找到 5 个充电桩");
    expect(resolved.count).toBe(1);
    expect(resolved.keyword).toBe("搜索词");
  });
});
