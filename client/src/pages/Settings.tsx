import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { trpc } from "@/lib/trpc";
import { ArrowLeft, Brain, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { getLoginUrl } from "@/const";
import { toast } from "sonner";

export default function Settings() {
  const { user, isAuthenticated, logout } = useAuth();
  const [hasChanges, setHasChanges] = useState(false);

  const { data: preferences, isLoading } = trpc.preferences.get.useQuery(
    undefined,
    { enabled: isAuthenticated }
  );

  const { data: personalities } = trpc.preferences.getPersonalities.useQuery();

  const [localPrefs, setLocalPrefs] = useState({
    personality: "professional" as any,
    responseStyle: "balanced" as any,
    proactiveService: "enabled" as any,
    notificationPreference: {
      taskReminders: true,
      behaviorInsights: true,
      dailySummary: false,
    },
  });

  useEffect(() => {
    if (preferences) {
      // 确保 notificationPreference 是对象而不是字符串
      let notificationPref = preferences.notificationPreference;
      if (typeof notificationPref === 'string') {
        try {
          notificationPref = JSON.parse(notificationPref);
        } catch (e) {
          notificationPref = {
            taskReminders: true,
            behaviorInsights: true,
            dailySummary: false,
          };
        }
      }
      if (!notificationPref || typeof notificationPref !== 'object') {
        notificationPref = {
          taskReminders: true,
          behaviorInsights: true,
          dailySummary: false,
        };
      }
      
      setLocalPrefs({
        personality: preferences.personality,
        responseStyle: preferences.responseStyle,
        proactiveService: preferences.proactiveService,
        notificationPreference: notificationPref,
      });
    }
  }, [preferences]);

  const updatePreferencesMutation = trpc.preferences.update.useMutation({
    onSuccess: () => {
      toast.success("设置已保存");
      setHasChanges(false);
    },
    onError: error => {
      toast.error("保存失败: " + error.message);
    },
  });

  useEffect(() => {
    if (!isAuthenticated) {
      const url = getLoginUrl();
      if (url) window.location.href = url;
    }
  }, [isAuthenticated]);

  const handleSave = () => {
    // 确保 notificationPreference 是对象
    const prefsToSave = {
      ...localPrefs,
      notificationPreference: typeof localPrefs.notificationPreference === 'object' 
        ? localPrefs.notificationPreference 
        : {
            taskReminders: true,
            behaviorInsights: true,
            dailySummary: false,
          },
    };
    updatePreferencesMutation.mutate(prefsToSave);
  };

  const handleChange = (updates: Partial<typeof localPrefs>) => {
    setLocalPrefs({ ...localPrefs, ...updates });
    setHasChanges(true);
  };

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="min-h-screen flex flex-col bg-muted/30">
      {/* Header */}
      <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-16 items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="flex items-center gap-2">
            <Brain className="h-6 w-6 text-primary" />
            <span className="text-xl font-bold">设置</span>
          </div>
          <div className="ml-auto">
            {hasChanges && (
              <Button
                onClick={handleSave}
                disabled={updatePreferencesMutation.isPending}
              >
                <Save className="h-4 w-4 mr-2" />
                保存更改
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 container max-w-4xl py-6 space-y-6">
        {/* Personality Settings */}
        <Card>
          <CardHeader>
            <CardTitle>性格设置</CardTitle>
            <CardDescription>
              选择助手的性格模式，影响对话风格和回答方式
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="personality">性格模式</Label>
              <Select
                value={localPrefs.personality}
                onValueChange={value =>
                  handleChange({ personality: value as any })
                }
              >
                <SelectTrigger id="personality">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {personalities?.map(p => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} - {p.traits.join("、")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="responseStyle">回答风格</Label>
              <Select
                value={localPrefs.responseStyle}
                onValueChange={value =>
                  handleChange({ responseStyle: value as any })
                }
              >
                <SelectTrigger id="responseStyle">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="concise">简洁 - 直击要点</SelectItem>
                  <SelectItem value="balanced">平衡 - 适度详细</SelectItem>
                  <SelectItem value="detailed">详细 - 深入解释</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Service Settings */}
        <Card>
          <CardHeader>
            <CardTitle>服务设置</CardTitle>
            <CardDescription>配置主动服务和通知偏好</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="proactiveService">主动服务</Label>
                <p className="text-sm text-muted-foreground">
                  根据行为模式主动提供建议和提醒
                </p>
              </div>
              <Switch
                id="proactiveService"
                checked={localPrefs.proactiveService === "enabled"}
                onCheckedChange={checked =>
                  handleChange({
                    proactiveService: checked ? "enabled" : "disabled",
                  })
                }
              />
            </div>

            <div className="space-y-4 pt-4 border-t">
              <h4 className="font-medium">通知偏好</h4>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="taskReminders">任务提醒</Label>
                  <p className="text-sm text-muted-foreground">
                    接收任务和事件提醒
                  </p>
                </div>
                <Switch
                  id="taskReminders"
                  checked={localPrefs.notificationPreference.taskReminders}
                  onCheckedChange={checked =>
                    handleChange({
                      notificationPreference: {
                        ...localPrefs.notificationPreference,
                        taskReminders: checked,
                      },
                    })
                  }
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="behaviorInsights">行为洞察</Label>
                  <p className="text-sm text-muted-foreground">
                    接收行为模式分析和建议
                  </p>
                </div>
                <Switch
                  id="behaviorInsights"
                  checked={localPrefs.notificationPreference.behaviorInsights}
                  onCheckedChange={checked =>
                    handleChange({
                      notificationPreference: {
                        ...localPrefs.notificationPreference,
                        behaviorInsights: checked,
                      },
                    })
                  }
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="dailySummary">每日总结</Label>
                  <p className="text-sm text-muted-foreground">
                    接收每日活动总结
                  </p>
                </div>
                <Switch
                  id="dailySummary"
                  checked={localPrefs.notificationPreference.dailySummary}
                  onCheckedChange={checked =>
                    handleChange({
                      notificationPreference: {
                        ...localPrefs.notificationPreference,
                        dailySummary: checked,
                      },
                    })
                  }
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Account Settings */}
        <Card>
          <CardHeader>
            <CardTitle>账户</CardTitle>
            <CardDescription>管理你的账户设置</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>用户名</Label>
              <p className="text-sm">{user?.name || "未设置"}</p>
            </div>
            <div className="space-y-2">
              <Label>邮箱</Label>
              <p className="text-sm">{user?.email || "未设置"}</p>
            </div>
            <div className="pt-4 border-t">
              <Button variant="destructive" onClick={logout}>
                退出登录
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
