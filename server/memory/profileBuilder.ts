/**
 * Profile Builder — 用户画像构建器
 *
 * 从记忆系统中提取用户画像信息，构建 ContextualProfileSnapshot。
 * 来源：SmartAgent2 的 storage.ts 中的 getUserProfile 和 getUserPreferences。
 */

import type {
  ContextualProfileSnapshot,
  UserPreferenceItem,
  UserRelationship,
} from "../personality/types";
import type { Memory } from "../../drizzle/schema";

/**
 * 从记忆列表中构建用户画像快照
 *
 * 解析 persona 类型的记忆，提取用户名称、偏好和关系信息。
 *
 * @param memories 用户的所有 persona 类型记忆
 * @returns 上下文化的用户画像快照
 */
export function buildProfileFromMemories(
  memories: Memory[]
): ContextualProfileSnapshot {
  const snapshot: ContextualProfileSnapshot = {
    displayName: undefined,
    activePreferences: [],
    relevantRelationships: [],
  };

  for (const memory of memories) {
    const content = memory.content;

    // 提取显示名称
    if (!snapshot.displayName) {
      const nameMatch = content.match(
        /(?:名字|称呼|叫|名叫|姓名)[是为：:]\s*(.+?)(?:[，。,.]|$)/
      );
      if (nameMatch) {
        snapshot.displayName = nameMatch[1].trim();
      }
    }

    // 根据记忆类型分类
    switch (memory.type) {
      case "preference":
        snapshot.activePreferences.push(
          parsePreference(content, memory.tags)
        );
        break;
      case "fact":
        // 检查是否包含关系信息
        const relationship = parseRelationship(content);
        if (relationship) {
          snapshot.relevantRelationships.push(relationship);
        }
        break;
      case "behavior":
        // 行为模式也可以作为偏好
        snapshot.activePreferences.push({
          category: "behavior",
          key: "pattern",
          value: content,
        });
        break;
      default:
        break;
    }
  }

  return snapshot;
}

/**
 * 解析偏好记忆
 */
function parsePreference(
  content: string,
  tags: string[] | null
): UserPreferenceItem {
  // 尝试从标签中提取分类
  const category =
    tags && tags.length > 0 ? tags[0] : inferCategory(content);

  // 尝试解析 key=value 格式
  const kvMatch = content.match(/(.+?)[是为：:=]\s*(.+)/);
  if (kvMatch) {
    return {
      category,
      key: kvMatch[1].trim(),
      value: kvMatch[2].trim(),
    };
  }

  return {
    category,
    key: "general",
    value: content,
  };
}

/**
 * 解析关系信息
 */
function parseRelationship(content: string): UserRelationship | null {
  // 匹配 "XXX是用户的YYY" 或 "用户的YYY叫XXX" 等模式
  const patterns = [
    /(.+?)是(?:用户的|他的|她的)(.+?)(?:[，。,.]|$)/,
    /(?:用户的|他的|她的)(.+?)(?:叫|是|为)(.+?)(?:[，。,.]|$)/,
    /(.+?)\s*[-—]\s*(.+?)(?:关系|身份)/,
  ];

  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match) {
      return {
        personName: match[1].trim(),
        relationship: match[2].trim(),
      };
    }
  }

  return null;
}

/**
 * 推断偏好分类
 */
function inferCategory(content: string): string {
  const categoryKeywords: Record<string, string[]> = {
    food: ["吃", "喝", "餐", "食", "菜", "饮", "咖啡", "茶"],
    music: ["音乐", "歌", "曲", "听"],
    travel: ["旅行", "出行", "导航", "路线", "目的地"],
    work: ["工作", "办公", "会议", "项目"],
    lifestyle: ["生活", "习惯", "运动", "健身", "睡眠"],
  };

  for (const [category, keywords] of Object.entries(categoryKeywords)) {
    if (keywords.some((kw) => content.includes(kw))) {
      return category;
    }
  }

  return "general";
}

/**
 * 格式化记忆为上下文文本
 *
 * 将记忆列表格式化为可注入 System Prompt 的文本。
 *
 * @param memories 记忆列表
 * @param maxLength 最大字符数（防止 Prompt 过长）
 * @returns 格式化的记忆上下文文本
 */
export function formatMemoriesForContext(
  memories: Memory[],
  maxLength: number = 2000
): string {
  if (memories.length === 0) return "";

  // 按重要性排序
  const sorted = [...memories].sort(
    (a, b) => b.importance - a.importance
  );

  const lines: string[] = [];
  let totalLength = 0;

  for (const memory of sorted) {
    const line = `- [${memory.type}] ${memory.content}`;
    if (totalLength + line.length > maxLength) break;
    lines.push(line);
    totalLength += line.length;
  }

  return lines.join("\n");
}
