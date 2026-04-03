/**
 * MultimediaAgent — 多媒体专员
 *
 * 负责处理音乐搜索、播放、歌单管理等多媒体任务。
 * 绑定网易云音乐 MCP Server 的工具（8个）。
 * 内部运行 LangGraph ReACT 循环（继承 BaseAgent）。
 */

import { BaseAgent } from "./baseAgent";
import type {
  DomainAgentConfig,
  AgentStructuredData,
  MusicData,
} from "./types";
import type { MCPManager } from "../../mcp/mcpManager";

/** MultimediaAgent 默认配置 */
export const MULTIMEDIA_AGENT_CONFIG: DomainAgentConfig = {
  name: "multimediaAgent",
  description: "多媒体专员，负责音乐搜索、播放、歌单管理等操作",
  systemPrompt: `你是音乐和多媒体操作专家。你可以帮助用户搜索歌曲、播放音乐、
管理歌单、获取歌词、查看专辑和歌手信息等。

可用工具说明：
- search: 搜索歌曲、歌手、专辑、歌单等，支持关键词搜索
- get_song_detail: 获取一首或多首歌曲的详细元数据信息
- get_song_url: 获取歌曲的播放链接，支持多种音质（standard, higher, exhigh, lossless, hires等）
- get_unblocked_url: 获取歌曲播放链接的特殊版本，可尝试解锁灰色（不可播放）歌曲
- get_lyric: 获取歌曲的歌词
- get_playlist: 获取歌单详情及完整曲目列表
- get_album: 获取专辑详情及包含的歌曲
- get_artist: 获取歌手详情及其热门50首歌曲

操作原则：
1. 用户要「最新/新歌」或歌词、专辑信息时，**必须先调用 search / get_song_detail / get_lyric / get_album 等工具**再回答；不要未调用工具就说「无法获取」或只靠训练数据列举旧歌。
2. 搜索歌曲时，关键词应包含歌手名和/或歌曲名
3. 对于主观描述（如"节奏强"、"安静的"），结合你的音乐知识进行推荐
4. 搜索到歌曲后，可以用 get_song_detail 获取详情，用 get_lyric 获取歌词，用 get_album 获取专辑信息
5. 推荐歌曲时，说明推荐理由（如节奏特点、风格等）
6. 如果用户想了解某个歌手，使用 get_artist 获取歌手信息和热门歌曲

音乐知识参考：
- 节奏强的歌曲通常 BPM 较高（>120），有明显的鼓点和节拍
- 安静的歌曲通常 BPM 较低（<80），以钢琴/弦乐为主
- 可以根据歌手的代表作风格进行推荐`,
  toolNames: [
    "search",
    "get_song_detail",
    "get_song_url",
    "get_unblocked_url",
    "get_lyric",
    "get_playlist",
    "get_album",
    "get_artist",
  ],
  maxIterations: 5,
  temperature: 0.5,
  maxTokens: 2000,
};

/**
 * MultimediaAgent 实现
 */
export class MultimediaAgent extends BaseAgent {
  readonly name = MULTIMEDIA_AGENT_CONFIG.name;
  readonly description = MULTIMEDIA_AGENT_CONFIG.description;
  readonly availableTools: string[];

  constructor(mcpManager: MCPManager, config?: Partial<DomainAgentConfig>) {
    const mergedConfig = { ...MULTIMEDIA_AGENT_CONFIG, ...config };
    super(mergedConfig, mcpManager);
    this.availableTools = mergedConfig.toolNames;
  }

  /**
   * 获取系统提示词
   */
  getSystemPrompt(context?: Record<string, unknown>): string {
    let prompt = this.config.systemPrompt;

    if (context?.currentTime) {
      prompt += `\n\n当前时间: ${context.currentTime}`;
    }

    return prompt;
  }

  /**
   * 解析音乐类结构化数据
   */
  protected parseStructuredData(output: string): AgentStructuredData | undefined {
    try {
      const jsonMatch = output.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[1]);
        if (data.songs || data.currentSong || data.playlist) {
          return {
            type: "music",
            songs: data.songs,
            currentSong: data.currentSong,
            playlist: data.playlist,
          } as MusicData;
        }
      }
    } catch {
      // 解析失败
    }

    return undefined;
  }
}
