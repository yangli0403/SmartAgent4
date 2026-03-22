export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

// Generate login URL at runtime so redirect URI reflects the current origin.
export const getLoginUrl = () => {
  // 开发模式：如果 OAuth 未配置，返回 null 允许跳过登录
  const skipOAuth = import.meta.env.VITE_SKIP_OAUTH === "true";
  
  const provider = import.meta.env.VITE_OAUTH_PROVIDER || "github";
  
  if (provider === "github") {
    // GitHub OAuth
    const clientId = import.meta.env.VITE_GITHUB_CLIENT_ID;
    if (!clientId) {
      if (skipOAuth) {
        console.warn("[OAuth] VITE_GITHUB_CLIENT_ID is not configured, but VITE_SKIP_OAUTH=true, skipping OAuth");
        return null; // 返回 null 表示跳过 OAuth
      }
      console.error("[OAuth] VITE_GITHUB_CLIENT_ID is not configured");
      throw new Error("GitHub OAuth client ID is not configured");
    }
    
    const redirectUri = `${window.location.origin}/api/oauth/callback?provider=github`;
    const state = btoa(redirectUri);
    const scope = "user:email"; // Request user email permission

    const url = new URL("https://github.com/login/oauth/authorize");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("scope", scope);

    return url.toString();
  } else {
    // Manus OAuth (backward compatibility)
  const oauthPortalUrl = import.meta.env.VITE_OAUTH_PORTAL_URL;
  const appId = import.meta.env.VITE_APP_ID;
    
    if (!oauthPortalUrl || !appId) {
      if (skipOAuth) {
        console.warn("[OAuth] Manus OAuth not configured, but VITE_SKIP_OAUTH=true, skipping OAuth");
        return null;
      }
      throw new Error("Manus OAuth not configured");
    }
    
  const redirectUri = `${window.location.origin}/api/oauth/callback`;
  const state = btoa(redirectUri);

  const url = new URL(`${oauthPortalUrl}/app-auth`);
  url.searchParams.set("appId", appId);
  url.searchParams.set("redirectUri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("type", "signIn");

  return url.toString();
  }
};
