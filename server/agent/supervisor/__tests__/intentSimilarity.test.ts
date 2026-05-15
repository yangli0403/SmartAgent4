/**
 * intentSimilarity 单元测试
 */
import { describe, it, expect } from "vitest";
import {
  charNgrams,
  classifyBySimilarity,
  guardDomain,
  correctIntent,
  canShortCircuit,
  compileCorpus,
  DEFAULT_CANDIDATES,
} from "../intentSimilarity";

describe("intentSimilarity", () => {
  describe("charNgrams", () => {
    it("应能切分中文字符为 1-3 gram", () => {
      const grams = charNgrams("导航到机场");
      // 长度=5：unigram 5 + bigram 4 + trigram 3 = 12
      expect(grams.length).toBe(12);
      expect(grams).toContain("导");
      expect(grams).toContain("导航");
      expect(grams).toContain("导航到");
    });

    it("应忽略空白并 lowercase", () => {
      const grams = charNgrams(" Hello World ");
      expect(grams).toContain("h");
      expect(grams).toContain("he");
      expect(grams).toContain("hel");
      expect(grams).not.toContain(" ");
    });

    it("空字符串返回空数组", () => {
      expect(charNgrams("")).toEqual([]);
    });
  });

  describe("guardDomain", () => {
    it("'你还记得我喜欢听谁的歌吗' 应命中 general（记忆引用）", () => {
      expect(guardDomain("你还记得我喜欢听谁的歌吗")).toBe("general");
    });

    it("'按我的喜好今晚吃什么' 应命中 general（偏好引用）", () => {
      expect(guardDomain("按我的喜好，今晚适合吃什么、听什么？")).toBe(
        "general"
      );
    });

    it("'昨晚那条路线怎么走' 应命中 general（记忆+路线）", () => {
      expect(guardDomain("昨晚那条路线怎么走")).toBe("general");
    });

    it("显式规划路线（无记忆引用）不应被 guard 收敛", () => {
      const r = guardDomain(
        "帮我规划一下明天早上从苏州太湖软件园到上海虹桥机场的路线，中途经过山姆会员店和苏州北站。"
      );
      expect(r).toBe(null);
    });

    it("'播放周杰伦的歌' 应命中 multimedia", () => {
      expect(guardDomain("播放周杰伦的歌")).toBe("multimedia");
    });

    it("普通陈述句返回 null", () => {
      expect(guardDomain("今天天气不错")).toBe(null);
    });
  });

  describe("classifyBySimilarity", () => {
    it("应能将 '播放周杰伦的歌' 高置信归到 multimedia", () => {
      const scores = classifyBySimilarity("播放周杰伦的歌");
      expect(scores[0].domain).toBe("multimedia");
      expect(scores[0].score).toBeGreaterThan(0.1);
    });

    it("应能将导航问句归到 navigation", () => {
      const scores = classifyBySimilarity(
        "帮我规划从太湖软件园到虹桥机场的路线途经山姆"
      );
      expect(scores[0].domain).toBe("navigation");
    });

    it("应能将磁盘问题归到 file_system", () => {
      const scores = classifyBySimilarity("分析一下 C 盘空间不足");
      expect(scores[0].domain).toBe("file_system");
    });

    it("结果按 score 倒序", () => {
      const scores = classifyBySimilarity("播放周杰伦的歌");
      for (let i = 1; i < scores.length; i++) {
        expect(scores[i - 1].score).toBeGreaterThanOrEqual(scores[i].score);
      }
    });
  });

  describe("correctIntent", () => {
    it("guard 命中且 LLM 不一致 → 应该覆盖", () => {
      const r = correctIntent(
        "按我的喜好，今晚适合吃什么、听什么？",
        "navigation"
      );
      expect(r.reason).toBe("guard");
      expect(r.shouldOverride).toBe(true);
      expect(r.chosenDomain).toBe("general");
    });

    it("guard 命中且 LLM 一致 → 不需要覆盖（但 reason 仍是 guard）", () => {
      const r = correctIntent("按我的喜好推荐", "general");
      expect(r.reason).toBe("guard");
      expect(r.shouldOverride).toBe(false);
      expect(r.chosenDomain).toBe("general");
    });

    it("LLM 为空时直接采用 similarity top1", () => {
      const r = correctIntent("播放周杰伦的歌", null);
      expect(r.chosenDomain).toBe("multimedia");
    });

    it("LLM 与 similarity 一致 → 保留 LLM", () => {
      const r = correctIntent("播放周杰伦的歌", "multimedia");
      expect(r.shouldOverride).toBe(false);
      expect(r.chosenDomain).toBe("multimedia");
    });

    it("低置信度差距时 → 不覆盖 LLM", () => {
      // 模糊语句，相似度差距小
      const r = correctIntent("帮我看一下", "general");
      expect(r.shouldOverride).toBe(false);
    });
  });

  describe("canShortCircuit", () => {
    it("guard 命中应直接短路", () => {
      const r = canShortCircuit("你还记得我之前说的路线吗");
      expect(r.ok).toBe(true);
      expect(r.domain).toBe("general");
      expect(r.agent).toBe("generalAgent");
    });

    it("强匹配的音乐请求应短路", () => {
      const r = canShortCircuit("播放周杰伦的歌");
      expect(r.ok).toBe(true);
      expect(r.domain).toBe("multimedia");
    });

    it("模糊请求不应短路", () => {
      const r = canShortCircuit("最近怎么样啊");
      expect(r.ok).toBe(false);
    });
  });

  describe("compileCorpus", () => {
    it("可接受自定义候选语料", () => {
      const corpus = compileCorpus([
        {
          domain: "vehicle_control",
          agent: "vehicleAgent",
          label: "vehicle_routine",
          examples: ["关闭车灯打开空调座椅调舒躺", "午睡模式", "昨天中午睡觉操作"],
        },
        ...DEFAULT_CANDIDATES,
      ]);
      const scores = classifyBySimilarity("午睡模式开一下", corpus);
      expect(scores[0].domain).toBe("vehicle_control");
    });
  });

  describe("性能基准", () => {
    it("单次 correctIntent 调用应在 5ms 以内", () => {
      const start = Date.now();
      for (let i = 0; i < 1000; i++) {
        correctIntent("帮我规划路线", "navigation");
      }
      const avg = (Date.now() - start) / 1000;
      // 1000 次平均，明显 < 5ms
      expect(avg).toBeLessThan(5);
    });
  });
});
