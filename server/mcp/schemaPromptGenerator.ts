/**
 * SchemaPromptGenerator — 从 ToolRegistry 的 inputSchema 自动生成 LLM 参数指引
 *
 * 核心职责：
 * 1. 读取 ToolRegistry 中每个工具的 inputSchema
 * 2. 递归解析 JSON Schema，生成结构化的参数示例 JSON
 * 3. 输出 LLM 友好的参数格式指引文本，供 Agent 拼接到 systemPrompt
 *
 * 设计原则：
 * - inputSchema 是唯一的参数格式真相源，不依赖任何手写描述
 * - 生成的指引同时包含 JSON 示例和字段说明，帮助 LLM 理解嵌套结构
 * - 纯函数模块，无副作用，方便测试
 */

import type { ToolRegistry, RegisteredTool } from "./toolRegistry";

// ==================== 公开 API ====================

/**
 * 为指定工具列表生成参数格式指引
 *
 * @param registry - 工具注册表
 * @param toolNames - 需要生成指引的工具名称列表
 * @returns 格式化的参数指引文本，可直接拼接到 systemPrompt
 */
export function generateToolParamGuide(
  registry: ToolRegistry,
  toolNames: string[]
): string {
  const sections: string[] = [];

  for (const toolName of toolNames) {
    const tool = registry.get(toolName);
    if (!tool) continue;

    const section = generateSingleToolGuide(tool);
    if (section) {
      sections.push(section);
    }
  }

  if (sections.length === 0) return "";

  return [
    "",
    "",
    "## 工具参数格式指引（自动生成，请严格遵守）",
    "",
    "以下是每个工具的**实际参数结构**，调用时必须严格按此格式传参，不要自行猜测或简化参数结构：",
    "",
    sections.join("\n\n"),
  ].join("\n");
}

// ==================== 内部实现 ====================

/**
 * 为单个工具生成参数指引
 */
function generateSingleToolGuide(tool: RegisteredTool): string {
  const schema = tool.inputSchema;
  if (!schema || typeof schema !== "object") {
    return `### ${tool.name}\n- 参数：无（直接调用，不传参数）`;
  }

  const properties = (schema.properties || {}) as Record<string, any>;
  const required = (schema.required || []) as string[];

  // 无参数的工具
  if (Object.keys(properties).length === 0) {
    return `### ${tool.name}\n- 参数：无（直接调用，不传参数）`;
  }

  // 生成参数示例对象
  const example = generateExampleFromProperties(properties, required);
  const exampleJson = JSON.stringify(example, null, 2);

  // 生成字段说明（含嵌套字段的递归说明）
  const fieldDescriptions = generateFieldDescriptions(properties, required, 0);

  return `### ${tool.name}\n\`\`\`json\n${exampleJson}\n\`\`\`\n${fieldDescriptions}`;
}

/**
 * 从 JSON Schema 的 properties 生成示例对象
 */
function generateExampleFromProperties(
  properties: Record<string, any>,
  required: string[]
): Record<string, any> {
  const example: Record<string, any> = {};

  for (const [key, prop] of Object.entries(properties)) {
    example[key] = generateExampleValue(prop, key);
  }

  return example;
}

/**
 * 根据字段的 JSON Schema 生成占位示例值
 *
 * 优先使用 schema 中的 example/default，否则根据类型生成语义化占位符
 */
function generateExampleValue(prop: any, fieldName: string): any {
  // 优先使用 schema 自带的示例或默认值
  if (prop.example !== undefined) return prop.example;
  if (prop.default !== undefined) return prop.default;

  // 处理 enum 类型
  if (prop.enum && Array.isArray(prop.enum) && prop.enum.length > 0) {
    return prop.enum[0];
  }

  switch (prop.type) {
    case "string":
      return `<${fieldName}>`;

    case "number":
    case "integer":
      return 0;

    case "boolean":
      return false;

    case "array":
      if (prop.items) {
        return [generateExampleValue(prop.items, singularize(fieldName))];
      }
      return [];

    case "object":
      if (prop.properties) {
        return generateExampleFromProperties(
          prop.properties,
          (prop.required || []) as string[]
        );
      }
      return {};

    default:
      return `<${fieldName}>`;
  }
}

/**
 * 递归生成字段说明文本
 *
 * @param properties - JSON Schema properties
 * @param required - 必填字段列表
 * @param depth - 当前嵌套深度（控制缩进）
 */
function generateFieldDescriptions(
  properties: Record<string, any>,
  required: string[],
  depth: number
): string {
  const indent = "  ".repeat(depth);
  const lines: string[] = [];

  for (const [key, prop] of Object.entries(properties)) {
    const isRequired = required.includes(key);
    const desc = prop.description || "";
    const type = prop.type || "any";
    const requiredTag = isRequired ? "必填" : "可选";

    // 处理 enum
    const enumTag =
      prop.enum && Array.isArray(prop.enum)
        ? `, 可选值: ${prop.enum.map((v: any) => `"${v}"`).join(" | ")}`
        : "";

    lines.push(
      `${indent}- \`${key}\` (${type}, ${requiredTag}${enumTag}): ${desc}`
    );

    // 递归处理嵌套 object
    if (prop.type === "object" && prop.properties) {
      const nestedDesc = generateFieldDescriptions(
        prop.properties,
        (prop.required || []) as string[],
        depth + 1
      );
      lines.push(nestedDesc);
    }

    // 处理 array 中的 object items
    if (prop.type === "array" && prop.items?.type === "object" && prop.items?.properties) {
      lines.push(`${indent}  数组元素结构：`);
      const itemDesc = generateFieldDescriptions(
        prop.items.properties,
        (prop.items.required || []) as string[],
        depth + 2
      );
      lines.push(itemDesc);
    }
  }

  return lines.join("\n");
}

/**
 * 简单的单词单数化（将 xxxs → xxx）
 * 用于数组元素的占位符名称生成
 */
function singularize(name: string): string {
  if (name.endsWith("ies")) return name.slice(0, -3) + "y";
  if (name.endsWith("ses")) return name.slice(0, -2);
  if (name.endsWith("s") && !name.endsWith("ss")) return name.slice(0, -1);
  return name;
}
