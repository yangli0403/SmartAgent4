import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getLoginUrl } from "@/const";
import { Brain, MessageSquare, Settings, Sparkles } from "lucide-react";
import { Link } from "wouter";

export default function Home() {
  const { user, isAuthenticated } = useAuth();
  const loginUrl = getLoginUrl();
  const skipOAuth = import.meta.env.VITE_SKIP_OAUTH === "true";

  // 如果跳过 OAuth，直接显示已登录状态（用于功能测试）
  const showAuthenticated = skipOAuth && !isAuthenticated;

  if (!isAuthenticated && !showAuthenticated) {
    return (
      <div className="min-h-screen flex flex-col">
        {/* Header */}
        <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="container flex h-16 items-center justify-between">
            <div className="flex items-center gap-2">
              <Brain className="h-6 w-6 text-primary" />
              <span className="text-xl font-bold">SmartAgent</span>
            </div>
            {loginUrl ? (
            <Button asChild>
                <a href={loginUrl}>登录</a>
            </Button>
            ) : (
              <Button disabled>OAuth 未配置</Button>
            )}
          </div>
        </header>

        {/* Hero Section */}
        <main className="flex-1 flex items-center justify-center">
          <div className="container max-w-4xl py-16 text-center">
            <div className="mb-8 inline-flex items-center gap-2 rounded-full bg-primary/10 px-4 py-2 text-sm text-primary">
              <Sparkles className="h-4 w-4" />
              <span>基于AI的智能个人助手</span>
            </div>

            <h1 className="mb-6 text-5xl font-bold tracking-tight">
              越用越懂你的
              <br />
              <span className="text-primary">AI助手</span>
            </h1>

            <p className="mb-12 text-xl text-muted-foreground max-w-2xl mx-auto">
              SmartAgent 结合先进的推理引擎、分层记忆系统和拟人化交互，
              为您提供真正个性化的智能助手体验
            </p>

            <div className="flex gap-4 justify-center">
              {loginUrl ? (
                <Button size="lg" asChild>
                  <a href={loginUrl}>开始使用</a>
                </Button>
              ) : (
              <Button size="lg" asChild>
                  <Link href="/chat">开始使用（跳过登录）</Link>
              </Button>
              )}
              <Button size="lg" variant="outline" asChild>
                <a href="#features">了解更多</a>
              </Button>
            </div>
          </div>
        </main>

        {/* Features Section */}
        <section id="features" className="py-24 bg-muted/50">
          <div className="container max-w-6xl">
            <h2 className="text-3xl font-bold text-center mb-12">核心特性</h2>

            <div className="grid md:grid-cols-3 gap-8">
              <Card>
                <CardHeader>
                  <MessageSquare className="h-10 w-10 text-primary mb-2" />
                  <CardTitle>拟人化交互</CardTitle>
                  <CardDescription>
                    5种性格模式，从专业助手到幽默伙伴，总有一款适合你
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card>
                <CardHeader>
                  <Brain className="h-10 w-10 text-primary mb-2" />
                  <CardTitle>用户记忆系统</CardTitle>
                  <CardDescription>
                    自动学习你的偏好和习惯，提供越来越个性化的服务
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card>
                <CardHeader>
                  <Sparkles className="h-10 w-10 text-primary mb-2" />
                  <CardTitle>主动服务</CardTitle>
                  <CardDescription>
                    基于行为模式分析，主动提供任务提醒和个性化建议
                  </CardDescription>
                </CardHeader>
              </Card>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t py-8">
          <div className="container text-center text-sm text-muted-foreground">
            <p>© 2026 SmartAgent. Powered by Manus AI.</p>
          </div>
        </footer>
      </div>
    );
  }

  // Authenticated view (包括跳过 OAuth 的情况)
  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-16 items-center justify-between">
          <div className="flex items-center gap-2">
            <Brain className="h-6 w-6 text-primary" />
            <span className="text-xl font-bold">SmartAgent</span>
            {skipOAuth && (
              <span className="text-xs text-muted-foreground bg-yellow-100 dark:bg-yellow-900 px-2 py-1 rounded">
                测试模式（已跳过 OAuth）
              </span>
            )}
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">
              欢迎，{user?.name || "测试用户"}
            </span>
            <Button variant="outline" size="sm" asChild>
              <Link href="/settings">
                <Settings className="h-4 w-4 mr-2" />
                设置
              </Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 container py-12">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-4xl font-bold mb-4">
            你好，{user?.name || "测试用户"}！
          </h1>
          <p className="text-xl text-muted-foreground mb-12">
            我是你的智能助手，准备好为你服务了。
          </p>

          <div className="grid md:grid-cols-2 gap-6">
            <Link href="/chat">
              <Card className="hover:shadow-lg transition-shadow cursor-pointer">
                <CardHeader>
                  <MessageSquare className="h-12 w-12 text-primary mb-4" />
                  <CardTitle>开始对话</CardTitle>
                  <CardDescription>
                    与你的AI助手开始一段智能对话
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>

            <Link href="/memories">
              <Card className="hover:shadow-lg transition-shadow cursor-pointer">
                <CardHeader>
                  <Brain className="h-12 w-12 text-primary mb-4" />
                  <CardTitle>记忆管理</CardTitle>
                  <CardDescription>查看和管理助手对你的了解</CardDescription>
                </CardHeader>
              </Card>
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
