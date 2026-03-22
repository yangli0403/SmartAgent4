import { AXIOS_TIMEOUT_MS, COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { ForbiddenError } from "@shared/_core/errors";
import axios, { type AxiosInstance } from "axios";
import { parse as parseCookieHeader } from "cookie";
import type { Request } from "express";
import { SignJWT, jwtVerify } from "jose";
import type { User } from "../../drizzle/schema";
import * as db from "../db";
import { ENV } from "./env";
import type {
  ExchangeTokenRequest,
  ExchangeTokenResponse,
  GetUserInfoResponse,
  GetUserInfoWithJwtRequest,
  GetUserInfoWithJwtResponse,
} from "./types/manusTypes";
// Utility function
const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

export type SessionPayload = {
  openId: string;
  appId: string;
  name: string;
};

// GitHub OAuth types
interface GitHubTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
}

interface GitHubUserInfo {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string;
  bio: string | null;
}

const EXCHANGE_TOKEN_PATH = `/webdev.v1.WebDevAuthPublicService/ExchangeToken`;
const GET_USER_INFO_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfo`;
const GET_USER_INFO_WITH_JWT_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfoWithJwt`;

class OAuthService {
  constructor(private client: ReturnType<typeof axios.create>) {
    console.log("[OAuth] Initialized with baseURL:", ENV.oAuthServerUrl);
    if (!ENV.oAuthServerUrl) {
      console.warn(
        "[OAuth] WARNING: OAUTH_SERVER_URL is not configured (only needed for Manus OAuth, GitHub OAuth doesn't require it)"
      );
    }
  }

  private decodeState(state: string): string {
    const redirectUri = atob(state);
    return redirectUri;
  }

  async getTokenByCode(
    code: string,
    state: string
  ): Promise<ExchangeTokenResponse> {
    const payload: ExchangeTokenRequest = {
      clientId: ENV.appId,
      grantType: "authorization_code",
      code,
      redirectUri: this.decodeState(state),
    };

    const { data } = await this.client.post<ExchangeTokenResponse>(
      EXCHANGE_TOKEN_PATH,
      payload
    );

    return data;
  }

  async getUserInfoByToken(
    token: ExchangeTokenResponse
  ): Promise<GetUserInfoResponse> {
    const { data } = await this.client.post<GetUserInfoResponse>(
      GET_USER_INFO_PATH,
      {
        accessToken: token.accessToken,
      }
    );

    return data;
  }

  /**
   * Exchange GitHub authorization code for access token
   */
  async getGitHubTokenByCode(
    code: string,
    redirectUri: string
  ): Promise<GitHubTokenResponse> {
    const clientId = ENV.githubClientId;
    const clientSecret = ENV.githubClientSecret;

    if (!clientId || !clientSecret) {
      throw new Error("GitHub OAuth credentials not configured");
    }

    // Create AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 seconds timeout

    try {
      console.log("[GitHub OAuth] Exchanging code for token...");
      const response = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": "SmartAgent",
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: redirectUri,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        console.error("[GitHub OAuth] Token exchange failed:", response.status, errorText);
        throw new Error(`GitHub token exchange failed: ${response.status} - ${errorText}`);
      }

      const data = await response.json();

      if (data.error) {
        console.error("[GitHub OAuth] OAuth error:", data.error, data.error_description);
        throw new Error(`GitHub OAuth error: ${data.error_description || data.error}`);
      }

      console.log("[GitHub OAuth] Token exchange successful");
      return data;
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === "AbortError") {
        console.error("[GitHub OAuth] Request timeout after 30 seconds");
        throw new Error("GitHub OAuth request timeout. Please check your network connection.");
      }
      if (error.cause?.code === "UND_ERR_CONNECT_TIMEOUT" || error.cause?.code === "ECONNRESET") {
        console.error("[GitHub OAuth] Network error:", error.cause.code);
        throw new Error(
          `Network error connecting to GitHub: ${error.cause.code}. ` +
          `Please check your network connection, firewall settings, or proxy configuration.`
        );
      }
      throw error;
    }
  }

  /**
   * Get GitHub user information using access token
   */
  async getGitHubUserInfo(accessToken: string): Promise<GitHubUserInfo> {
    // Create AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 seconds timeout

    try {
      console.log("[GitHub OAuth] Fetching user info...");
      const response = await fetch("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "SmartAgent",
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        console.error("[GitHub OAuth] User info failed:", response.status, errorText);
        throw new Error(`GitHub user info failed: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      console.log("[GitHub OAuth] User info retrieved:", data.login);
      return data;
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === "AbortError") {
        console.error("[GitHub OAuth] Request timeout after 30 seconds");
        throw new Error("GitHub API request timeout. Please check your network connection.");
      }
      if (error.cause?.code === "UND_ERR_CONNECT_TIMEOUT" || error.cause?.code === "ECONNRESET") {
        console.error("[GitHub OAuth] Network error:", error.cause.code);
        throw new Error(
          `Network error connecting to GitHub API: ${error.cause.code}. ` +
          `Please check your network connection, firewall settings, or proxy configuration.`
        );
      }
      throw error;
    }
  }

  /**
   * Get GitHub user email (requires user:email scope)
   */
  async getGitHubUserEmail(accessToken: string): Promise<string | null> {
    // Create AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 seconds timeout

    try {
      const response = await fetch("https://api.github.com/user/emails", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "SmartAgent",
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.warn(`[GitHub OAuth] Failed to fetch user emails: ${response.status} - ${await response.text()}`);
        return null;
      }

      const emails = await response.json();
      // Find primary email or first verified email
      const primaryEmail = emails.find((email: any) => email.primary);
      const verifiedEmail = emails.find((email: any) => email.verified);
      
      return primaryEmail?.email || verifiedEmail?.email || emails[0]?.email || null;
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === "AbortError" || error.cause?.code === "UND_ERR_CONNECT_TIMEOUT" || error.cause?.code === "ECONNRESET") {
        console.warn(`[GitHub OAuth] Network error fetching emails: ${error.message}`);
        return null; // Email is optional, so we return null on error
      }
      console.warn(`[GitHub OAuth] Error fetching emails: ${error.message}`);
      return null;
    }
  }
}

const createOAuthHttpClient = (): AxiosInstance =>
  axios.create({
    baseURL: ENV.oAuthServerUrl,
    timeout: AXIOS_TIMEOUT_MS,
  });

class SDKServer {
  private readonly client: AxiosInstance;
  private readonly oauthService: OAuthService;

  constructor(client: AxiosInstance = createOAuthHttpClient()) {
    this.client = client;
    this.oauthService = new OAuthService(this.client);
  }

  private deriveLoginMethod(
    platforms: unknown,
    fallback: string | null | undefined
  ): string | null {
    if (fallback && fallback.length > 0) return fallback;
    if (!Array.isArray(platforms) || platforms.length === 0) return null;
    const set = new Set<string>(
      platforms.filter((p): p is string => typeof p === "string")
    );
    if (set.has("REGISTERED_PLATFORM_EMAIL")) return "email";
    if (set.has("REGISTERED_PLATFORM_GOOGLE")) return "google";
    if (set.has("REGISTERED_PLATFORM_APPLE")) return "apple";
    if (
      set.has("REGISTERED_PLATFORM_MICROSOFT") ||
      set.has("REGISTERED_PLATFORM_AZURE")
    )
      return "microsoft";
    if (set.has("REGISTERED_PLATFORM_GITHUB")) return "github";
    const first = Array.from(set)[0];
    return first ? first.toLowerCase() : null;
  }

  /**
   * Exchange OAuth authorization code for access token
   * @example
   * const tokenResponse = await sdk.exchangeCodeForToken(code, state);
   */
  async exchangeCodeForToken(
    code: string,
    state: string
  ): Promise<ExchangeTokenResponse> {
    return this.oauthService.getTokenByCode(code, state);
  }

  /**
   * Get user information using access token
   * @example
   * const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
   */
  async getUserInfo(accessToken: string): Promise<GetUserInfoResponse> {
    const data = await this.oauthService.getUserInfoByToken({
      accessToken,
    } as ExchangeTokenResponse);
    const loginMethod = this.deriveLoginMethod(
      (data as any)?.platforms,
      (data as any)?.platform ?? data.platform ?? null
    );
    return {
      ...(data as any),
      platform: loginMethod,
      loginMethod,
    } as GetUserInfoResponse;
  }

  /**
   * Exchange GitHub authorization code for access token
   */
  async exchangeGitHubCodeForToken(
    code: string,
    redirectUri: string
  ): Promise<{ accessToken: string }> {
    const tokenResponse = await this.oauthService.getGitHubTokenByCode(code, redirectUri);
    return { accessToken: tokenResponse.access_token };
  }

  /**
   * Get GitHub user information and format it for our system
   */
  async getGitHubUserInfo(accessToken: string): Promise<{
    openId: string;
    name: string | null;
    email: string | null;
    loginMethod: string;
  }> {
    const [userInfo, email] = await Promise.all([
      this.oauthService.getGitHubUserInfo(accessToken),
      this.oauthService.getGitHubUserEmail(accessToken),
    ]);

    return {
      openId: `github_${userInfo.id}`, // Use GitHub ID as openId
      name: userInfo.name || userInfo.login,
      email: email || userInfo.email,
      loginMethod: "github",
    };
  }

  private parseCookies(cookieHeader: string | undefined) {
    if (!cookieHeader) {
      return new Map<string, string>();
    }

    const parsed = parseCookieHeader(cookieHeader);
    return new Map(Object.entries(parsed));
  }

  private getSessionSecret() {
    const secret = ENV.cookieSecret;
    return new TextEncoder().encode(secret);
  }

  /**
   * Create a session token for a Manus user openId
   * @example
   * const sessionToken = await sdk.createSessionToken(userInfo.openId);
   */
  async createSessionToken(
    openId: string,
    options: { expiresInMs?: number; name?: string } = {}
  ): Promise<string> {
    return this.signSession(
      {
        openId,
        appId: ENV.appId,
        name: options.name || "",
      },
      options
    );
  }

  async signSession(
    payload: SessionPayload,
    options: { expiresInMs?: number } = {}
  ): Promise<string> {
    const issuedAt = Date.now();
    const expiresInMs = options.expiresInMs ?? ONE_YEAR_MS;
    const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1000);
    const secretKey = this.getSessionSecret();

    return new SignJWT({
      openId: payload.openId,
      appId: payload.appId,
      name: payload.name,
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setExpirationTime(expirationSeconds)
      .sign(secretKey);
  }

  async verifySession(
    cookieValue: string | undefined | null
  ): Promise<{ openId: string; appId: string; name: string } | null> {
    if (!cookieValue) {
      console.warn("[Auth] Missing session cookie");
      return null;
    }

    try {
      const secretKey = this.getSessionSecret();
      const { payload } = await jwtVerify(cookieValue, secretKey, {
        algorithms: ["HS256"],
      });
      const { openId, appId, name } = payload as Record<string, unknown>;

      if (
        !isNonEmptyString(openId) ||
        !isNonEmptyString(appId) ||
        !isNonEmptyString(name)
      ) {
        console.warn("[Auth] Session payload missing required fields");
        return null;
      }

      return {
        openId,
        appId,
        name,
      };
    } catch (error) {
      console.warn("[Auth] Session verification failed", String(error));
      return null;
    }
  }

  async getUserInfoWithJwt(
    jwtToken: string
  ): Promise<GetUserInfoWithJwtResponse> {
    const payload: GetUserInfoWithJwtRequest = {
      jwtToken,
      projectId: ENV.appId,
    };

    const { data } = await this.client.post<GetUserInfoWithJwtResponse>(
      GET_USER_INFO_WITH_JWT_PATH,
      payload
    );

    const loginMethod = this.deriveLoginMethod(
      (data as any)?.platforms,
      (data as any)?.platform ?? data.platform ?? null
    );
    return {
      ...(data as any),
      platform: loginMethod,
      loginMethod,
    } as GetUserInfoWithJwtResponse;
  }

  async authenticateRequest(req: Request): Promise<User> {
    // 测试模式：跳过认证
    const SKIP_AUTH = process.env.SKIP_AUTH === "true" || process.env.VITE_SKIP_OAUTH === "true";
    if (SKIP_AUTH) {
      // 在测试模式下，返回 null 而不是抛出错误
      // context 会创建测试用户
      console.log("[Auth] Test mode: skipping authentication");
      throw ForbiddenError("Test mode: authentication skipped");
    }
    
    // Regular authentication flow
    const cookies = this.parseCookies(req.headers.cookie);
    const sessionCookie = cookies.get(COOKIE_NAME);
    const session = await this.verifySession(sessionCookie);

    if (!session) {
      throw ForbiddenError("Invalid session cookie");
    }

    const sessionUserId = session.openId;
    const signedInAt = new Date();
    let user = await db.getUserByOpenId(sessionUserId);

    // If user not in DB, try to sync from OAuth server (only for Manus users)
    // GitHub users should already be in DB from OAuth callback
    if (!user) {
      // Check if this is a GitHub user (openId starts with "github_")
      if (sessionUserId.startsWith("github_")) {
        // GitHub users should have been created during OAuth callback
        // If not found, it's an error
        throw ForbiddenError("GitHub user not found in database");
      }

      // For Manus users, try to sync from OAuth server
      try {
        const userInfo = await this.getUserInfoWithJwt(sessionCookie ?? "");
        await db.upsertUser({
          openId: userInfo.openId,
          name: userInfo.name || null,
          email: userInfo.email ?? null,
          loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
          lastSignedIn: signedInAt,
        });
        user = await db.getUserByOpenId(userInfo.openId);
      } catch (error) {
        console.error("[Auth] Failed to sync user from OAuth:", error);
        throw ForbiddenError("Failed to sync user info");
      }
    }

    if (!user) {
      throw ForbiddenError("User not found");
    }

    await db.upsertUser({
      openId: user.openId,
      lastSignedIn: signedInAt,
    });

    return user;
  }
}

export const sdk = new SDKServer();
