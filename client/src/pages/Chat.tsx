import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { trpc } from "@/lib/trpc";
import {
  ArrowLeft,
  Brain,
  MessageSquarePlus,
  Pencil,
  Send,
  Trash2,
} from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Streamdown } from "streamdown";
import { toast } from "sonner";
import { getLoginUrl } from "@/const";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function Chat() {
  const { user, isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<
    Array<{ role: "user" | "assistant"; content: string }>
  >([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 当前选中的会话：null = 默认（无 sessionId 的旧消息），number = 某会话 id
  const [currentSessionId, setCurrentSessionId] = useState<number | null>(null);
  // 改名弹窗
  const [renameSessionId, setRenameSessionId] = useState<number | null>(null);
  const [renameTitle, setRenameTitle] = useState("");

  const skipOAuth = import.meta.env.VITE_SKIP_OAUTH === "true";

  const utils = trpc.useUtils();

  const sendMessageMutation = trpc.chat.sendMessage.useMutation({
    onSuccess: data => {
      setMessages(prev => [
        ...prev,
        { role: "assistant", content: data.response },
      ]);
      utils.chat.listSessions.invalidate();
      if (data.persisted === false) {
        toast.warning(
          "当前对话未保存到服务器，刷新后可能丢失。请确认 MySQL 已启动且 .env 中 DATABASE_URL 已配置。"
        );
      }
    },
    onError: error => {
      toast.error("发送消息失败: " + error.message);
    },
  });

  const createSessionMutation = trpc.chat.createSession.useMutation({
    onSuccess: session => {
      if (session) {
        setCurrentSessionId(session.id);
        setMessages([]);
        hasInitialHistorySynced.current = false;
        utils.chat.listSessions.invalidate();
        toast.success("已新建会话");
      }
    },
    onError: () => toast.error("新建会话失败"),
  });

  const updateSessionMutation = trpc.chat.updateSession.useMutation({
    onSuccess: () => {
      setRenameSessionId(null);
      utils.chat.listSessions.invalidate();
      toast.success("已改名");
    },
    onError: () => toast.error("改名失败"),
  });

  const deleteSessionMutation = trpc.chat.deleteSession.useMutation({
    onSuccess: (_, variables) => {
      if (currentSessionId === variables.id) {
        setCurrentSessionId(null);
        setMessages([]);
        hasInitialHistorySynced.current = false;
      }
      utils.chat.listSessions.invalidate();
      toast.success("已删除会话");
    },
    onError: () => toast.error("删除失败"),
  });

  const { data: sessions = [] } = trpc.chat.listSessions.useQuery(undefined, {
    enabled: isAuthenticated || skipOAuth,
  });

  const { data: history } = trpc.chat.getHistory.useQuery(
    { limit: 50, sessionId: currentSessionId },
    { enabled: isAuthenticated || skipOAuth }
  );

  const hasInitialHistorySynced = useRef(false);

  useEffect(() => {
    if (!skipOAuth && !isAuthenticated) {
      const loginUrl = getLoginUrl();
      if (loginUrl) window.location.href = loginUrl;
    }
  }, [isAuthenticated, skipOAuth]);

  useEffect(() => {
    if (!history) return;
    if (!hasInitialHistorySynced.current) {
      hasInitialHistorySynced.current = true;
      if (history.length > 0) {
        setMessages(
          history.map(conv => ({
            role: conv.role as "user" | "assistant",
            content: conv.content,
          }))
        );
      } else {
        setMessages([]);
      }
    }
  }, [history]);

  // 切换会话时重置同步标记，让上面的 effect 用新 session 的 history 再跑一次
  useEffect(() => {
    hasInitialHistorySynced.current = false;
  }, [currentSessionId]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = () => {
    if (!message.trim() || sendMessageMutation.isPending) return;
    const userMessage = message.trim();
    setMessage("");
    setMessages(prev => [...prev, { role: "user", content: userMessage }]);
    sendMessageMutation.mutate({
      message: userMessage,
      sessionId: currentSessionId ?? undefined,
    });
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleNewSession = () => {
    createSessionMutation.mutate({});
  };

  const handleSelectSession = (id: number | null) => {
    setCurrentSessionId(id);
    hasInitialHistorySynced.current = false;
  };

  const handleRename = (id: number, title: string) => {
    setRenameSessionId(id);
    setRenameTitle(title);
  };

  const handleRenameSubmit = () => {
    if (renameSessionId != null && renameTitle.trim()) {
      updateSessionMutation.mutate({ id: renameSessionId, title: renameTitle.trim() });
    }
  };

  const handleDelete = (id: number) => {
    if (window.confirm("确定删除该会话？删除后无法恢复。")) {
      deleteSessionMutation.mutate({ id });
    }
  };

  const displayName = user?.name || (skipOAuth ? "测试用户" : "");
  const userAvatarLetter = displayName ? displayName.charAt(0).toUpperCase() : "?";

  if (!skipOAuth && !isAuthenticated) return null;

  return (
    <div className="min-h-screen flex flex-col bg-muted/30">
      <header className="border-b bg-background/95 backdrop-blur shrink-0">
        <div className="container flex h-14 items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="flex gap-2 items-center">
            <Brain className="h-6 w-6 text-primary" />
            <span className="font-bold">SmartAgent</span>
          </div>
          <div className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-medium">
              {userAvatarLetter}
            </div>
            {displayName}
            {skipOAuth && (
              <span className="text-xs bg-yellow-100 dark:bg-yellow-900 px-2 py-0.5 rounded">
                测试模式
              </span>
            )}
          </div>
        </div>
      </header>

      <div className="flex-1 flex min-h-0">
        {/* 会话列表侧栏 */}
        <aside className="w-56 border-r bg-background/50 flex flex-col shrink-0">
          <div className="p-2 border-b">
            <Button
              variant="outline"
              className="w-full justify-start gap-2"
              onClick={handleNewSession}
              disabled={createSessionMutation.isPending}
            >
              <MessageSquarePlus className="h-4 w-4" />
              新建会话
            </Button>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              <button
                type="button"
                onClick={() => handleSelectSession(null)}
                className={`w-full text-left px-3 py-2 rounded-md text-sm truncate ${
                  currentSessionId === null
                    ? "bg-primary/10 text-primary"
                    : "hover:bg-muted"
                }`}
              >
                默认会话
              </button>
              {sessions.map(s => (
                <div
                  key={s.id}
                  className={`group flex items-center gap-1 rounded-md text-sm ${
                    currentSessionId === s.id ? "bg-primary/10 text-primary" : "hover:bg-muted"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => handleSelectSession(s.id)}
                    className="flex-1 min-w-0 px-3 py-2 truncate text-left"
                  >
                    {s.title}
                  </button>
                  <div className="flex opacity-0 group-hover:opacity-100 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => handleRename(s.id, s.title)}
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive"
                      onClick={() => handleDelete(s.id)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </aside>

        {/* 主聊天区 */}
        <main className="flex-1 flex flex-col min-w-0 container max-w-3xl py-4">
          <ScrollArea className="flex-1 pr-4" ref={scrollRef}>
            <div className="space-y-6">
              {messages.length === 0 && (
                <div className="text-center py-12">
                  <Brain className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
                  <h2 className="text-xl font-semibold mb-2">开始对话</h2>
                  <p className="text-muted-foreground text-sm">
                    我是你的智能助手，有什么可以帮你的吗？
                  </p>
                </div>
              )}

              {messages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  {msg.role === "assistant" && (
                    <div className="flex-shrink-0 w-9 h-9 rounded-full bg-primary flex items-center justify-center">
                      <Brain className="h-5 w-5 text-primary-foreground" />
                    </div>
                  )}

                  <Card
                    className={`max-w-[80%] p-4 break-words ${
                      msg.role === "user" ? "bg-primary text-primary-foreground" : ""
                    }`}
                  >
                    {msg.role === "assistant" ? (
                      <Streamdown className="prose prose-sm dark:prose-invert max-w-none break-words">
                        {msg.content}
                      </Streamdown>
                    ) : (
                      <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                    )}
                  </Card>

                  {msg.role === "user" && (
                    <div
                      className="flex-shrink-0 w-9 h-9 rounded-full bg-primary/20 flex items-center justify-center text-primary font-medium"
                      title={displayName}
                    >
                      {userAvatarLetter}
                    </div>
                  )}
                </div>
              ))}

              {sendMessageMutation.isPending && (
                <div className="flex gap-3">
                  <div className="flex-shrink-0 w-9 h-9 rounded-full bg-primary flex items-center justify-center">
                    <Brain className="h-5 w-5 text-primary-foreground" />
                  </div>
                  <Card className="p-4">
                    <div className="flex gap-1">
                      {[0, 150, 300].map(d => (
                        <div
                          key={d}
                          className="w-2 h-2 rounded-full bg-muted-foreground animate-bounce"
                          style={{ animationDelay: `${d}ms` }}
                        />
                      ))}
                    </div>
                  </Card>
                </div>
              )}
            </div>
          </ScrollArea>

          <div className="mt-4 flex gap-2">
            <Input
              ref={inputRef}
              value={message}
              onChange={e => setMessage(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="输入消息..."
              disabled={sendMessageMutation.isPending}
              className="flex-1"
            />
            <Button
              onClick={handleSend}
              disabled={!message.trim() || sendMessageMutation.isPending}
              size="icon"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </main>
      </div>

      {/* 改名弹窗 */}
      <Dialog open={renameSessionId != null} onOpenChange={open => !open && setRenameSessionId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重命名会话</DialogTitle>
          </DialogHeader>
          <Input
            value={renameTitle}
            onChange={e => setRenameTitle(e.target.value)}
            placeholder="会话名称"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameSessionId(null)}>
              取消
            </Button>
            <Button onClick={handleRenameSubmit} disabled={!renameTitle.trim()}>
              确定
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
