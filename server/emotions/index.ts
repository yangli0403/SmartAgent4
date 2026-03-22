/**
 * Emotions Module — 情感表达系统模块导出
 */

export * from "./types";
export { EmotionsExpressClient, getEmotionsClient } from "./emotionsClient";
export type { IEmotionsExpressClient } from "./emotionsClient";
export {
  getEmotionTagInstructions,
  getCompactEmotionTagInstructions,
} from "./emotionTagInstructions";
