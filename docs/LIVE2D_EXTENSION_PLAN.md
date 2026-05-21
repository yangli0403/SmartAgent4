# SmartAgent4 Live2D 模型扩展方案
## 基于时间/预算/人力约束的可行性分析

**编写日期**：2026年5月21日  
**约束条件**：1个月时间 | 无预算 | 无设计师 | 使用开源 Airi 项目  
**项目周期**：2026年5月21日 - 2026年6月20日（30天）  
**采用方案**：方案 B（参数驱动优化）  
**预计完成日期**：2026年5月28日（第 7 天）

---

## 一、现状分析

### 1.1 当前模型限制

通过分析 SmartAgent4 项目代码，发现：

| 指标 | 现状 |
|------|------|
| 使用模型 | Haru Greeter (`haru_greeter_t03`) - Cubism 4 |
| Motion Group 数量 | 2 个（Idle、Tap） |
| 物理动作总数 | 5 个 |
| 表情参数 | 16 种 |
| 当前映射的语义动作 | 12 个（但都映射到同样的 5 个物理动作） |

### 1.2 motionMapping.ts 现有映射

```typescript
// 基础动作（都映射到 Tap group）
nod, wave, shake_head, bow, head_tilt, thumbs_up, clap, shrug

// 强反馈动作（都映射到 Tap group）
listen_ear_forward, think_chin_touch, operate_virtual_panel, 
explain_with_hand, confirm_ok, error_shrug

// 闲置动作（映射到 Idle group）
idle_breathe, idle_sway
```

**问题**：所有新动作标签（如 `spin`, `jump`, `facepalm`）都需要映射到这 5 个物理动作，无法真实呈现复杂表演。

---

## 二、可行方案对比

### 方案 A：短期快速方案（推荐立即实施）
**时间成本**：1-2 天  
**难度**：低  
**效果**：系统不报错，动作能播放  

#### 实现步骤

1. **扩展 motionMapping.ts**，为新动作添加映射

```typescript
export const MOTION_MAPPING: MotionMappingConfig = {
  // 原有动作...
  
  // ==================== Action Agent 新增动作 ====================
  
  // 舞蹈表演相关
  spin: {
    name: "转圈",
    group: "Tap",
    index: 1,
    priority: 3,
  },
  
  jump: {
    name: "跳跃",
    group: "Tap",
    index: 0,
    priority: 3,
  },
  
  // 惊讶相关
  step_back: {
    name: "后退一步",
    group: "Tap",
    index: 1,
    priority: 2,
  },
  
  // 思考相关
  facepalm: {
    name: "捂脸",
    group: "Tap",
    index: 0,
    priority: 2,
  },
  
  // 其他表演动作
  open_palms: {
    name: "摊开双手",
    group: "Tap",
    index: 1,
    priority: 1,
  },
  
  stand_tall: {
    name: "挺胸站立",
    group: "Tap",
    index: 0,
    priority: 1,
  },
  
  lean_forward: {
    name: "身体前倾",
    group: "Tap",
    index: 1,
    priority: 1,
  },
  
  lean_back: {
    name: "身体后仰",
    group: "Tap",
    index: 0,
    priority: 1,
  },
};
```

#### 优点
- ✅ 快速实施，1-2 天完成
- ✅ 系统不会报错或崩溃
- ✅ 动作能正常播放（虽然视觉效果有限）
- ✅ 为后续方案奠定基础

#### 缺点
- ❌ 所有新动作都映射到相同的几个物理动作
- ❌ 视觉效果单调，难以区分不同动作
- ❌ 用户体验受限

---

### 方案 B：参数驱动方案（推荐 1-2 周内实施）
**时间成本**：3-5 天  
**难度**：中等  
**效果**：通过表情参数组合模拟不同动作  

#### 核心思路

Live2D 模型除了 Motion Group 外，还有大量**参数（Parameter）**可以控制。Haru 模型包含以下参数：

- `ParamAngleX`, `ParamAngleY`, `ParamAngleZ`：头部旋转
- `ParamEyeBallX`, `ParamEyeBallY`：眼球方向
- `ParamBodyAngleX`, `ParamBodyAngleY`：身体旋转
- `ParamMouthOpenY`：嘴部张开度
- 等等

#### 实现步骤

1. **创建参数组合库** `parameterCombinations.ts`

```typescript
/**
 * 通过参数组合模拟复杂动作
 * 这些参数组合与 Motion 配合使用，可以产生更丰富的视觉效果
 */

export const PARAMETER_COMBINATIONS = {
  // 舞蹈 - 转圈
  spin: {
    description: "转圈动作 - 通过身体旋转参数模拟",
    parameters: {
      ParamBodyAngleY: { target: 30, duration: 300 }, // 身体向右转
      ParamAngleY: { target: 25, duration: 300 },     // 头部跟随
    },
    motionFallback: { group: "Tap", index: 1 },
  },
  
  // 舞蹈 - 跳跃
  jump: {
    description: "跳跃动作 - 通过身体Y轴位移模拟",
    parameters: {
      ParamBodyAngleX: { target: -5, duration: 200 }, // 身体微微前倾
    },
    motionFallback: { group: "Tap", index: 0 },
  },
  
  // 惊讶 - 后退
  step_back: {
    description: "后退一步 - 通过身体缩放模拟距离感",
    parameters: {
      ParamBodyAngleX: { target: 5, duration: 300 },  // 身体后仰
    },
    motionFallback: { group: "Tap", index: 1 },
  },
  
  // 思考 - 捂脸
  facepalm: {
    description: "捂脸动作 - 通过眼球和头部参数模拟",
    parameters: {
      ParamAngleX: { target: 15, duration: 200 },     // 头部向下
      ParamEyeBallX: { target: -0.5, duration: 200 }, // 眼球向下看
    },
    motionFallback: { group: "Tap", index: 0 },
  },
  
  // 思考 - 身体前倾
  lean_forward: {
    description: "身体前倾 - 思考姿态",
    parameters: {
      ParamBodyAngleX: { target: -15, duration: 300 }, // 身体前倾
      ParamAngleX: { target: -10, duration: 300 },     // 头部跟随
    },
    motionFallback: { group: "Tap", index: 1 },
  },
  
  // 思考 - 身体后仰
  lean_back: {
    description: "身体后仰 - 放松/如释重负",
    parameters: {
      ParamBodyAngleX: { target: 20, duration: 300 },  // 身体后仰
      ParamAngleX: { target: 15, duration: 300 },      // 头部跟随
    },
    motionFallback: { group: "Tap", index: 0 },
  },
};
```

2. **修改 AiriDemo.tsx 中的动作处理逻辑**

```typescript
const onMotion = async (event: any) => {
  const model = modelRef.current;
  if (!model) return;

  const def = getMotionDef(event.motion);
  const paramCombo = PARAMETER_COMBINATIONS[event.motion];
  
  try {
    setCurrentMotion(event.motion, event.priority ?? 1);
    
    // 如果有参数组合，先应用参数
    if (paramCombo && model.internalModel?.coreModel) {
      const coreModel = model.internalModel.coreModel;
      for (const [paramName, config] of Object.entries(paramCombo.parameters)) {
        // 使用 LERP 平滑过渡参数
        animateParameter(coreModel, paramName, config.target, config.duration);
      }
    }
    
    // 然后播放 Motion
    if (def) {
      await model.motion(def.group, def.index, def.priority);
    } else if (paramCombo?.motionFallback) {
      await model.motion(paramCombo.motionFallback.group, paramCombo.motionFallback.index);
    } else {
      await model.motion("Tap", 0);
    }
    
    finishMotion();
  } catch {
    finishMotion();
  }
};
```

#### 优点
- ✅ 时间可控（3-5 天）
- ✅ 无需设计师或新模型
- ✅ 视觉效果明显改善
- ✅ 参数组合可无限扩展
- ✅ 完全利用现有 Haru 模型的潜力

#### 缺点
- ❌ 仍然受限于 Haru 模型的参数集
- ❌ 某些复杂动作（如真实的舞蹈）仍无法完美呈现
- ❌ 需要对 Live2D 参数有一定理解

---

### 方案 C：开源模型替换方案（推荐 2-3 周内实施）
**时间成本**：1-2 周  
**难度**：中等  
**效果**：使用更丰富的开源 Live2D 模型  

#### 可用的开源 Live2D 模型

| 模型名称 | 来源 | Motion Group | 特点 | 难度 |
|---------|------|-------------|------|------|
| **Hiyori** | pixi-live2d-display 官方 | Idle, Tap, Flick | 比 Haru 稍丰富 | 低 |
| **Mao** | Cubism SDK 示例 | Idle, Tap, Shake | 动作较多 | 低 |
| **Airi** | Airi 开源项目 | 多个（需确认） | 专为 AI 助手设计 | 中 |
| **Kohaku** | 社区模型 | 多个 | 高质量 | 中 |
| **Pio** | 开源项目 | 多个 | 可定制 | 高 |

#### 实现步骤

1. **下载并测试 Airi 项目中的模型**

```bash
# 克隆 Airi 项目
git clone https://github.com/airi-project/airi.git

# 查找 Live2D 模型文件
find airi -name "*.model3.json" -o -name "*.model.json"

# 查看模型的 Motion Group 定义
# 通常在 model3.json 中的 FileReferences.Motions 字段
```

2. **提取模型并集成到 SmartAgent4**

```bash
# 复制模型到项目
cp -r airi/models/your-model /home/ubuntu/SmartAgent4/public/models/

# 更新模型 URL
# 在 AiriDemo.tsx 中修改 MODEL_URL
const MODEL_URL = "/models/your-model/model.model3.json";
```

3. **分析新模型的 Motion Group 并更新 motionMapping.ts**

```typescript
// 假设新模型有以下 Motion Group
export const MOTION_MAPPING: MotionMappingConfig = {
  // 基础动作
  nod: {
    name: "点头",
    group: "Idle",  // 可能不同
    index: 0,
    priority: 2,
  },
  
  // 新增动作（利用新模型的额外 Group）
  spin: {
    name: "转圈",
    group: "Dance",  // 新模型可能有 Dance group
    index: 0,
    priority: 3,
  },
  
  jump: {
    name: "跳跃",
    group: "Dance",
    index: 1,
    priority: 3,
  },
  
  // ... 其他动作
};
```

#### 优点
- ✅ 使用现成的开源模型，无需设计
- ✅ 获得更多的 Motion Group 和动作
- ✅ 视觉效果显著提升
- ✅ 时间可控（1-2 周）

#### 缺点
- ❌ 需要测试和验证新模型的兼容性
- ❌ 可能需要调整前端渲染参数（缩放、位置等）
- ❌ 模型风格可能与现有 UI 不匹配

---

### 方案 D：完全定制方案（不推荐，超出时间预算）
**时间成本**：4-8 周  
**难度**：高  
**效果**：完全自定义的 Live2D 模型  

#### 步骤概述
1. 使用 Live2D Cubism 编辑器创建或修改模型
2. 添加新的 Motion Group（舞蹈、惊讶、思考等）
3. 为每个 Group 创建多个动作文件
4. 导出为 model3.json 格式
5. 集成到 SmartAgent4

#### 为什么不推荐
- ❌ 需要 Live2D 专业设计师（无预算）
- ❌ 需要购买 Live2D Cubism 编辑器许可证
- ❌ 时间成本过高（4-8 周）
- ❌ 学习曲线陡峭

---

## 三、推荐实施路线

### 第一阶段（第 1-2 天）：方案 A - 快速映射
**目标**：确保系统不报错，所有新动作都能播放

```typescript
// 在 motionMapping.ts 中添加新动作映射
// 所有新动作暂时映射到 Tap group 的现有动作
```

**验证**：
```bash
# 在 AiriDemo 页面测试新动作
# 确认没有控制台错误
```

### 第二阶段（第 3-7 天）：方案 B - 参数驱动优化
**目标**：通过参数组合改善视觉效果

```typescript
// 创建 parameterCombinations.ts
// 修改动作处理逻辑以支持参数动画
```

**验证**：
```bash
# 测试参数组合的平滑过渡
# 对比参数驱动前后的视觉效果
```

### 第三阶段（第 8-14 天）：方案 C - 开源模型探索（可选）
**目标**：评估是否有更好的开源模型可用

```bash
# 下载并测试 Airi 项目中的模型
# 分析其 Motion Group 结构
# 如果可行，集成到 SmartAgent4
```

### 第四阶段（第 15-30 天）：Action Agent 核心功能
**目标**：完成 Action Agent 的完整实现

- 实现 actionAgent.json 和 ActionAgent.ts
- 更新分类器 Prompt
- 端到端测试所有动作编排

---

## 四、技术细节

### 4.1 如何查看 Live2D 模型的 Motion Group

```typescript
// 在 AiriDemo.tsx 的模型加载完成后
if (model.internalModel?.motionManager) {
  const settings = (model.internalModel as any).settings;
  const motionGroups = Object.keys(settings?.motions || {});
  console.log("Available Motion Groups:", motionGroups);
  
  // 打印每个 Group 的动作数
  for (const group of motionGroups) {
    const motions = settings.motions[group];
    console.log(`${group}: ${motions.length} motions`);
  }
}
```

### 4.2 参数动画的实现

```typescript
/**
 * 平滑动画参数变化
 */
function animateParameter(
  coreModel: any,
  paramName: string,
  targetValue: number,
  duration: number
) {
  const startValue = coreModel.getParameterValueById(paramName) || 0;
  const startTime = Date.now();
  
  const animate = () => {
    const elapsed = Date.now() - startTime;
    const progress = Math.min(elapsed / duration, 1);
    
    // 使用 easing 函数（例如 easeInOutQuad）
    const eased = progress < 0.5
      ? 2 * progress * progress
      : -1 + (4 - 2 * progress) * progress;
    
    const currentValue = startValue + (targetValue - startValue) * eased;
    coreModel.setParameterValueById(paramName, currentValue);
    
    if (progress < 1) {
      requestAnimationFrame(animate);
    }
  };
  
  animate();
}
```

### 4.3 模型兼容性检查

```typescript
/**
 * 在模型加载时进行兼容性检查
 */
function validateModelCompatibility(model: any): {
  hasGroup: (group: string) => boolean;
  hasParameter: (param: string) => boolean;
  getMotionCount: (group: string) => number;
} {
  const settings = (model.internalModel as any).settings;
  
  return {
    hasGroup: (group: string) => !!settings?.motions?.[group],
    hasParameter: (param: string) => {
      // 尝试读取参数值
      try {
        model.internalModel.coreModel.getParameterValueById(param);
        return true;
      } catch {
        return false;
      }
    },
    getMotionCount: (group: string) => settings?.motions?.[group]?.length || 0,
  };
}
```

---

## 五、成本-收益分析

| 方案 | 时间 | 难度 | 视觉效果 | 推荐度 |
|------|------|------|--------|--------|
| **A - 快速映射** | 1-2 天 | 低 | ⭐⭐ | ✅ 必做 |
| **B - 参数驱动** | 3-5 天 | 中 | ⭐⭐⭐⭐ | ✅ 强烈推荐 |
| **C - 模型替换** | 1-2 周 | 中 | ⭐⭐⭐⭐⭐ | ⚠️ 可选 |
| **D - 完全定制** | 4-8 周 | 高 | ⭐⭐⭐⭐⭐ | ❌ 不推荐 |

---

## 六、立即行动清单

### ✅ 第一步（今天）
- [ ] 在 motionMapping.ts 中添加新动作映射（方案 A）
- [ ] 在 AiriDemo 页面测试新动作
- [ ] 确认没有控制台错误

### ✅ 第二步（明天-后天）
- [ ] 创建 parameterCombinations.ts
- [ ] 实现参数动画逻辑（方案 B）
- [ ] 测试参数组合的视觉效果

### ✅ 第三步（可选，第 8-14 天）
- [ ] 下载并分析 Airi 项目中的模型
- [ ] 评估是否值得替换（方案 C）

### ✅ 第四步（第 15-30 天）
- [ ] 实现 Action Agent 核心功能
- [ ] 端到端测试所有动作编排

---

## 七、参考资源

### Live2D 官方文档
- [Cubism SDK for Web](https://github.com/Live2D/CubismWebFramework)
- [pixi-live2d-display](https://github.com/guansss/pixi-live2d-display)

### 开源模型项目
- [Airi 项目](https://github.com/airi-project/airi)
- [pixi-live2d-display 示例模型](https://github.com/guansss/pixi-live2d-display/tree/master/test/assets)

### 参数参考
- Cubism 4 标准参数列表
- Haru 模型的具体参数定义（在 model3.json 中）

---

## 总结

**基于您的约束条件（1个月、无预算、无设计师），最优路线是：**

1. **立即实施方案 A**（1-2 天）：快速映射新动作，确保系统稳定
2. **随后实施方案 B**（3-5 天）：参数驱动优化，显著改善视觉效果
3. **可选方案 C**（1-2 周）：如果发现更好的开源模型，进行替换
4. **专注 Action Agent 核心**（15-30 天）：完成整个功能的实现和测试

这样可以在 1 个月内完成一个**功能完整、视觉效果良好的 Action Agent**，同时保持开发成本最低。
