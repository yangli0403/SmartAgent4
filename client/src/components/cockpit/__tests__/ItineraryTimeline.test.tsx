/**
 * ItineraryTimeline 组件单元测试
 *
 * 测试行程时间轴的渲染、交互和状态展示。
 * 关联用户测试用例：UTC-B8-1 ~ UTC-B8-6
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  ItineraryTimeline,
  type ItineraryData,
} from "../ItineraryTimeline";

// ==================== 测试数据 ====================
const mockItinerary: ItineraryData = {
  destination: "上海",
  date: "2026-04-26",
  totalDuration: "约8小时",
  preferences: ["美食", "文化"],
  stops: [
    {
      time: "2026-04-26 09:00",
      location: "外滩",
      activity: "欣赏黄浦江两岸风光，拍摄经典建筑群",
      duration: "1.5小时",
      transport: "地铁2号线",
      note: "建议早上前往，人少光线好",
    },
    {
      time: "2026-04-26 10:30",
      location: "南京路步行街",
      activity: "逛街购物，品尝小吃",
      duration: "2小时",
      transport: "步行",
    },
    {
      time: "2026-04-26 12:30",
      location: "城隍庙",
      activity: "品尝上海特色小吃：小笼包、生煎",
      duration: "1.5小时",
      transport: "地铁10号线",
    },
    {
      time: "2026-04-26 14:00",
      location: "豫园",
      activity: "游览江南古典园林",
      duration: "1.5小时",
    },
    {
      time: "2026-04-26 15:30",
      location: "陆家嘴",
      activity: "参观东方明珠塔或上海中心大厦观光层",
      duration: "2小时",
      transport: "地铁2号线",
    },
  ],
};

// ==================== 测试 ====================
describe("ItineraryTimeline", () => {
  // UTC-B8-1: 组件渲染基本信息
  it("应渲染行程标题、日期和总时长", () => {
    render(<ItineraryTimeline itinerary={mockItinerary} />);

    expect(screen.getByTestId("itinerary-title")).toHaveTextContent(
      "上海 行程"
    );
    expect(screen.getByTestId("itinerary-date")).toHaveTextContent(
      "2026-04-26"
    );
    expect(screen.getByTestId("itinerary-duration")).toHaveTextContent(
      "约8小时"
    );
  });

  // UTC-B8-2: 渲染所有站点
  it("应渲染所有站点", () => {
    render(<ItineraryTimeline itinerary={mockItinerary} />);

    expect(screen.getByTestId("itinerary-stops-count")).toHaveTextContent(
      "5 个站点"
    );

    for (let i = 0; i < mockItinerary.stops.length; i++) {
      expect(screen.getByTestId(`timeline-stop-${i}`)).toBeDefined();
    }
  });

  // UTC-B8-3: 每个站点显示时间、地点、活动和时长
  it("每个站点应显示时间、地点、活动和时长", () => {
    render(<ItineraryTimeline itinerary={mockItinerary} />);

    // 检查第一个站点
    const stop0 = screen.getByTestId("timeline-stop-0");
    expect(stop0.textContent).toContain("09:00");
    expect(stop0.textContent).toContain("外滩");
    expect(stop0.textContent).toContain("欣赏黄浦江");
    expect(stop0.textContent).toContain("1.5小时");
  });

  // UTC-B8-4: 偏好标签渲染
  it("应渲染偏好标签", () => {
    render(<ItineraryTimeline itinerary={mockItinerary} />);

    expect(screen.getByText("美食")).toBeDefined();
    expect(screen.getByText("文化")).toBeDefined();
  });

  // UTC-B8-5: 点击站点展开详情
  it("点击站点应展开交通方式和备注详情", () => {
    render(<ItineraryTimeline itinerary={mockItinerary} />);

    // 初始时详情不可见
    expect(screen.queryByTestId("timeline-detail-0")).toBeNull();

    // 点击第一个节点
    fireEvent.click(screen.getByTestId("timeline-node-0"));

    // 详情应可见
    const detail = screen.getByTestId("timeline-detail-0");
    expect(detail.textContent).toContain("地铁2号线");
    expect(detail.textContent).toContain("建议早上前往");
  });

  it("再次点击应收起详情", () => {
    render(<ItineraryTimeline itinerary={mockItinerary} />);

    // 展开
    fireEvent.click(screen.getByTestId("timeline-node-0"));
    expect(screen.getByTestId("timeline-detail-0")).toBeDefined();

    // 收起
    fireEvent.click(screen.getByTestId("timeline-node-0"));
    expect(screen.queryByTestId("timeline-detail-0")).toBeNull();
  });

  // UTC-B8-6: onStopClick 回调
  it("点击站点应触发 onStopClick 回调", () => {
    const onStopClick = vi.fn();
    render(
      <ItineraryTimeline
        itinerary={mockItinerary}
        onStopClick={onStopClick}
      />
    );

    fireEvent.click(screen.getByTestId("timeline-node-2"));

    expect(onStopClick).toHaveBeenCalledWith(
      mockItinerary.stops[2],
      2
    );
  });

  // 当前进度高亮
  it("currentStopIndex 应高亮对应站点", () => {
    render(
      <ItineraryTimeline
        itinerary={mockItinerary}
        currentStopIndex={2}
      />
    );

    // 第3个节点（index=2）应有 animate-pulse 类
    const node2 = screen.getByTestId("timeline-node-2");
    expect(node2.className).toContain("bg-blue-500");
    expect(node2.className).toContain("animate-pulse");

    // 前两个节点应为 completed（绿色）
    const node0 = screen.getByTestId("timeline-node-0");
    expect(node0.className).toContain("bg-green-500");
  });

  // 空偏好标签
  it("无偏好标签时不应渲染标签区域", () => {
    const noPrefsItinerary = { ...mockItinerary, preferences: [] };
    render(<ItineraryTimeline itinerary={noPrefsItinerary} />);

    expect(screen.queryByText("美食")).toBeNull();
  });

  // 自定义 className
  it("应支持自定义 className", () => {
    render(
      <ItineraryTimeline
        itinerary={mockItinerary}
        className="custom-class"
      />
    );

    const container = screen.getByTestId("itinerary-timeline");
    expect(container.className).toContain("custom-class");
  });
});
