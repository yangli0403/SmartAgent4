# -*- coding: utf-8 -*-
"""
SmartAgent4 项目分析报告 Word 文档生成脚本
"""

from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

def set_cell_shading(cell, color):
    """设置单元格背景色"""
    shading = OxmlElement('w:shd')
    shading.set(qn('w:fill'), color)
    cell._tc.get_or_add_tcPr().append(shading)

def add_heading(doc, text, level=1):
    """添加标题"""
    heading = doc.add_heading(text, level=level)
    return heading

def add_table(doc, headers, rows, header_color="4472C4"):
    """添加表格"""
    table = doc.add_table(rows=len(rows)+1, cols=len(headers))
    table.style = 'Table Grid'
    
    # 表头
    header_cells = table.rows[0].cells
    for i, header in enumerate(headers):
        header_cells[i].text = header
        header_cells[i].paragraphs[0].runs[0].bold = True
        header_cells[i].paragraphs[0].runs[0].font.color.rgb = RGBColor(255, 255, 255)
        set_cell_shading(header_cells[i], header_color)
    
    # 数据行
    for row_idx, row_data in enumerate(rows):
        row_cells = table.rows[row_idx + 1].cells
        for col_idx, cell_data in enumerate(row_data):
            row_cells[col_idx].text = str(cell_data)
    
    return table

def create_document():
    doc = Document()
    
    # ==================== 文档标题 ====================
    title = doc.add_heading('SmartAgent4 项目分析报告', 0)
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    
    # 副标题
    subtitle = doc.add_paragraph()
    subtitle.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = subtitle.add_run('智能对话交互系统架构与代码分析')
    run.font.size = Pt(14)
    run.font.color.rgb = RGBColor(128, 128, 128)
    
    doc.add_paragraph()
    
    # ==================== 1. 项目概述 ====================
    add_heading(doc, '1. 项目概述', 1)
    
    doc.add_paragraph(
        'SmartAgent4 是一个基于 LangGraph Supervisor-Agent 架构的智能对话系统，'
        '整合了个性引擎、记忆系统（含向量语义检索 + 智能预检索决策 + 质量门控）、'
        '情感表达、AIRI 前端角色舞台（Live2D）与多智能体协同架构的多模态 AI 助手平台。'
    )
    
    # ==================== 2. 代码量统计 ====================
    add_heading(doc, '2. 代码量统计', 1)
    
    doc.add_paragraph('项目代码总量统计：')
    
    add_table(doc, 
        ['层级', '文件数', '代码行数', '占比'],
        [
            ['前端 (Client)', '123', '17,514', '31.7%'],
            ['后端 (Server)', '192', '37,712', '68.3%'],
            ['总计', '315', '55,226', '100%']
        ]
    )
    
    doc.add_paragraph()
    
    # ==================== 3. 整体架构 ====================
    add_heading(doc, '3. 整体架构', 1)
    
    doc.add_paragraph('系统采用前后端分离架构：')
    
    # 架构说明
    arch_items = [
        '• 前端：React 19 + TypeScript + Vite，构建用户交互界面和 AIRI 舞台渲染',
        '• 后端：Node.js + Express + tRPC，提供 API 和 AI 推理能力',
        '• 数据库：PostgreSQL 16 + Drizzle ORM，存储记忆和用户数据',
        '• AI 层：LangGraph 编排多 Agent 协同工作',
        '• 渲染层：PixiJS + Live2D 实现角色动画'
    ]
    for item in arch_items:
        p = doc.add_paragraph(item)
        p.paragraph_format.left_indent = Inches(0.3)
    
    # ==================== 4. 模块结构 ====================
    add_heading(doc, '4. 模块结构', 1)
    
    # 4.1 后端模块
    add_heading(doc, '4.1 后端模块 (Server) - 192 文件', 2)
    
    server_modules = [
        ('_core/', '核心入口'),
        ('routers/', 'tRPC 路由 (8个)'),
        ('agent/', 'Agent 架构核心'),
        ('  ├─ supervisor/', 'Supervisor 编排图'),
        ('  ├─ discovery/', '多智能体协同'),
        ('  ├─ domains/', '领域 Agent (通用/导航/文件/多媒体)'),
        ('  ├─ tools/', '工具集'),
        ('  ├─ tasks/', '任务处理'),
        ('  └─ events/', '事件系统'),
        ('personality/', '个性引擎'),
        ('emotions/', '情感表达'),
        ('memory/', '三层记忆系统 (25个文件)'),
        ('mcp/', 'MCP 工具管理'),
        ('airi-bridge/', 'AIRI 桥接服务'),
        ('asr/', 'ASR 流式处理'),
        ('voice/', '语音模式'),
        ('llm/', 'LLM 适配器'),
        ('context/', '上下文管理'),
        ('db.ts', '数据库连接'),
        ('routers.ts', '路由入口'),
    ]
    
    for module, desc in server_modules:
        p = doc.add_paragraph(f'{module:25} {desc}')
        p.paragraph_format.left_indent = Inches(0.3)
    
    doc.add_paragraph()
    
    # 4.2 前端模块
    add_heading(doc, '4.2 前端模块 (Client) - 123 文件', 2)
    
    client_modules = [
        ('main.tsx', '入口文件'),
        ('App.tsx', '根组件'),
        ('index.css', '全局样式'),
        ('pages/', '页面 (7个): Chat/Cockpit/Memories/Settings/Home/AiriDemo'),
        ('components/', '组件目录'),
        ('  ├─ ui/', 'Radix UI 组件库 (51个)'),
        ('  ├─ DashboardLayout.tsx', '仪表盘布局'),
        ('  ├─ airi-stage/', 'AIRI 舞台组件'),
        ('  └─ cockpit/', '驾驶舱组件'),
        ('hooks/', 'React Hooks (14个)'),
        ('lib/', '工具库'),
        ('  ├─ airi-stage/', 'AIRI 舞台核心库 (12个测试)'),
        ('  ├─ omniRealtimeClient.ts', '实时通信客户端'),
        ('  ├─ omniAudioManager.ts', '音频管理器'),
        ('  └─ emotionParser.ts', '情感解析器'),
        ('contexts/', 'React Context'),
    ]
    
    for module, desc in client_modules:
        p = doc.add_paragraph(f'{module:30} {desc}')
        p.paragraph_format.left_indent = Inches(0.3)
    
    # ==================== 5. 技术栈 ====================
    add_heading(doc, '5. 技术栈', 1)
    
    add_table(doc,
        ['层级', '技术选型'],
        [
            ['前端框架', 'React 19 + TypeScript + Vite 7'],
            ['UI 库', 'Radix UI + TailwindCSS 4'],
            ['状态管理', 'Zustand + TanStack Query'],
            ['2D渲染', 'PixiJS 7 + pixi-live2d-display'],
            ['后端框架', 'Node.js + Express + tRPC 11'],
            ['AI框架', 'LangGraph (StateGraph) + LangChain'],
            ['LLM', 'Manus API + Volcengine ARK (双轨)'],
            ['向量检索', '阿里云百炼 DashScope (1024维)'],
            ['数据库', 'PostgreSQL 16 + Drizzle ORM'],
            ['实时通信', 'WebSocket (ws)'],
            ['协议', 'MCP (Model Context Protocol)'],
            ['测试', 'Vitest 2 + @vitest/coverage-v8'],
            ['包管理', 'pnpm 10'],
        ]
    )
    
    doc.add_paragraph()
    
    # ==================== 6. 核心功能模块 ====================
    add_heading(doc, '6. 核心功能模块', 1)
    
    add_table(doc,
        ['模块', '描述', '文件数'],
        [
            ['Agent 编排', 'LangGraph Supervisor 多节点编排', '~30'],
            ['多智能体协同', 'Agent Card 发现 + DAG并行执行', '~15'],
            ['三层记忆系统', '情景/语义/人格记忆 + 遗忘机制', '~25'],
            ['个性引擎', '人格配置加载与动态 Prompt 组装', '~5'],
            ['情感表达', '情感标签渲染 + AIRI 桥接', '~8'],
            ['AIRI 舞台', 'Live2D 前端渲染层', '~15'],
            ['MCP 工具', '网易云音乐、文件管理、导航等', '~20'],
            ['UI 组件库', 'Radix UI 封装组件', '51'],
        ]
    )
    
    doc.add_paragraph()
    
    # ==================== 7. 测试覆盖 ====================
    add_heading(doc, '7. 测试覆盖', 1)
    
    add_table(doc,
        ['模块', '语句覆盖率', '函数覆盖率', '测试用例'],
        [
            ['AIRI 舞台核心库', '100%', '100%', '71'],
            ['discovery 模块', '97.68%', '100%', '77'],
            ['embeddingService', '98.4%', '100%', '24'],
            ['extractionAudit', '97.1%', '100%', '54'],
            ['preRetrievalDecision', '93.5%', '100%', '46'],
            ['confidenceEvolution', '87.2%', '100%', '16'],
            ['backfillExtraction', '88.9%', '85.7%', '15'],
            ['总计', '-', '-', '~654+'],
        ]
    )
    
    doc.add_paragraph()
    
    # ==================== 8. 对话处理流程 ====================
    add_heading(doc, '8. 对话处理流程', 1)
    
    flow_steps = [
        '1. 用户消息输入',
        '2. contextEnrichNode - Pre-Retrieval Decision → 混合检索 + 画像构建',
        '3. classifyNode - 意图分类（动态 Prompt 注入 Agent 能力描述）',
        '4. planNode - 任务规划（动态 Agent 列表 + 并行执行提示）',
        '5. parallelExecute/executeNode - DAG并行执行 或 串行执行',
        '6. respondNode - 响应生成（含情感标签）',
        '7. memoryExtractionNode - 异步记忆提取 + 行为检测',
        '8. reflectionNode - 异步自进化反思',
        '9. AI 回复 + 情感渲染',
    ]
    
    for step in flow_steps:
        p = doc.add_paragraph(step)
        p.paragraph_format.left_indent = Inches(0.3)
    
    # ==================== 9. 项目文档 ====================
    add_heading(doc, '9. 项目文档', 1)
    
    add_table(doc,
        ['文档', '说明'],
        [
            ['README.md', '项目主文档'],
            ['ARCHITECTURE.md', '系统架构设计'],
            ['INTERFACE_DESIGN.md', '接口设计'],
            ['CLAUDE.md', 'AI 编程指南'],
            ['TESTING.md', '全量测试文档'],
            ['CHANGELOG.md', '变更日志'],
            ['docs/ARCHITECTURE_AIRI_STAGE.md', 'AIRI 舞台架构'],
            ['docs/PRODUCT_SPEC_AIRI_STAGE.md', 'AIRI 产品规格'],
        ]
    )
    
    doc.add_paragraph()
    
    # ==================== 10. 开发路线 ====================
    add_heading(doc, '10. 开发路线（已完成 8 轮迭代）', 1)
    
    milestones = [
        ('第1轮', '个性引擎 + 情感渲染 + 记忆系统整合'),
        ('第2轮', 'PostgreSQL 迁移 + 四层过滤管道 + 自进化闭环'),
        ('第3轮', 'Agent Card 动态发现 + 并行执行引擎 + 委托协议'),
        ('第4轮', '主动记忆引擎（行为检测 + 意图预测 + 预取缓存）'),
        ('第5轮', 'Prompt Caching + Fork 子代理 + DreamGatekeeper'),
        ('第6轮', '记忆技能化改造（Agent 主动调度）'),
        ('第7轮', '记忆系统优化（Embedding + 智能检索 + 质量门控）'),
        ('第8轮', 'AIRI 前端角色舞台集成（Live2D + 事件驱动 + 状态机）'),
    ]
    
    for milestone, desc in milestones:
        p = doc.add_paragraph(f'{milestone}：{desc}')
        p.paragraph_format.left_indent = Inches(0.3)
    
    doc.add_paragraph()
    
    # ==================== 11. 待完成功能 ====================
    add_heading(doc, '11. 待完成功能', 1)
    
    todos = [
        '• 闭合自进化反馈回路（classifyNode 消费工具效用分数）',
        '• Agent Card 的 llmConfig 消费端实现',
        '• 迁移到 pgvector 扩展，将向量检索下沉到数据库层',
        '• 引入 Apache AGE 图记忆',
        '• AIRI Bridge 流式输出与前端舞台深度结合',
        '• 前端 UI 适配个性切换和情感渲染展示',
    ]
    
    for todo in todos:
        p = doc.add_paragraph(todo)
        p.paragraph_format.left_indent = Inches(0.3)
    
    # ==================== 12. 总结 ====================
    add_heading(doc, '12. 总结', 1)
    
    doc.add_paragraph(
        'SmartAgent4 是一款功能完善、架构清晰的多模态 AI 助手项目。'
        '项目代码总量超过 55,000 行，包含 315 个 TypeScript 文件，'
        '涵盖了从前端 UI 到后端 AI 编排的完整技术栈。'
    )
    
    doc.add_paragraph(
        '项目已完成 8 轮迭代，在多智能体协同、三层记忆系统、AIRI 舞台渲染等核心功能上'
        '具有较强的技术领先性，同时保持了良好的代码质量和测试覆盖率。'
    )
    
    # 保存文档 - 使用当前脚本所在目录
    import os
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_dir = os.path.dirname(script_dir)
    output_path = os.path.join(project_dir, 'docs', 'SmartAgent4_项目分析报告.docx')
    
    # 确保 docs 目录存在
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    
    doc.save(output_path)
    print(f'文档已生成: {output_path}')
    return output_path

if __name__ == '__main__':
    create_document()
