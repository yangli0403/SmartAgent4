/**
 * File Organizer Registration — 文件整理大师工具注册
 *
 * 将文件整理大师的 4 个工具注册到 ToolRegistry，
 * 使其可被 FileAgent 通过 MCP 框架调用。
 *
 * 注册方式：内置工具（builtin），类似 freeWeatherTools 的模式。
 * 工具执行：通过本地 MCP Server 执行（fileOrganizerTools.ts 中的 Server 代码）。
 */

import { z } from "zod";
import type { ToolRegistry } from "./toolRegistry";
import {
  analyzeDirectoryTool,
  findDuplicatesTool,
  deleteFilesTool,
  moveFilesTool,
} from "./fileOrganizerTools";

/**
 * 将 Zod Schema 转换为 JSON Schema（简化版）
 */
function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  // 使用 zod 内置的 JSON Schema 生成
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      const zodValue = value as z.ZodType;
      properties[key] = zodFieldToJsonSchema(zodValue);

      // 检查是否可选
      if (!(zodValue instanceof z.ZodOptional) && !(zodValue instanceof z.ZodDefault)) {
        required.push(key);
      }
    }

    return {
      type: "object",
      properties,
      required: required.length > 0 ? required : undefined,
    };
  }

  return { type: "object" };
}

function zodFieldToJsonSchema(field: z.ZodType): Record<string, unknown> {
  if (field instanceof z.ZodString) {
    return { type: "string", description: field.description };
  }
  if (field instanceof z.ZodNumber) {
    return { type: "number", description: field.description };
  }
  if (field instanceof z.ZodBoolean) {
    return { type: "boolean", description: field.description };
  }
  if (field instanceof z.ZodEnum) {
    return {
      type: "string",
      enum: field.options,
      description: field.description,
    };
  }
  if (field instanceof z.ZodArray) {
    return {
      type: "array",
      items: zodFieldToJsonSchema(field.element),
      description: field.description,
    };
  }
  if (field instanceof z.ZodOptional) {
    return zodFieldToJsonSchema(field.unwrap());
  }
  if (field instanceof z.ZodDefault) {
    const inner = zodFieldToJsonSchema(field.removeDefault());
    const defaultVal = typeof field._def.defaultValue === 'function'
      ? field._def.defaultValue()
      : field._def.defaultValue;
    return { ...inner, default: defaultVal };
  }
  return { type: "string" };
}

/**
 * 注册文件整理大师工具到 ToolRegistry
 *
 * 在 SmartAgentApp.initialize() 中调用，
 * 与 registerFreeWeatherTools 同级。
 */
export function registerFileOrganizerTools(registry: ToolRegistry): void {
  const tools = [
    analyzeDirectoryTool,
    findDuplicatesTool,
    deleteFilesTool,
    moveFilesTool,
  ];

  for (const tool of tools) {
    registry.register({
      name: tool.name,
      description: tool.description,
      inputSchema: zodToJsonSchema(tool.parameters),
      inputZodSchema: tool.parameters,
      serverId: "builtin-file-organizer",
      category: "file_system",
      registeredAt: new Date(),
    });
  }

  console.log(
    `[FileOrganizerRegistration] Registered ${tools.length} file organizer tools: ${tools.map((t) => t.name).join(", ")}`
  );
}
