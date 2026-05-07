import { useAuth } from "@/_core/hooks/useAuth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { getLoginUrl } from "@/const";
import { useIsMobile } from "@/hooks/useMobile";
import { LayoutDashboard, LogOut, PanelLeft, Users } from "lucide-react";
import { CSSProperties, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";
import { Button } from "./ui/button";
import { Switch } from "./ui/switch";

const menuItems = [
  { icon: LayoutDashboard, label: "Page 1", path: "/" },
  { icon: Users, label: "Page 2", path: "/some-path" },
];

const SIDEBAR_WIDTH_KEY = "sidebar-width";
const VOICE_MODE_KEY = "voice-mode";
const ASR_MODE_KEY = "asr-mode";
const TTS_MODE_KEY = "tts-mode";
const DEFAULT_WIDTH = 280;
const MIN_WIDTH = 200;
const MAX_WIDTH = 480;

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    return saved ? parseInt(saved, 10) : DEFAULT_WIDTH;
  });
  const { loading, user } = useAuth();

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, sidebarWidth.toString());
  }, [sidebarWidth]);

  if (loading) {
    return <DashboardLayoutSkeleton />;
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="flex flex-col items-center gap-8 p-8 max-w-md w-full">
          <div className="flex flex-col items-center gap-6">
            <h1 className="text-2xl font-semibold tracking-tight text-center">
              Sign in to continue
            </h1>
            <p className="text-sm text-muted-foreground text-center max-w-sm">
              Access to this dashboard requires authentication. Continue to
              launch the login flow.
            </p>
          </div>
          <Button
            onClick={() => {
              const url = getLoginUrl();
              if (url) window.location.href = url;
            }}
            size="lg"
            className="w-full shadow-lg hover:shadow-xl transition-all"
          >
            Sign in
          </Button>
        </div>
      </div>
    );
  }

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": `${sidebarWidth}px`,
        } as CSSProperties
      }
    >
      <DashboardLayoutContent setSidebarWidth={setSidebarWidth}>
        {children}
      </DashboardLayoutContent>
    </SidebarProvider>
  );
}

type DashboardLayoutContentProps = {
  children: React.ReactNode;
  setSidebarWidth: (width: number) => void;
};

function DashboardLayoutContent({
  children,
  setSidebarWidth,
}: DashboardLayoutContentProps) {
  const { user, logout } = useAuth();
  const [location, setLocation] = useLocation();
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const activeMenuItem = menuItems.find(item => item.path === location);
  const isMobile = useIsMobile();
  const [asrMode, setAsrModeState] = useState<"cloud" | "local">("cloud");
  const [ttsMode, setTtsModeState] = useState<"cloud" | "local">("cloud");
  const [syncingVoiceMode, setSyncingVoiceMode] = useState(false);

  useEffect(() => {
    // 尝试从 localStorage 恢复（仅作为快速 UI 初始化）
    const savedAsr = localStorage.getItem(ASR_MODE_KEY);
    const savedTts = localStorage.getItem(TTS_MODE_KEY);
    if (savedAsr === "cloud" || savedAsr === "local") setAsrModeState(savedAsr);
    if (savedTts === "cloud" || savedTts === "local") setTtsModeState(savedTts);

    // 从后端同步最新值（优先）
    void fetch("/api/voice-mode")
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (data?.mode === "cloud" || data?.mode === "local") {
          setAsrModeState(data.mode);
          localStorage.setItem(ASR_MODE_KEY, data.mode);
        }
        if (data?.ttsMode === "cloud" || data?.ttsMode === "local") {
          setTtsModeState(data.ttsMode);
          localStorage.setItem(TTS_MODE_KEY, data.ttsMode);
        }
      })
      .catch(() => {
        // ignore mode bootstrap failures in UI
      });
  }, []);

  const updateVoiceMode = async (next: "cloud" | "local") => {
    setSyncingVoiceMode(true);
    try {
      if (next === "local") {
        // 切换到本地前，先检查本地语音服务是否在运行
        try {
          const healthRes = await fetch("http://127.0.0.1:8001/health", {
            method: "GET",
            signal: AbortSignal.timeout(3000),
          });
          if (!healthRes.ok) {
            throw new Error("Service unavailable");
          }
        } catch {
          alert(
            "本地语音服务未启动，请先运行：\n\ncd D:\\DEMO\\SmartAgent4_demo\\local-voice-service\npython main.py\n\n或者双击运行 start-local-voice.bat"
          );
          setSyncingVoiceMode(false);
          return;
        }
      }

      const res = await fetch("/api/voice-mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asrMode: next, ttsMode: next }),
      });
      if (!res.ok) throw new Error("voice mode update failed");
      setAsrModeState(next);
      setTtsModeState(next);
      localStorage.setItem(ASR_MODE_KEY, next);
      localStorage.setItem(TTS_MODE_KEY, next);
    } catch {
      // keep old mode on request failure
    } finally {
      setSyncingVoiceMode(false);
    }
  };

  useEffect(() => {
    if (isCollapsed) {
      setIsResizing(false);
    }
  }, [isCollapsed]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;

      const sidebarLeft = sidebarRef.current?.getBoundingClientRect().left ?? 0;
      const newWidth = e.clientX - sidebarLeft;
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) {
        setSidebarWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, setSidebarWidth]);

  return (
    <>
      <div className="relative" ref={sidebarRef}>
        <Sidebar
          collapsible="icon"
          className="border-r-0"
          disableTransition={isResizing}
        >
          <SidebarHeader className="h-16 justify-center">
            <div className="flex items-center gap-3 px-2 transition-all w-full">
              <button
                onClick={toggleSidebar}
                className="h-8 w-8 flex items-center justify-center hover:bg-accent rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring shrink-0"
                aria-label="Toggle navigation"
              >
                <PanelLeft className="h-4 w-4 text-muted-foreground" />
              </button>
              {!isCollapsed ? (
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-semibold tracking-tight truncate">
                    Navigation
                  </span>
                </div>
              ) : null}
            </div>
          </SidebarHeader>

          <SidebarContent className="gap-0">
            <SidebarMenu className="px-2 py-1">
              {menuItems.map(item => {
                const isActive = location === item.path;
                return (
                  <SidebarMenuItem key={item.path}>
                    <SidebarMenuButton
                      isActive={isActive}
                      onClick={() => setLocation(item.path)}
                      tooltip={item.label}
                      className={`h-10 transition-all font-normal`}
                    >
                      <item.icon
                        className={`h-4 w-4 ${isActive ? "text-primary" : ""}`}
                      />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarContent>

          <SidebarFooter className="p-3">
            {!isCollapsed && (
              <div className="mb-3 rounded-lg border p-2">
                {/* ASR 识别模式 */}
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="text-xs text-muted-foreground">ASR</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs">
                      {asrMode === "local" ? "离线" : "在线"}
                    </span>
                    <Switch
                      checked={asrMode === "local"}
                      disabled={syncingVoiceMode}
                      onCheckedChange={checked =>
                        void updateVoiceMode(checked ? "local" : "cloud")
                      }
                    />
                  </div>
                </div>
                {/* TTS 合成模式 */}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">TTS</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs">
                      {ttsMode === "local" ? "离线" : "在线"}
                    </span>
                    <Switch
                      checked={ttsMode === "local"}
                      disabled={syncingVoiceMode}
                      onCheckedChange={async (checked) => {
                        const next = checked ? "local" : "cloud";
                        setSyncingVoiceMode(true);
                        try {
                          if (next === "local") {
                            try {
                              const healthRes = await fetch("http://127.0.0.1:8001/health", {
                                method: "GET",
                                signal: AbortSignal.timeout(3000),
                              });
                              if (!healthRes.ok) throw new Error("Service unavailable");
                            } catch {
                              alert(
                                "本地语音服务未启动，请先运行：\n\ncd D:\\DEMO\\SmartAgent4_demo\\local-voice-service\npython main.py\n\n或者双击运行 start-local-voice.bat"
                              );
                              setSyncingVoiceMode(false);
                              return;
                            }
                          }
                          const res = await fetch("/api/voice-mode", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ ttsMode: next }),
                          });
                          if (!res.ok) throw new Error("voice mode update failed");
                          setTtsModeState(next);
                          localStorage.setItem(TTS_MODE_KEY, next);
                        } catch {
                          // keep old mode on failure
                        } finally {
                          setSyncingVoiceMode(false);
                        }
                      }}
                    />
                  </div>
                </div>
              </div>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-3 rounded-lg px-1 py-1 hover:bg-accent/50 transition-colors w-full text-left group-data-[collapsible=icon]:justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Avatar className="h-9 w-9 border shrink-0">
                    <AvatarFallback className="text-xs font-medium">
                      {user?.name?.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
                    <p className="text-sm font-medium truncate leading-none">
                      {user?.name || "-"}
                    </p>
                    <p className="text-xs text-muted-foreground truncate mt-1.5">
                      {user?.email || "-"}
                    </p>
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem
                  onClick={logout}
                  className="cursor-pointer text-destructive focus:text-destructive"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Sign out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarFooter>
        </Sidebar>
        <div
          className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/20 transition-colors ${isCollapsed ? "hidden" : ""}`}
          onMouseDown={() => {
            if (isCollapsed) return;
            setIsResizing(true);
          }}
          style={{ zIndex: 50 }}
        />
      </div>

      <SidebarInset>
        {isMobile && (
          <div className="flex border-b h-14 items-center justify-between bg-background/95 px-2 backdrop-blur supports-[backdrop-filter]:backdrop-blur sticky top-0 z-40">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="h-9 w-9 rounded-lg bg-background" />
              <div className="flex items-center gap-3">
                <div className="flex flex-col gap-1">
                  <span className="tracking-tight text-foreground">
                    {activeMenuItem?.label ?? "Menu"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
        <main className="flex-1 p-4">{children}</main>
      </SidebarInset>
    </>
  );
}
