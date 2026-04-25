/**
 * US-6：ThinkingBubble 组件三态测试
 * 关联用户测试用例：U-TB-1 / U-TB-2 / U-TB-3 / U-TB-4
 */
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ThinkingBubble } from "../ThinkingBubble";
import type { ChatUiThinkingMessage } from "@shared/chatTts";

const baseMsg = (
  overrides: Partial<ChatUiThinkingMessage> = {}
): ChatUiThinkingMessage => ({
  role: "thinking",
  content: "",
  requestId: "req-1",
  status: "running",
  headline: "Metris Agent 思考中...",
  details: [],
  startedAt: Date.now(),
  ...overrides,
});

describe("US-6 ThinkingBubble", () => {
  it("U-TB-1：running 态显示进行中文案与品牌词 'Metris Agent'", () => {
    render(<ThinkingBubble message={baseMsg()} />);
    expect(screen.getByText(/Metris Agent 思考中/i)).toBeInTheDocument();
  });

  it("U-TB-2：completed 态显示已完成文案", () => {
    render(
      <ThinkingBubble
        message={baseMsg({
          status: "completed",
          headline: "Metris Agent 已完成思考",
          endedAt: Date.now(),
        })}
      />
    );
    expect(screen.getByText(/Metris Agent 已完成思考/i)).toBeInTheDocument();
  });

  it("U-TB-3：failed 态显示失败文案与红色样式标记", () => {
    const { container } = render(
      <ThinkingBubble
        message={baseMsg({
          status: "failed",
          headline: "Metris Agent 思考失败",
          endedAt: Date.now(),
        })}
      />
    );
    expect(screen.getByText(/思考失败/i)).toBeInTheDocument();
    // data-status 用于无样式断言
    expect(
      container.querySelector('[data-thinking-status="failed"]')
    ).toBeTruthy();
  });

  it("U-TB-4：点击折叠/展开按钮可切换 details 显示", () => {
    render(
      <ThinkingBubble
        message={baseMsg({
          details: [
            {
              ts: Date.now(),
              phase: "classified",
              summary: "任务分类：navigation·complex",
            },
            {
              ts: Date.now(),
              phase: "plan_ready",
              summary: "已生成 2 步执行计划",
            },
          ],
        })}
      />
    );
    // 初始为折叠（不渲染 detail summary）
    expect(
      screen.queryByText(/已生成 2 步执行计划/i)
    ).not.toBeInTheDocument();

    // 点击展开
    const toggle = screen.getByRole("button", { name: /展开|查看详情/ });
    fireEvent.click(toggle);
    expect(screen.getByText(/已生成 2 步执行计划/i)).toBeInTheDocument();
  });
});
