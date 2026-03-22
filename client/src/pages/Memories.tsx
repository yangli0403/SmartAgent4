import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Brain, Trash2, Plus, RefreshCw } from "lucide-react";

type MemoryKind = "episodic" | "semantic" | "persona";
type MemoryType = "fact" | "behavior" | "preference" | "emotion";

type MemoryItem = {
  id: number;
  kind: MemoryKind;
  type: MemoryType;
  content: string;
  importance?: number | null;
  createdAt?: string | null;
  versionGroup?: string | null;
};

const PERSONA_GROUP_NONE = "__none__";

function useMemoryList(kind: MemoryKind) {
  const query = trpc.memory.list.useQuery({ kind, limit: 100 });
  return query as typeof query & { data: MemoryItem[] | undefined };
}

export default function Memories() {
  const { isAuthenticated } = useAuth();

  useEffect(() => {
    if (!isAuthenticated) {
      const u = getLoginUrl();
      if (u) window.location.href = u;
    }
  }, [isAuthenticated]);

  const episodicQuery = useMemoryList("episodic");
  const semanticQuery = useMemoryList("semantic");
  const personaQuery = useMemoryList("persona");

  const utils = trpc.useUtils();
  const createMutation = trpc.memory.create.useMutation({
    onSuccess: (data, variables) => {
      const input = { kind: variables.kind, limit: 100 };
      // 乐观更新：立即把新项插入对应类型的列表，这样不用等接口刷新就能看到
      if (data && variables.kind) {
        utils.memory.list.setData(input, ((prev: any) =>
          prev ? [data, ...prev] : [data]
        ) as any);
      }
      utils.memory.list.invalidate();
      if (variables.kind) {
        utils.memory.list.invalidate(input);
      }
    },
    onError: e => toast.error("保存记忆失败：" + e.message),
  });
  const deleteMutation = trpc.memory.delete.useMutation({
    onSuccess: () => {
      utils.memory.list.invalidate();
    },
    onError: e => toast.error("删除记忆失败：" + e.message),
  });

  const [newContent, setNewContent] = useState("");
  const [newType, setNewType] = useState<MemoryType>("fact");
  const [personaVersionGroup, setPersonaVersionGroup] = useState<string>(PERSONA_GROUP_NONE);

  if (!isAuthenticated) return null;

  const handleAdd = async (kind: MemoryKind, extra?: { versionGroup?: string }) => {
    if (!newContent.trim()) {
      toast.error("请输入记忆内容");
      return;
    }
    const content = newContent.trim();
    try {
      const data = await createMutation.mutateAsync({
        kind,
        type: newType,
        content,
        versionGroup: extra?.versionGroup || undefined,
      });
      setNewContent("");
      const label = kind === "persona" ? "人格记忆" : kind === "episodic" ? "情景记忆" : "语义记忆";
      const snippet = content.length > 20 ? content.slice(0, 20) + "…" : content;
      if (data) {
        // 保存成功且返回了数据，乐观更新已由 onSuccess 处理；再拉一次列表并提示条数
        const list = await utils.memory.list.fetch({ kind, limit: 100 });
        const count = list?.length ?? 0;
        toast.success(`已添加${label}：${snippet}（当前共 ${count} 条）`);
      } else {
        toast.warning(`已提交保存，若列表未更新请点击「刷新列表」`);
      }
    } catch {
      // onError 已展示错误信息，此处不再重复
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("确定删除这条记忆？")) return;
    await deleteMutation.mutateAsync({ id });
    toast.success("已删除");
  };

  const renderList = (query: { isLoading: boolean; error: unknown; data: MemoryItem[] | undefined }, _title?: string) => {
    if (query.isLoading) return <p className="text-sm text-muted-foreground">加载中...</p>;
    if (query.error) return <p className="text-sm text-destructive">加载失败</p>;
    if (!query.data || query.data.length === 0)
      return (
        <p className="text-sm text-muted-foreground">
          暂无此类记忆，可通过下方表单新建。若刚保存未出现，请点击右上角「刷新列表」。
        </p>
      );

    return (
      <div className="space-y-2">
        {query.data.map(mem => (
          <div
            key={mem.id}
            className="flex items-start justify-between rounded-md border bg-card px-3 py-2 text-sm"
          >
            <div>
              <div className="mb-1 inline-flex items-center gap-2">
                <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                  {mem.type}
                </span>
                {mem.versionGroup && (
                  <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                    {mem.versionGroup}
                  </span>
                )}
              </div>
              <p className="whitespace-pre-wrap leading-relaxed">{mem.content}</p>
              <div className="mt-1 text-xs text-muted-foreground flex flex-wrap gap-2">
                <span>重要性 {Number(mem.importance ?? 0.5).toFixed(2)}</span>
                {mem.createdAt && (
                  <span>{new Date(mem.createdAt).toLocaleString("zh-CN")}</span>
                )}
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="ml-2 shrink-0"
              onClick={() => handleDelete(mem.id)}
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card/40 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <Link href="/">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div className="flex items-center gap-2">
              <Brain className="h-5 w-5 text-primary" />
              <h1 className="text-xl font-semibold">记忆中心</h1>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              utils.memory.list.invalidate();
              toast.success("已刷新列表");
            }}
          >
            <RefreshCw className="mr-1 h-4 w-4" />
            刷新列表
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6">
        <Tabs defaultValue="episodic">
          <TabsList>
            <TabsTrigger value="episodic">情景记忆</TabsTrigger>
            <TabsTrigger value="semantic">语义记忆</TabsTrigger>
            <TabsTrigger value="persona">人格记忆</TabsTrigger>
          </TabsList>

          <TabsContent value="episodic" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>情景记忆</CardTitle>
                <CardDescription>记录发生过的具体事件，如某天的加班、一次出行等。</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {renderList(episodicQuery, "当前情景记忆")}
                <div className="mt-4 space-y-2 border-t pt-4">
                  <Label>新增情景记忆</Label>
                  <Textarea
                    rows={3}
                    value={newContent}
                    onChange={e => setNewContent(e.target.value)}
                    placeholder="例如：2026-02-02 晚上我加班到 23:30。"
                  />
                  <div className="flex items-center justify-between gap-3 pt-1">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>类型：</span>
                      <Select value={newType} onValueChange={v => setNewType(v as MemoryType)}>
                        <SelectTrigger className="h-7 w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="fact">事实</SelectItem>
                          <SelectItem value="behavior">行为</SelectItem>
                          <SelectItem value="preference">偏好</SelectItem>
                          <SelectItem value="emotion">情绪</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Button size="sm" onClick={() => handleAdd("episodic")}>
                      <Plus className="mr-1 h-4 w-4" />
                      保存
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="semantic" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>语义记忆</CardTitle>
                <CardDescription>
                  记录长期偏好、习惯和知识，例如喜欢的饮品、常用路线等。
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {renderList(semanticQuery)}
                <div className="mt-4 space-y-2 border-t pt-4">
                  <Label>新增语义记忆</Label>
                  <Textarea
                    rows={3}
                    value={newContent}
                    onChange={e => setNewContent(e.target.value)}
                    placeholder="例如：我非常喜欢喝咖啡，尤其是拿铁。"
                  />
                  <div className="flex items-center justify-between gap-3 pt-1">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>类型：</span>
                      <Select value={newType} onValueChange={v => setNewType(v as MemoryType)}>
                        <SelectTrigger className="h-7 w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="fact">事实</SelectItem>
                          <SelectItem value="behavior">行为</SelectItem>
                          <SelectItem value="preference">偏好</SelectItem>
                          <SelectItem value="emotion">情绪</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Button size="sm" onClick={() => handleAdd("semantic")}>
                      <Plus className="mr-1 h-4 w-4" />
                      保存
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="persona" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>人格记忆</CardTitle>
                <CardDescription>
                  记录你的自我描述、称呼方式、职业与兴趣等用户画像信息，主聊天会据此个性化称呼和建议。与 AI 对话时，系统也会自动从对话中提炼人格类信息并写入此处；保存后列表会自动刷新。
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {renderList(personaQuery, "当前人格记忆")}
                <div className="mt-4 space-y-2 border-t pt-4">
                  <Label>新增人格记忆</Label>
                  <Textarea
                    rows={3}
                    value={newContent}
                    onChange={e => setNewContent(e.target.value)}
                    placeholder="例如：我叫张三，你可以叫我小李。/ 我是一名产品经理，在北京工作。/ 我平时最喜欢打篮球和看科幻电影。"
                  />
                  <div className="flex flex-col gap-2 pt-1 text-xs text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <span>主题分组（可选）：</span>
                      <Select
                        value={personaVersionGroup}
                        onValueChange={v => setPersonaVersionGroup(v)}
                      >
                        <SelectTrigger className="h-7 w-44">
                          <SelectValue placeholder="自动分组" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={PERSONA_GROUP_NONE}>自动分组</SelectItem>
                          <SelectItem value="user_profile_basic">基础画像（姓名/职业/位置）</SelectItem>
                          <SelectItem value="user_preferred_name">偏好称呼</SelectItem>
                          <SelectItem value="user_interests">长期兴趣</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>
                        建议用自然语言描述，例如「我叫……」「我是……」「我喜欢……」。
                      </span>
                      <Button
                        size="sm"
                        className="ml-3"
                        onClick={() =>
                          handleAdd("persona", {
                            versionGroup: personaVersionGroup === PERSONA_GROUP_NONE ? undefined : personaVersionGroup,
                          })
                        }
                      >
                        <Plus className="mr-1 h-4 w-4" />
                        保存
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
