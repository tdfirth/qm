import { isStrongSigningSecret } from "./auth/source-auth.ts";
import { parseScopeId } from "./types.ts";
import type { SandboxScopeDefaults } from "./sandbox/sandbox-routing.ts";
import { existsSync, readdirSync } from "node:fs";
import {
  parseProviderBaseUrl,
  providerBaseUrlsFromEnv,
  type ModelGatewayTransportConfig,
  type ProviderBaseUrls,
} from "./model/provider-endpoints.ts";
import { join, resolve } from "node:path";
import {
  parseMemoryCaptureMode,
  parseMemoryRecallMode,
  type MemoryCaptureMode,
  type MemoryRecallMode,
} from "./memory/policy.ts";
import { SECURITY_POSTURES, type SecurityPosture } from "./security/security-posture.ts";
import { SHARING_POSTURES, type SharingPosture } from "./resolution/sharing-posture.ts";
import { parseMemoryStrategyKind, type MemoryStrategyKind } from "./memory/strategy.ts";
import { parseMemoryProviderConfig, type MemoryProviderConfig } from "./memory/provider-config.ts";
import { sanitizeBranding } from "./resolution/branding.ts";
import type { OrgBranding } from "./resolution/config-store.ts";
import { validateCoreSecretEnv } from "./deployment/secret-schema.ts";
import { DEFAULT_CAPTURE_QUIET_MS } from "./memory/strategies/per-turn.ts";
import {
  parseSlackContextSource,
  type SlackContextSource,
  slackPluginConfigFromEnv,
  type SlackPluginConfig,
} from "./slack/config.ts";
import { codexAuthFileForEnv, readCodexOAuthAuthFile } from "./harness/codex-auth-file.ts";
import {
  MODEL_PROVIDERS,
  defaultModelForProvider,
  isModelProvider,
  onlyProvider,
  type ModelProvider,
  type ModelProviderAvailability,
} from "./model/pi-models.ts";

import { resolveSwarmSettings, type SwarmSettings } from "./swarms/swarm-settings.ts";

const HARNESSES = ["mock", "pi", "opencode", "codex", "claude"] as const;
const SANDBOX_BACKENDS = ["aws", "local", "sprites", "smolmachines", "e2b", "modal", "porter", "agent37"] as const;

export interface Config {
  productAnalytics?: { apiKey: string; host?: string };
  slackContextSource?: SlackContextSource;
  suggestedActivitiesEnabled?: boolean;
  suggestedActivitiesContext?: string;
  swarmsEnabled?: boolean;
  swarmDefaults?: SwarmSettings;
  production: boolean;
  allowUnauthenticatedCore: boolean;
  port: number;
  dataDir: string;
  orgId: string;
  sessionStore: "memory" | "postgres";
  databaseUrl?: string;
  databaseCaCert?: string;
  databaseCaCertFile?: string;
  databasePoolUrl?: string;
  databasePoolCaCert?: string;
  databasePoolMax?: number;
  databaseDirectPoolMax?: number;
  harness: (typeof HARNESSES)[number];
  securityPosture: SecurityPosture;
  sandboxResourcesEnabled: boolean;
  sharingPosture: SharingPosture;
  sandboxScopeDefaults?: SandboxScopeDefaults;
  sandboxBackend: (typeof SANDBOX_BACKENDS)[number];
  sandboxSecondaryBackend?: (typeof SANDBOX_BACKENDS)[number];
  deployProvider: "docker" | "aws" | "fly" | "porter";
  egressServiceHosts?: string[];
  brandingDefault?: OrgBranding;
  modelId?: string;
  opencodeModel?: string;
  codexModel?: string;
  codexBinPath?: string;
  codexAuthFile?: string;
  /** Keychain credential id holding the Codex ChatGPT OAuth auth.json (production path). */
  codexAuthCredential?: string;
  /** Keychain credential id holding a Claude Code subscription token (production path). */
  claudeAuthCredential?: string;
  codexProcessEnv: NodeJS.ProcessEnv;
  claudeModel?: string;
  claudeBinPath?: string;
  claudeProcessEnv: NodeJS.ProcessEnv;
  detectModelId?: string;
  titleModelId?: string;
  judgeModelId?: string;
  anthropicApiKey?: string;
  openaiApiKey?: string;
  openrouterApiKey?: string;
  modelProvider?: ModelProvider;
  providerBaseUrls: ProviderBaseUrls;
  modelGateway?: ModelGatewayTransportConfig;
  piCaptureRequests: boolean;
  piSystemCacheSplit: boolean;
  sessionTapeMode: "shadow" | "serve";
  adminGrants?: string;
  trustedOidcAdminIssuer?: string;
  emailAuthPrincipals?: string[];
  emailAuthDomain?: string;
  resendApiKey?: string;
  emailFrom?: string;
  rateLimitPerWindow: number;
  rateLimitWindowMs: number;
  budgetUsdPerWindow?: number;
  orgBudgetUsdPerWindow?: number;
  budgetWindowMs: number;
  maxContextTokens?: number;
  execTimeoutDefaultMs: number;
  execTimeoutMaxMs: number;
  turnWallClockMs: number;
  runMaxAgeMs: number;
  runWaitMs: number;
  backgroundJobTtlMs: number;
  backgroundJobTtlMaxMs: number;
  backgroundWorkEnabled: boolean;
  backgroundDeploymentId?: string;
  deploymentControlSecret?: string;
  buildSha?: string;
  ecsTaskProtection: boolean;
  ecsAgentUri?: string;
  monitorPollMs: number;
  skillSyncPollMs: number;
  monitorHeartbeatMs: number;
  signingSecret?: string;
  capabilitySecret?: string;
  portalIdentitySecret?: string;
  requireSignedPortalIdentity?: boolean;
  connectorSecretKey?: string;
  slackEventsPort?: number;
  secretsBackend: "env" | "aws";
  secretsPrefix: string;
  apiBaseUrl?: string;
  publicUrl?: string;
  publicWebUrl?: string;
  flyAppName?: string;
  slack?: SlackPluginConfig;
  runStore: "memory" | "postgres";
  skillSigningSecret?: string;
  seedSkills: boolean;
  skillsSeedDir: string;
  pluginSkillDirs: string[];
  deploymentLayerDir?: string;
  layerEnv?: Readonly<Record<string, string | undefined>>;
  filesDirectUploadsEnabled: boolean;
  snapshotStore: "local" | "s3";
  transferStore: "local" | "s3";
  s3Bucket?: string;
  s3Region?: string;
  s3Prefix?: string;
  deployIdleTtlMs?: number;
  deployGitDir: string;
  deployDialTimeoutMs: number;
  deployAppsSessionSecret?: string;
  deployAppsLoginUrl?: string;
  deployAppsLoginPath?: "/auth/login" | "/auth/trusted/login";
  deepIdleMachineMs: number;
  devIdleMachineMs: number;
  cronFireConcurrency: number;
  memoryRecall: MemoryRecallMode;
  memoryCapture: MemoryCaptureMode;
  memoryStrategy: MemoryStrategyKind;
  memoryProviderConfig?: MemoryProviderConfig;
  memoryConsolidateAfter?: number;
  memoryCaptureQuietMs: number;
  memoryCaptureMaxTurns?: number;
  workers: number;
  leaseTtlMs: number;
  heartbeatIntervalMs: number;
  reaperIntervalMs: number;
  shutdownDrainMs: number;
  maxAttempts: number;
  maxClaims: number;
  processReaperIntervalMs: number;
  approvalSummaryTimeoutMs: number;
  turnLeaseWaitMs: number;
  securityScreenTimeoutMs: number;
  securityScreenBackend: "off" | "model" | "proxy";
  securityScreenProxy?: {
    provider: string;
    endpoint: string;
    token: string;
    shadow: boolean;
  };
  scratchExecEnabled: boolean;
  reachExecEnabled: boolean;
  sharedOwnerAuthIsolation: boolean;
  surfaceDebugFooter: boolean;
  eagerProvisionEnabled: boolean;
  awsSandbox: AwsSandboxEnv;
  localSandbox: LocalSandboxEnv;
  spritesSandbox: SpritesSandboxEnv;
  smolmachinesSandbox: SmolmachinesSandboxEnv;
  agent37Sandbox: Agent37SandboxEnv;
  e2bSandbox: E2bSandboxEnv;
  modalSandbox: ModalSandboxEnv;
  porterSandbox: PorterSandboxEnv;
  porterDeploy: PorterDeployEnv;
  awsDeploy: AwsDeployEnv;
  deployAppsDomain?: string;
  flyDeploy: FlyDeployEnv;
}

export function configuredModelForHarness(config: Config, harness: string): string | undefined {
  if (harness === "codex") return config.codexModel;
  if (harness === "claude") return config.claudeModel;
  if (harness === "opencode") return config.opencodeModel;
  return config.modelId;
}

export function providerKeysPresent(config: Config): ModelProviderAvailability {
  return {
    anthropic: Boolean(config.anthropicApiKey),
    openai: Boolean(config.openaiApiKey),
    openrouter: Boolean(config.openrouterApiKey),
    ...(config.harness === "codex" && (config.codexAuthFile || config.codexAuthCredential) ? { codexOAuth: true } : {}),
  };
}

export function baseModelProviders(config: Config): ModelProviderAvailability | undefined {
  return config.modelProvider ? onlyProvider(config.modelProvider) : undefined;
}

export function harnessCarriedModelAuth(config: Config): ModelProvider | undefined {
  if (
    config.harness === "claude" &&
    (config.claudeAuthCredential ||
      config.claudeProcessEnv.CLAUDE_CODE_OAUTH_TOKEN ||
      config.claudeProcessEnv.ANTHROPIC_AUTH_TOKEN)
  )
    return "anthropic";
  if (
    config.harness === "codex" &&
    (config.codexAuthCredential || config.codexAuthFile || config.codexProcessEnv.CODEX_ACCESS_TOKEN)
  )
    return "openai";
  return undefined;
}

interface AwsSandboxEnv {
  region: string;
  profile?: string;
  imageIdentifier: string;
  imageVersion?: string;
  executionRoleArn?: string;
  ingressConnectorArns?: string[];
  egressConnectorArns?: string[];
  s3Bucket?: string;
  s3Prefix?: string;
  agentPort?: number;
  maxIdleDurationSeconds?: number;
  suspendedDurationSeconds?: number;
  maximumDurationInSeconds?: number;
  rotateAfterSeconds?: number;
  snapshotIntervalMs?: number;
  defaultTimeoutSec?: number;
  cpus?: number;
  memoryMb?: number;
  diskGb?: number;
}

function awsSandboxEnv(env: NodeJS.ProcessEnv): AwsSandboxEnv {
  const csv = (s: string | undefined): string[] | undefined =>
    s
      ? s
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean)
      : undefined;
  const ingress = csv(env.AWS_SANDBOX_INGRESS_CONNECTORS);
  const egress = csv(env.AWS_SANDBOX_EGRESS_CONNECTORS);
  return {
    region: env.AWS_SANDBOX_REGION ?? env.AWS_REGION ?? env.AWS_DEFAULT_REGION ?? "us-west-2",
    ...(env.AWS_SANDBOX_PROFILE ? { profile: env.AWS_SANDBOX_PROFILE } : {}),
    imageIdentifier: env.AWS_SANDBOX_IMAGE ?? "qm-microvm-sandbox",
    ...(env.AWS_SANDBOX_IMAGE_VERSION ? { imageVersion: env.AWS_SANDBOX_IMAGE_VERSION } : {}),
    ...(env.AWS_SANDBOX_EXEC_ROLE_ARN ? { executionRoleArn: env.AWS_SANDBOX_EXEC_ROLE_ARN } : {}),
    ...(ingress ? { ingressConnectorArns: ingress } : {}),
    ...(egress ? { egressConnectorArns: egress } : {}),
    ...(env.AWS_SANDBOX_S3_BUCKET ? { s3Bucket: env.AWS_SANDBOX_S3_BUCKET } : {}),
    ...(env.AWS_SANDBOX_S3_PREFIX ? { s3Prefix: env.AWS_SANDBOX_S3_PREFIX } : {}),
    ...optNum(env, "AWS_SANDBOX_AGENT_PORT", "agentPort"),
    ...optNum(env, "AWS_SANDBOX_MAX_IDLE_SEC", "maxIdleDurationSeconds"),
    ...optNum(env, "AWS_SANDBOX_SUSPENDED_SEC", "suspendedDurationSeconds"),
    ...optNum(env, "AWS_SANDBOX_MAX_DURATION_SEC", "maximumDurationInSeconds"),
    ...optNum(env, "AWS_SANDBOX_ROTATE_AFTER_SEC", "rotateAfterSeconds"),
    ...optNum(env, "AWS_SANDBOX_SNAPSHOT_INTERVAL_MS", "snapshotIntervalMs"),
    ...(env.QM_CORE_CONTAINER ? { coreContainer: env.QM_CORE_CONTAINER } : {}),
    ...optNum(env, "SANDBOX_TIMEOUT_SEC", "defaultTimeoutSec"),
    ...optNum(env, "AWS_SANDBOX_CPUS", "cpus"),
    ...optNum(env, "AWS_SANDBOX_MEMORY_MB", "memoryMb"),
    ...optNum(env, "AWS_SANDBOX_DISK_GB", "diskGb"),
  };
}

interface LocalSandboxEnv {
  image?: string;
  dockerBin?: string;
  cpus?: number;
  memoryMb?: number;
  coreContainer?: string;
  defaultTimeoutSec?: number;
}

function localSandboxEnv(env: NodeJS.ProcessEnv): LocalSandboxEnv {
  return {
    ...(env.LOCAL_SANDBOX_IMAGE ? { image: env.LOCAL_SANDBOX_IMAGE } : {}),
    ...(env.LOCAL_SANDBOX_DOCKER_BIN ? { dockerBin: env.LOCAL_SANDBOX_DOCKER_BIN } : {}),
    ...optNum(env, "LOCAL_SANDBOX_CPUS", "cpus"),
    ...optNum(env, "LOCAL_SANDBOX_MEMORY_MB", "memoryMb"),
    ...optNum(env, "SANDBOX_TIMEOUT_SEC", "defaultTimeoutSec"),
  };
}

interface SpritesSandboxEnv {
  token?: string;
  baseUrl?: string;
  namePrefix?: string;
  egressProxyUrl?: string;
  defaultTimeoutSec?: number;
}

function spritesSandboxEnv(env: NodeJS.ProcessEnv): SpritesSandboxEnv {
  return {
    ...(env.SPRITES_TOKEN ? { token: env.SPRITES_TOKEN } : {}),
    ...(env.SPRITES_BASE_URL ? { baseUrl: env.SPRITES_BASE_URL } : {}),
    ...(env.SPRITES_NAME_PREFIX ? { namePrefix: env.SPRITES_NAME_PREFIX } : {}),
    ...(env.SPRITES_EGRESS_PROXY_URL ? { egressProxyUrl: env.SPRITES_EGRESS_PROXY_URL } : {}),
    ...optNum(env, "SANDBOX_TIMEOUT_SEC", "defaultTimeoutSec"),
  };
}

interface E2bSandboxEnv {
  apiKey?: string;
  templateId?: string;
  namePrefix?: string;
  sandboxTtlSec?: number;

  proxy?: string;

  egressProxyUrl?: string;
  snapshotS3Bucket?: string;
  snapshotIntervalSec?: number;
  defaultTimeoutSec?: number;
}

function e2bSandboxEnv(env: NodeJS.ProcessEnv): E2bSandboxEnv {
  return {
    ...(env.E2B_API_KEY ? { apiKey: env.E2B_API_KEY } : {}),
    ...(env.E2B_TEMPLATE_ID ? { templateId: env.E2B_TEMPLATE_ID } : {}),
    ...(env.E2B_NAME_PREFIX ? { namePrefix: env.E2B_NAME_PREFIX } : {}),
    ...optNum(env, "E2B_SANDBOX_TTL_SEC", "sandboxTtlSec"),
    ...(env.E2B_PROXY ? { proxy: env.E2B_PROXY } : {}),
    ...(env.E2B_EGRESS_PROXY_URL ? { egressProxyUrl: env.E2B_EGRESS_PROXY_URL } : {}),
    ...(env.E2B_SNAPSHOT_S3_BUCKET ? { snapshotS3Bucket: env.E2B_SNAPSHOT_S3_BUCKET } : {}),
    ...optNum(env, "E2B_SNAPSHOT_INTERVAL_SEC", "snapshotIntervalSec"),
    ...optNum(env, "SANDBOX_TIMEOUT_SEC", "defaultTimeoutSec"),
  };
}

interface ModalSandboxEnv {
  nativeSnapshotsEnabled?: boolean;
  nativeSnapshotIntervalSec?: number;
  snapshotRetentionSec?: number;
  tokenId?: string;
  tokenSecret?: string;
  appName?: string;
  environment?: string;
  image?: string;
  namePrefix?: string;
  cpus?: number;
  memoryMb?: number;
  regions?: string[];
  sandboxTimeoutSec?: number;
  rotateAfterSec?: number;
  reapIdleSec?: number;
  egressProxyUrl?: string;
  snapshotS3Bucket?: string;
  snapshotIntervalSec?: number;
  defaultTimeoutSec?: number;
}

function modalSandboxEnv(env: NodeJS.ProcessEnv): ModalSandboxEnv {
  return {
    nativeSnapshotsEnabled:
      boolEnvStrict("MODAL_NATIVE_SNAPSHOTS_ENABLED", env.MODAL_NATIVE_SNAPSHOTS_ENABLED) ?? false,
    ...optNum(env, "MODAL_NATIVE_SNAPSHOT_INTERVAL_SEC", "nativeSnapshotIntervalSec"),
    ...optNum(env, "MODAL_SNAPSHOT_RETENTION_SEC", "snapshotRetentionSec"),
    ...(env.MODAL_TOKEN_ID ? { tokenId: env.MODAL_TOKEN_ID } : {}),
    ...(env.MODAL_TOKEN_SECRET ? { tokenSecret: env.MODAL_TOKEN_SECRET } : {}),
    ...(env.MODAL_APP_NAME ? { appName: env.MODAL_APP_NAME } : {}),
    ...(env.MODAL_ENVIRONMENT ? { environment: env.MODAL_ENVIRONMENT } : {}),
    ...(env.MODAL_IMAGE ? { image: env.MODAL_IMAGE } : {}),
    ...(env.MODAL_NAME_PREFIX ? { namePrefix: env.MODAL_NAME_PREFIX } : {}),
    ...optNum(env, "MODAL_CPUS", "cpus"),
    ...optNum(env, "MODAL_MEMORY_MB", "memoryMb"),
    ...(env.MODAL_REGIONS?.trim()
      ? {
          regions: env.MODAL_REGIONS.split(",")
            .map((r) => r.trim())
            .filter(Boolean),
        }
      : {}),
    ...optNum(env, "MODAL_SANDBOX_TIMEOUT_SEC", "sandboxTimeoutSec"),
    ...optNum(env, "MODAL_ROTATE_AFTER_SEC", "rotateAfterSec"),
    ...optNum(env, "MODAL_REAP_IDLE_SEC", "reapIdleSec"),
    ...(env.MODAL_EGRESS_PROXY_URL ? { egressProxyUrl: env.MODAL_EGRESS_PROXY_URL } : {}),
    ...(env.MODAL_SNAPSHOT_S3_BUCKET ? { snapshotS3Bucket: env.MODAL_SNAPSHOT_S3_BUCKET } : {}),
    ...optNum(env, "MODAL_SNAPSHOT_INTERVAL_SEC", "snapshotIntervalSec"),
    ...optNum(env, "SANDBOX_TIMEOUT_SEC", "defaultTimeoutSec"),
  };
}

interface SmolmachinesSandboxEnv {
  token?: string;
  baseUrl?: string;
  namePrefix?: string;
  image?: string;
  cpus?: number;
  memoryMb?: number;
  diskGb?: number;
  egressProxyUrl?: string;
  defaultTimeoutSec?: number;
}

function smolmachinesSandboxEnv(env: NodeJS.ProcessEnv): SmolmachinesSandboxEnv {
  return {
    ...(env.SMOLMACHINES_TOKEN ? { token: env.SMOLMACHINES_TOKEN } : {}),
    ...(env.SMOLMACHINES_BASE_URL ? { baseUrl: env.SMOLMACHINES_BASE_URL } : {}),
    ...(env.SMOLMACHINES_NAME_PREFIX ? { namePrefix: env.SMOLMACHINES_NAME_PREFIX } : {}),
    ...(env.SMOLMACHINES_IMAGE ? { image: env.SMOLMACHINES_IMAGE } : {}),
    ...optNum(env, "SMOLMACHINES_CPUS", "cpus"),
    ...optNum(env, "SMOLMACHINES_MEMORY_MB", "memoryMb"),
    ...optNum(env, "SMOLMACHINES_DISK_GB", "diskGb"),
    ...(env.SMOLMACHINES_EGRESS_PROXY_URL ? { egressProxyUrl: env.SMOLMACHINES_EGRESS_PROXY_URL } : {}),
    ...optNum(env, "SANDBOX_TIMEOUT_SEC", "defaultTimeoutSec"),
  };
}

interface PorterSandboxEnv {
  image?: string;
  token?: string;
  baseUrl?: string;
  namePrefix?: string;
  homeDir?: string;
  ttlSec?: number;
  egressProxyUrl?: string;
  defaultTimeoutSec?: number;
}

interface PorterDeployEnv {
  token?: string;
  baseUrl?: string;
  runnerImage?: string;
  appsDomain?: string;
  visibility?: "public" | "private";
  namePrefix?: string;
  ttlSec?: number;
}

function porterApiBaseUrl(env: NodeJS.ProcessEnv): string | undefined {
  const deployProjectId = numEnvStrict("PORTER_DEPLOY_PROJECT_ID", env.PORTER_DEPLOY_PROJECT_ID);
  const deployClusterId = numEnvStrict("PORTER_DEPLOY_CLUSTER_ID", env.PORTER_DEPLOY_CLUSTER_ID);
  const derived =
    deployProjectId !== undefined && deployClusterId !== undefined
      ? `${(env.PORTER_DEPLOY_URL ?? "https://dashboard.porter.run").replace(/\/+$/, "")}/api/v2/alpha/projects/${deployProjectId}/clusters/${deployClusterId}`
      : undefined;
  return env.PORTER_SANDBOX_BASE_URL ?? derived;
}

const porterLocatorPresent = (env: NodeJS.ProcessEnv): boolean =>
  Boolean(porterApiBaseUrl(env) || env.PORTER_CLUSTER_ID || env.KUBERNETES_SERVICE_HOST);

function porterDeployEnv(env: NodeJS.ProcessEnv): PorterDeployEnv {
  const token = env.PORTER_DEPLOY_API_TOKEN;
  const baseUrl = porterApiBaseUrl(env);
  const visibility = enumEnvStrict(
    "PORTER_DEPLOY_VISIBILITY",
    env.PORTER_DEPLOY_VISIBILITY,
    ["public", "private"],
    undefined,
  );
  const runnerImage = env.PORTER_DEPLOY_RUNNER_IMAGE ?? env.PORTER_SANDBOX_IMAGE;
  return {
    ...(token ? { token } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    ...(runnerImage ? { runnerImage } : {}),
    ...(env.PORTER_DEPLOY_APPS_DOMAIN ? { appsDomain: env.PORTER_DEPLOY_APPS_DOMAIN } : {}),
    ...(visibility ? { visibility } : {}),
    ...(env.PORTER_SANDBOX_NAME_PREFIX ? { namePrefix: env.PORTER_SANDBOX_NAME_PREFIX } : {}),
    ...optNum(env, "PORTER_DEPLOY_TTL_SEC", "ttlSec"),
  };
}

function porterSandboxEnv(env: NodeJS.ProcessEnv): PorterSandboxEnv {
  const token = env.PORTER_DEPLOY_API_TOKEN;
  const baseUrl = porterApiBaseUrl(env);
  return {
    ...(env.PORTER_SANDBOX_IMAGE ? { image: env.PORTER_SANDBOX_IMAGE } : {}),
    ...(token ? { token } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    ...(env.PORTER_SANDBOX_NAME_PREFIX ? { namePrefix: env.PORTER_SANDBOX_NAME_PREFIX } : {}),
    ...(env.PORTER_SANDBOX_HOME ? { homeDir: env.PORTER_SANDBOX_HOME } : {}),
    ...optNum(env, "PORTER_SANDBOX_TTL_SEC", "ttlSec"),
    ...(env.PORTER_SANDBOX_EGRESS_PROXY_URL ? { egressProxyUrl: env.PORTER_SANDBOX_EGRESS_PROXY_URL } : {}),
    ...optNum(env, "SANDBOX_TIMEOUT_SEC", "defaultTimeoutSec"),
  };
}

interface Agent37SandboxEnv {
  apiKey?: string;
  baseUrl?: string;
  namePrefix?: string;
  template?: string;
  cpus?: number;
  memoryGb?: number;
  diskGb?: number;
  egressProxyUrl?: string;
  defaultTimeoutSec?: number;
}

function agent37SandboxEnv(env: NodeJS.ProcessEnv): Agent37SandboxEnv {
  return {
    ...(env.AGENT37_API_KEY ? { apiKey: env.AGENT37_API_KEY } : {}),
    ...(env.AGENT37_API_BASE_URL ? { baseUrl: env.AGENT37_API_BASE_URL } : {}),
    ...(env.AGENT37_NAME_PREFIX ? { namePrefix: env.AGENT37_NAME_PREFIX } : {}),
    ...(env.AGENT37_TEMPLATE ? { template: env.AGENT37_TEMPLATE } : {}),
    ...optNum(env, "AGENT37_CPUS", "cpus"),
    ...optNum(env, "AGENT37_MEMORY_GB", "memoryGb"),
    ...optNum(env, "AGENT37_DISK_GB", "diskGb"),
    ...(env.AGENT37_EGRESS_PROXY_URL ? { egressProxyUrl: env.AGENT37_EGRESS_PROXY_URL } : {}),
    ...optNum(env, "SANDBOX_TIMEOUT_SEC", "defaultTimeoutSec"),
  };
}

interface AwsDeployEnv {
  region: string;
  profile?: string;
  imageIdentifier: string;
  imageVersion?: string;
  executionRoleArn?: string;
  ingressConnectorArns?: string[];
  egressConnectorArns?: string[];
  agentPort?: number;
  appPort?: number;
  maximumDurationInSeconds?: number;
  rotateAfterSeconds?: number;
  maxIdleDurationSeconds?: number;
  suspendedDurationSeconds?: number;
  appsDomain?: string;
  gateSecret?: string;
  tokenTtlMinutes?: number;
  dataBucket?: string;
  dataPrefix?: string;
  snapshotIntervalMs?: number;
  dataRoleArn?: string;
}

function deployAppsEnv(
  env: NodeJS.ProcessEnv,
  defaultLoginUrl: string | undefined,
): {
  deployAppsSessionSecret?: string;
  deployAppsLoginUrl?: string;
  deployAppsLoginPath?: "/auth/login" | "/auth/trusted/login";
} {
  const explicit = env.DEPLOY_APPS_SESSION_SECRET;
  const shared = env.PORTAL_SESSION_SECRET;
  const loginUrl = env.DEPLOY_APPS_LOGIN_URL ?? (explicit || shared ? defaultLoginUrl : undefined);
  if (loginUrl && !explicit && !shared) {
    throw new Error("DEPLOY_APPS_LOGIN_URL requires DEPLOY_APPS_SESSION_SECRET");
  }
  if (explicit && !loginUrl) {
    throw new Error("DEPLOY_APPS_SESSION_SECRET needs a sign-in address — set DEPLOY_APPS_LOGIN_URL or PUBLIC_WEB_URL");
  }
  const secret = explicit ?? (loginUrl ? shared : undefined);
  const loginPath = env.DEPLOY_APPS_LOGIN_PATH ?? "/auth/login";
  if (loginPath !== "/auth/login" && loginPath !== "/auth/trusted/login") {
    throw new Error("DEPLOY_APPS_LOGIN_PATH must be /auth/login or /auth/trusted/login");
  }
  if (!secret || !loginUrl) return {};
  return {
    deployAppsSessionSecret: secret,
    deployAppsLoginUrl: loginUrl.replace(/\/$/, ""),
    deployAppsLoginPath: loginPath,
  };
}

const SHARED_PLATFORM_SUFFIXES = [
  "onporter.run",
  "withporter.run",
  "porter.run",
  "fly.dev",
  "herokuapp.com",
  "onrender.com",
  "railway.app",
  "vercel.app",
  "netlify.app",
  "ondigitalocean.app",
  "azurewebsites.net",
  "elasticbeanstalk.com",
  "amazonaws.com",
  "cloudfront.net",
  "github.io",
  "pages.dev",
  "workers.dev",
];

function sharedPlatformSuffixOf(domain: string): string | undefined {
  const host = domain.toLowerCase();
  return SHARED_PLATFORM_SUFFIXES.find((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

const HOSTNAME_LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const HOSTNAME_RE = new RegExp(`^${HOSTNAME_LABEL}(?:\\.${HOSTNAME_LABEL})+$`);

function deployAppsDomainEnv(env: NodeJS.ProcessEnv, deployProvider: string): string | undefined {
  const raw = env.DEPLOY_APPS_DOMAIN?.trim();
  if (raw) {
    const canonical = raw.toLowerCase().replace(/\.$/, "");
    if (!HOSTNAME_RE.test(canonical)) {
      throw new Error(
        `DEPLOY_APPS_DOMAIN (${raw}) is not a plain DNS name — set it to a bare domain like apps.example.com (no scheme, port, path, or wildcard prefix).`,
      );
    }
    const suffix = sharedPlatformSuffixOf(canonical);
    if (suffix) {
      throw new Error(
        `DEPLOY_APPS_DOMAIN (${canonical}) is under ${suffix}, a shared platform domain that cannot carry per-app subdomains — attach a custom domain you control (set DEPLOY_APPS_DOMAIN=apps.<your-domain> with a wildcard DNS record pointing at this instance), or unset it to keep serving apps signed-in at /d/<app>/.`,
      );
    }
    return canonical;
  }
  if (deployProvider === "porter" && env.PORTER_DEPLOY_APPS_DOMAIN) return env.PORTER_DEPLOY_APPS_DOMAIN;
  return env.AWS_DEPLOY_APPS_DOMAIN;
}

function awsDeployEnv(env: NodeJS.ProcessEnv): AwsDeployEnv {
  const csv = (s: string | undefined): string[] | undefined =>
    s
      ? s
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean)
      : undefined;
  const ingress = csv(env.AWS_DEPLOY_INGRESS_CONNECTORS);
  const egress = csv(env.AWS_DEPLOY_EGRESS_CONNECTORS);
  return {
    region: env.AWS_DEPLOY_REGION ?? env.AWS_REGION ?? env.AWS_DEFAULT_REGION ?? "us-west-2",
    ...(env.AWS_DEPLOY_PROFILE ? { profile: env.AWS_DEPLOY_PROFILE } : {}),
    imageIdentifier: env.AWS_DEPLOY_IMAGE ?? "qm-microvm-sandbox",
    ...(env.AWS_DEPLOY_IMAGE_VERSION ? { imageVersion: env.AWS_DEPLOY_IMAGE_VERSION } : {}),
    ...(env.AWS_DEPLOY_EXEC_ROLE_ARN ? { executionRoleArn: env.AWS_DEPLOY_EXEC_ROLE_ARN } : {}),
    ...(ingress ? { ingressConnectorArns: ingress } : {}),
    ...(egress ? { egressConnectorArns: egress } : {}),
    ...optNum(env, "AWS_DEPLOY_AGENT_PORT", "agentPort"),
    ...optNum(env, "AWS_DEPLOY_APP_PORT", "appPort"),
    ...optNum(env, "AWS_DEPLOY_MAX_DURATION_SEC", "maximumDurationInSeconds"),
    ...optNum(env, "AWS_DEPLOY_ROTATE_AFTER_SEC", "rotateAfterSeconds"),
    ...optNum(env, "AWS_DEPLOY_MAX_IDLE_SEC", "maxIdleDurationSeconds"),
    ...optNum(env, "AWS_DEPLOY_SUSPENDED_SEC", "suspendedDurationSeconds"),
    ...(env.AWS_DEPLOY_APPS_DOMAIN ? { appsDomain: env.AWS_DEPLOY_APPS_DOMAIN } : {}),
    ...(env.AWS_DEPLOY_GATE_SECRET ? { gateSecret: env.AWS_DEPLOY_GATE_SECRET } : {}),
    ...optNum(env, "AWS_DEPLOY_TOKEN_TTL_MIN", "tokenTtlMinutes"),
    ...(env.AWS_DEPLOY_DATA_BUCKET ? { dataBucket: env.AWS_DEPLOY_DATA_BUCKET } : {}),
    ...(env.AWS_DEPLOY_DATA_PREFIX ? { dataPrefix: env.AWS_DEPLOY_DATA_PREFIX } : {}),
    ...(env.AWS_DEPLOY_DATA_ROLE_ARN ? { dataRoleArn: env.AWS_DEPLOY_DATA_ROLE_ARN } : {}),
    ...(numEnvStrict("AWS_DEPLOY_SNAPSHOT_INTERVAL_MS", env.AWS_DEPLOY_SNAPSHOT_INTERVAL_MS) !== undefined
      ? {
          snapshotIntervalMs: Math.max(
            60_000,
            numEnvStrict("AWS_DEPLOY_SNAPSHOT_INTERVAL_MS", env.AWS_DEPLOY_SNAPSHOT_INTERVAL_MS)!,
          ),
        }
      : {}),
  };
}

interface FlyDeployEnv {
  token: string;
  appPrefix: string;
  sharedAppName?: string;
  wireguardPeers?: string;
  metadataUri?: string;
  baseImage: string;
  org: string;
  region?: string;
  dataVolumeSizeGb?: number;
}

function flyDeployEnv(env: NodeJS.ProcessEnv): FlyDeployEnv {
  return {
    token: env.FLY_DEPLOY_API_TOKEN ?? "",
    appPrefix: env.FLY_DEPLOY_APP_PREFIX ?? "",
    ...(env.FLY_DEPLOY_SHARED_APP_NAME ? { sharedAppName: env.FLY_DEPLOY_SHARED_APP_NAME } : {}),
    ...(env.FLY_DEPLOY_WIREGUARD_PEERS ? { wireguardPeers: env.FLY_DEPLOY_WIREGUARD_PEERS } : {}),
    ...(env.ECS_CONTAINER_METADATA_URI_V4 ? { metadataUri: env.ECS_CONTAINER_METADATA_URI_V4 } : {}),
    baseImage: env.FLY_DEPLOY_BASE_IMAGE ?? "",
    org: env.FLY_ORG ?? "",
    ...(env.FLY_REGION ? { region: env.FLY_REGION } : {}),
    ...(env.FLY_DEPLOY_DATA_VOLUME_SIZE_GB !== undefined
      ? { dataVolumeSizeGb: Number(env.FLY_DEPLOY_DATA_VOLUME_SIZE_GB) }
      : {}),
  };
}

const DEFAULT_ORG_ID = "default-org";

export function orgId(): string {
  return process.env.ORG_ID ?? DEFAULT_ORG_ID;
}

export function orgScope(): string {
  return `org:${orgId()}`;
}

export const OPENCODE_RUNTIME_VERSION = "1.17.18";

export const CONFIG_DEFAULTS = {
  port: 8080,
  rateLimitPerWindow: 60,
  rateLimitWindowMs: 60_000,
  budgetWindowMs: 86_400_000,
  execTimeoutDefaultSec: 120,
  execTimeoutMaxSec: 300,
  turnWallClockSec: 0,
  runMaxAgeMs: 24 * 60 * 60_000,
  backgroundJobTtlSec: 1800,
  backgroundJobTtlMaxSec: 3600,
  backgroundWorkEnabled: true,
  monitorPollMs: 10_000,
  skillSyncPollMs: 0,
  deployDialTimeoutMs: 20_000,
  deepIdleMachineMs: 3 * 24 * 60 * 60_000,
  devIdleMachineMs: 2 * 60 * 60_000,
  cronFireConcurrency: 4,
  monitorHeartbeatSec: 180,
  approvalSummaryTimeoutMs: 6_000,
  turnLeaseWaitMs: 5_000,
  securityScreenTimeoutMs: 15_000,
  workers: 16,
  leaseTtlMs: 120_000,
  heartbeatIntervalMs: 10_000,
  reaperIntervalMs: 15_000,
  shutdownDrainMs: 10_000,
  maxAttempts: 3,
  maxClaims: 8,
  processReaperIntervalMs: 30_000,
} as const;

export function boolEnv(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const v = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off", "none"].includes(v)) return false;
  return undefined;
}

export function numEnv(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function boolEnvStrict(name: string, value: string | undefined): boolean | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = boolEnv(value);
  if (parsed === undefined) {
    throw new Error(
      `${name}=${JSON.stringify(value)} is not a recognized boolean — use 1/true/yes/on or 0/false/no/off/none (case-insensitive), or unset it.`,
    );
  }
  return parsed;
}

function numEnvStrict(name: string, value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = numEnv(value);
  if (parsed === undefined) {
    throw new Error(`${name}=${JSON.stringify(value)} is not a number — set a finite numeric value, or unset it.`);
  }
  return parsed;
}

function optNum<K extends string>(env: NodeJS.ProcessEnv, name: string, key: K): Partial<Record<K, number>> {
  const parsed = numEnvStrict(name, env[name]);
  return parsed === undefined ? {} : ({ [key]: parsed } as Record<K, number>);
}

const lowercased = (value: string): string => value.trim().toLowerCase();

const orList = (items: readonly string[]): string =>
  items.length === 2 ? items.join(" or ") : `${items.slice(0, -1).join(", ")}, or ${items.at(-1)}`;

function enumEnvStrict<T extends string, F extends T | undefined>(
  name: string,
  value: string | undefined,
  allowed: readonly T[],
  fallback: F,
  normalize: (value: string) => string = (v) => v.trim(),
): T | F {
  if (value === undefined || value.trim() === "") return fallback;
  const normalized = normalize(value);
  if ((allowed as readonly string[]).includes(normalized)) return normalized as T;
  throw new Error(`${name}=${JSON.stringify(value)} is not recognized — use ${orList(allowed)}, or unset it.`);
}

function orgBrandingFromEnv(env: NodeJS.ProcessEnv): Config["brandingDefault"] {
  return sanitizeBranding({
    accent: env.ORG_BRAND_ACCENT,
    mark: env.ORG_BRAND_MARK,
    selfLabel: env.ORG_BRAND_SELF_LABEL,
    orgName: env.ORG_BRAND_ORG_NAME,
  });
}

export function enabledSandboxBackends(config: Config): Array<Config["sandboxBackend"]> {
  const credentialed: Record<Config["sandboxBackend"], boolean> = {
    local: Boolean(config.localSandbox?.image),
    sprites: Boolean(config.spritesSandbox?.token),
    smolmachines: Boolean(config.smolmachinesSandbox?.token),
    agent37: Boolean(config.agent37Sandbox?.apiKey),
    e2b: Boolean(config.e2bSandbox?.apiKey),
    modal: Boolean(config.modalSandbox?.tokenId && config.modalSandbox?.tokenSecret),
    aws: Boolean(config.awsSandbox?.s3Bucket),
    porter: Boolean(config.porterSandbox?.token),
  };
  const enabled = new Set<Config["sandboxBackend"]>([config.sandboxBackend]);
  for (const [name, on] of Object.entries(credentialed)) {
    if (on) enabled.add(name as Config["sandboxBackend"]);
  }
  return [...enabled];
}

function secretsBackendEnvStrict(value: string | undefined, prefix: string): Config["secretsBackend"] {
  const backend = enumEnvStrict("SECRETS_BACKEND", value, ["env", "aws"], "env");
  if (backend === "aws" && !prefix)
    throw new Error(
      "SECRETS_BACKEND=aws requires a non-empty SECRETS_PREFIX (e.g. qm-prod-) so lookups can't collide across stacks sharing an account.",
    );
  return backend;
}

function csvPaths(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  if (boolEnv(value) === false) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((p) => resolve(p));
}

function modelGatewayFromEnv(env: NodeJS.ProcessEnv): ModelGatewayTransportConfig | undefined {
  const names = ["MODEL_GATEWAY_URL", "MODEL_GATEWAY_API_KEY", "MODEL_GATEWAY_API_KEY_HEADER", "MODEL_GATEWAY_MODELS"];
  if (!names.some((name) => env[name]?.trim())) return undefined;
  for (const name of names.filter((name) => name !== "MODEL_GATEWAY_MODELS")) {
    if (!env[name]?.trim()) throw new Error(`${name} is required when model gateway routing is configured`);
  }
  const apiKeyHeader = env.MODEL_GATEWAY_API_KEY_HEADER!.trim();
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(apiKeyHeader)) {
    throw new Error("MODEL_GATEWAY_API_KEY_HEADER must be a valid HTTP header name");
  }
  const models: Record<string, string> = {};
  for (const mapping of env.MODEL_GATEWAY_MODELS?.trim() ? env.MODEL_GATEWAY_MODELS.split(",") : []) {
    const separator = mapping.indexOf("=");
    const source = mapping.slice(0, separator).trim();
    const target = mapping.slice(separator + 1).trim();
    if (separator < 1 || !source || !target) throw new Error(`invalid MODEL_GATEWAY_MODELS mapping: ${mapping}`);
    if (models[source]) throw new Error(`duplicate MODEL_GATEWAY_MODELS source: ${source}`);
    models[source] = target;
  }
  return {
    url: parseProviderBaseUrl("MODEL_GATEWAY_URL", env.MODEL_GATEWAY_URL!),
    apiKey: env.MODEL_GATEWAY_API_KEY!,
    apiKeyHeader,
    models,
  };
}

function defaultPluginSkillDirs(): string[] {
  const root = resolve("./plugins");
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(root, entry.name, "skills"))
      .filter((dir) => existsSync(dir));
  } catch {
    return [];
  }
}

function modelProviderEnvStrict(env: NodeJS.ProcessEnv, harness: Config["harness"]): ModelProvider | undefined {
  const declared = env.MODEL_PROVIDER?.trim();
  if (!declared) return undefined;
  if (!isModelProvider(declared)) {
    throw new Error(
      `MODEL_PROVIDER=${JSON.stringify(declared)} is not recognized — use ${MODEL_PROVIDERS.join(", ")}.`,
    );
  }
  const base = defaultModelForProvider(harness, declared);
  if (!base) {
    throw new Error(
      `MODEL_PROVIDER=${declared} cannot serve a base model on HARNESS=${harness} — that harness runs no ${declared} model, so every turn would be refused.`,
    );
  }
  return declared;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  if (env.BACKGROUND_DEPLOYMENT_ID !== undefined) {
    if (!env.BACKGROUND_DEPLOYMENT_ID.trim() || env.BACKGROUND_DEPLOYMENT_ID.length > 256)
      throw new Error("BACKGROUND_DEPLOYMENT_ID must be nonempty and at most 256 characters");
    if (!env.DATABASE_URL) throw new Error("Background ownership requires DATABASE_URL");
    if (
      !isStrongSigningSecret(env.CORE_SIGNING_SECRET) ||
      !isStrongSigningSecret(env.DEPLOYMENT_CONTROL_SECRET) ||
      env.DEPLOYMENT_CONTROL_SECRET === env.CORE_SIGNING_SECRET
    )
      throw new Error(
        "Background ownership requires a distinct DEPLOYMENT_CONTROL_SECRET of at least 32 characters and CORE_SIGNING_SECRET",
      );
  }
  const swarmDefaults = resolveSwarmSettings(
    env.SWARM_DEFAULTS === undefined ? undefined : JSON.parse(env.SWARM_DEFAULTS),
  );
  const harness = enumEnvStrict("HARNESS", env.HARNESS, HARNESSES, "mock");
  const codexAuthCredential = env.CODEX_AUTH_CREDENTIAL?.trim() || undefined;
  const claudeAuthCredential = env.CLAUDE_AUTH_CREDENTIAL?.trim() || undefined;
  const codexAuthCandidate = harness === "codex" && !codexAuthCredential ? codexAuthFileForEnv(env, true) : undefined;
  const codexOAuthConfigured = Boolean(codexAuthCandidate && readCodexOAuthAuthFile(codexAuthCandidate));
  const secretEnv =
    codexOAuthConfigured && codexAuthCandidate
      ? { ...env, CODEX_AUTH_FILE: codexAuthCandidate }
      : { ...env, CODEX_AUTH_FILE: undefined };
  const deployAppsDomain = deployAppsDomainEnv(env, env.DEPLOY_PROVIDER ?? "docker");
  const missingSecrets = validateCoreSecretEnv(secretEnv);
  if (missingSecrets.length) {
    throw new Error(`missing or insecure required core secrets: ${missingSecrets.join(", ")}`);
  }
  if (harness === "codex" && !env.OPENAI_API_KEY?.trim() && !codexOAuthConfigured && !codexAuthCredential) {
    throw new Error(
      "HARNESS=codex needs OPENAI_API_KEY, a keychain credential via CODEX_AUTH_CREDENTIAL, or a readable ChatGPT OAuth auth.json via CODEX_AUTH_FILE (or ~/.codex/auth.json)",
    );
  }
  if (env.NODE_ENV === "production" && codexOAuthConfigured) {
    throw new Error(
      "CODEX_AUTH_FILE is supported for local Codex harnesses only; production must use CODEX_AUTH_CREDENTIAL (keychain custody)",
    );
  }
  const modelProvider = modelProviderEnvStrict(env, harness);
  for (const key of ["SESSION_STORE", "RUN_STORE", "ARTIFACT_STORE"] as const) {
    if (env[key] === "sqlite") {
      throw new Error(
        `${key}=sqlite is no longer supported — SQLite was removed. ` +
          `Set ${key === "ARTIFACT_STORE" ? "DATABASE_URL (Postgres)" : `${key}=postgres (with DATABASE_URL)`} for durability, ` +
          `or use the in-memory default (${key === "ARTIFACT_STORE" ? "unset ARTIFACT_STORE" : `${key}=memory`}) for an ephemeral store.`,
      );
    }
  }
  if (env.E2B_API_KEY && !env.E2B_SNAPSHOT_S3_BUCKET) {
    console.warn(
      "[config] e2b sandbox backend enabled without E2B_SNAPSHOT_S3_BUCKET — provider pause preserves the machine, but portable recovery snapshots are memory-only; set E2B_SNAPSHOT_S3_BUCKET for durable portable recovery.",
    );
  }
  if (env.MODAL_TOKEN_ID && env.MODAL_TOKEN_SECRET && !env.MODAL_SNAPSHOT_S3_BUCKET) {
    console.warn(
      "[config] modal sandbox backend enabled without MODAL_SNAPSHOT_S3_BUCKET — native home checkpoints have limited retention; portable recovery snapshots are memory-only. Set MODAL_SNAPSHOT_S3_BUCKET for durable portable recovery and configure DATABASE_URL for durable checkpoint references.",
    );
  }
  if (env.NODE_ENV === "production" && harness === "mock") {
    console.warn(
      `[config] HARNESS is ${env.HARNESS?.trim() ? '"mock"' : "unset, which means mock"} in production — this deployment answers every message with canned text and calls no model provider. Set HARNESS=pi to run real agent turns.`,
    );
  }
  if (env.SANDBOX_BACKEND === "sprites" && !env.SPRITES_EGRESS_PROXY_URL) {
    console.warn(
      "[config] SANDBOX_BACKEND=sprites without SPRITES_EGRESS_PROXY_URL — sandboxes run with NO egress enforcement (fail-open); set SPRITES_EGRESS_PROXY_URL to the public egress proxy to force sandbox traffic through it.",
    );
  }
  const dataDir = resolve(env.DATA_DIR ?? "./data");
  const porterSandboxSelected = env.SANDBOX_BACKEND === "porter";
  if (porterSandboxSelected && !env.PORTER_SANDBOX_EGRESS_PROXY_URL) {
    console.warn(
      "[config] SANDBOX_BACKEND=porter without PORTER_SANDBOX_EGRESS_PROXY_URL — sandboxes run with NO egress enforcement (fail-open); set PORTER_SANDBOX_EGRESS_PROXY_URL to the egress proxy to force sandbox traffic through it.",
    );
  }
  if (env.DEPLOY_PROVIDER === "porter" && !env.PORTER_DEPLOY_APPS_DOMAIN && !env.DEPLOY_APPS_DOMAIN) {
    console.warn(
      "[config] DEPLOY_PROVIDER=porter without an apps domain — published apps use hostnames assigned by the cluster and are reachable signed-in at /d/<app>/; set DEPLOY_APPS_DOMAIN to a domain you control to serve each app on its own subdomain.",
    );
  }
  for (const [selected, label] of [
    [porterSandboxSelected, "SANDBOX_BACKEND=porter"],
    [env.DEPLOY_PROVIDER === "porter", "DEPLOY_PROVIDER=porter"],
  ] as const) {
    if (selected && !porterLocatorPresent(env)) {
      throw new Error(
        `${label} requires PORTER_DEPLOY_PROJECT_ID and PORTER_DEPLOY_CLUSTER_ID (or PORTER_SANDBOX_BASE_URL, or PORTER_CLUSTER_ID) to locate the Porter sandbox API.`,
      );
    }
  }
  if (env.NODE_ENV === "production" && !env.SANDBOX_BACKEND?.trim()) {
    throw new Error(
      "SANDBOX_BACKEND must be set explicitly in production — use sprites, smolmachines, e2b, modal, porter, agent37, aws, or local.",
    );
  }
  const sandboxBackend = enumEnvStrict("SANDBOX_BACKEND", env.SANDBOX_BACKEND, SANDBOX_BACKENDS, "local");
  const sandboxScopeDefaults: SandboxScopeDefaults = {};
  if (env.SANDBOX_SCOPE_BACKENDS) {
    const values: unknown = JSON.parse(env.SANDBOX_SCOPE_BACKENDS);
    if (!values || typeof values !== "object" || Array.isArray(values))
      throw new Error("SANDBOX_SCOPE_BACKENDS must be an object of scope kinds and backend names");
    for (const [kind, value] of Object.entries(values)) {
      const parsed = parseScopeId(kind + ":scope").kind;
      if (!parsed || parsed !== kind || typeof value !== "string" || !value.trim())
        throw new Error("Invalid SANDBOX_SCOPE_BACKENDS entry: " + kind);
      sandboxScopeDefaults[parsed] = enumEnvStrict("SANDBOX_SCOPE_BACKENDS." + kind, value, SANDBOX_BACKENDS, "local");
    }
  }

  if (env.SANDBOX_SECONDARY_BACKEND?.trim()) {
    console.warn(
      `[config] SANDBOX_SECONDARY_BACKEND=${JSON.stringify(env.SANDBOX_SECONDARY_BACKEND.trim())} is retired and ignored — every backend whose credential is present is constructed; per-scope routes pick between them. Remove the variable.`,
    );
  }
  const retiredBrainEnv = ["BRAIN", "BRAIN_MCP_URL", "BRAIN_RO_CLIENT_ID", "BRAIN_RW_CLIENT_ID"].filter((name) =>
    env[name]?.trim(),
  );
  if (retiredBrainEnv.length) {
    console.warn(
      `[config] ${retiredBrainEnv.join(", ")} ${retiredBrainEnv.length === 1 ? "is" : "are"} retired and ignored — the brain integration was removed; point an external knowledge server at MEMORY_PROVIDER_CONFIG (docs/memory-providers.md). Remove the variables.`,
    );
  }
  const securityScreenBackend = enumEnvStrict(
    "SECURITY_SCREEN_BACKEND",
    env.SECURITY_SCREEN_BACKEND,
    ["off", "model", "proxy"],
    "off",
    lowercased,
  );
  const proxyProvider = env.SECURITY_SCREEN_PROXY_PROVIDER?.trim();
  const proxyEndpoint = env.SECURITY_SCREEN_PROXY_ENDPOINT?.trim();
  const proxyToken = env.SECURITY_SCREEN_PROXY_TOKEN?.trim();
  const proxyRollout = env.SECURITY_SCREEN_PROXY_ROLLOUT?.trim().toLowerCase();
  const hasProxyConfig = [proxyProvider, proxyEndpoint, proxyToken, proxyRollout].some(Boolean);
  if (securityScreenBackend === "proxy" && (!proxyProvider || !proxyEndpoint || !proxyToken || !proxyRollout)) {
    throw new Error(
      "SECURITY_SCREEN_BACKEND=proxy requires SECURITY_SCREEN_PROXY_PROVIDER, SECURITY_SCREEN_PROXY_ENDPOINT, SECURITY_SCREEN_PROXY_TOKEN, and SECURITY_SCREEN_PROXY_ROLLOUT",
    );
  }
  if (securityScreenBackend !== "proxy" && hasProxyConfig) {
    throw new Error("SECURITY_SCREEN_PROXY_* requires SECURITY_SCREEN_BACKEND=proxy");
  }
  if (proxyProvider && (proxyProvider.length > 63 || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(proxyProvider))) {
    throw new Error("SECURITY_SCREEN_PROXY_PROVIDER must be a lowercase DNS label");
  }
  if (proxyProvider === "surface" || proxyProvider === "origin") {
    throw new Error("SECURITY_SCREEN_PROXY_PROVIDER must not collide with a security screen metadata field");
  }
  if (proxyEndpoint) {
    try {
      const url = new URL(proxyEndpoint);
      if (url.protocol !== "https:" || url.username || url.password || url.hash || url.hostname.endsWith("."))
        throw new Error("endpoint");
    } catch {
      throw new Error(
        "SECURITY_SCREEN_PROXY_ENDPOINT must be an HTTPS URL without credentials, a fragment, or a trailing hostname dot",
      );
    }
  }
  if (proxyRollout && proxyRollout !== "shadow" && proxyRollout !== "enforce") {
    throw new Error("SECURITY_SCREEN_PROXY_ROLLOUT must be shadow or enforce");
  }
  const securityScreenTimeoutMs =
    numEnvStrict("SECURITY_SCREEN_TIMEOUT_MS", env.SECURITY_SCREEN_TIMEOUT_MS) ??
    CONFIG_DEFAULTS.securityScreenTimeoutMs;
  if (
    !Number.isSafeInteger(securityScreenTimeoutMs) ||
    securityScreenTimeoutMs <= 0 ||
    securityScreenTimeoutMs > 2_147_483_647
  ) {
    throw new Error("SECURITY_SCREEN_TIMEOUT_MS must be a positive integer no greater than 2147483647");
  }
  const publicApiUrl = env.PUBLIC_API_URL ?? env.AGENT_API_URL;
  const publicUrl = env.PUBLIC_WEB_URL || publicApiUrl;
  const deployProvider = env.DEPLOY_PROVIDER ?? "docker";
  if (
    deployProvider !== "aws" &&
    deployProvider !== "docker" &&
    deployProvider !== "fly" &&
    deployProvider !== "porter"
  ) {
    throw new Error(
      `DEPLOY_PROVIDER=${JSON.stringify(deployProvider)} is not recognized (expected aws, docker, fly, or porter)`,
    );
  }
  let runStore: "memory" | "postgres" = env.SESSION_STORE === "postgres" ? "postgres" : "memory";
  if (env.RUN_STORE === "memory" || env.RUN_STORE === "postgres") runStore = env.RUN_STORE;
  const codexEnv = { ...env };
  if (codexOAuthConfigured && codexAuthCandidate) codexEnv.CODEX_AUTH_FILE = codexAuthCandidate;
  else delete codexEnv.CODEX_AUTH_FILE;
  const providerBaseUrls = providerBaseUrlsFromEnv(env);
  const modelGateway = modelGatewayFromEnv(env);
  const codexProcessEnv = Object.fromEntries(
    [
      "PATH",
      "TMPDIR",
      "LANG",
      "LC_ALL",
      "SSL_CERT_FILE",
      "SSL_CERT_DIR",
      "NODE_EXTRA_CA_CERTS",
      "HTTP_PROXY",
      "HTTPS_PROXY",
      "NO_PROXY",
      "ALL_PROXY",
      "OPENAI_API_KEY",
      "CODEX_ACCESS_TOKEN",
      "HOME",
      "CODEX_HOME",
      "CODEX_AUTH_FILE",
    ].flatMap((name) => (codexEnv[name] === undefined ? [] : [[name, codexEnv[name]]])),
  ) as NodeJS.ProcessEnv;
  const claudeProcessEnv = Object.fromEntries(
    [
      "PATH",
      "TMPDIR",
      "LANG",
      "LC_ALL",
      "SSL_CERT_FILE",
      "SSL_CERT_DIR",
      "NODE_EXTRA_CA_CERTS",
      "HTTP_PROXY",
      "HTTPS_PROXY",
      "NO_PROXY",
      "ALL_PROXY",
      "ANTHROPIC_API_KEY",
      "ANTHROPIC_AUTH_TOKEN",
      "CLAUDE_CODE_OAUTH_TOKEN",
    ].flatMap((name) => (env[name] === undefined ? [] : [[name, env[name]]])),
  ) as NodeJS.ProcessEnv;
  if (providerBaseUrls.openai) codexProcessEnv.OPENAI_BASE_URL = providerBaseUrls.openai;
  if (providerBaseUrls.anthropic) claudeProcessEnv.ANTHROPIC_BASE_URL = providerBaseUrls.anthropic;
  const turnWallClockMs =
    (numEnvStrict("TURN_WALL_CLOCK_SEC", env.TURN_WALL_CLOCK_SEC) ?? CONFIG_DEFAULTS.turnWallClockSec) * 1000;
  const runMaxAgeMs =
    numEnvStrict("RUN_MAX_AGE_MS", env.RUN_MAX_AGE_MS) ??
    (turnWallClockMs > 0 ? 2 * turnWallClockMs : CONFIG_DEFAULTS.runMaxAgeMs);
  const slack = slackPluginConfigFromEnv(env);
  const slackEventsPort =
    env.SLACK_EVENTS_MODE?.trim() === "http" ? numEnvStrict("SLACK_EVENTS_PORT", env.SLACK_EVENTS_PORT) : undefined;
  if (
    slackEventsPort !== undefined &&
    (!Number.isSafeInteger(slackEventsPort) || slackEventsPort <= 0 || slackEventsPort > 65_535)
  ) {
    throw new Error("SLACK_EVENTS_PORT must be an integer from 1 through 65535");
  }
  const memoryProviderConfig = parseMemoryProviderConfig(env.MEMORY_PROVIDER_CONFIG, env);
  return {
    suggestedActivitiesEnabled: boolEnvStrict("SUGGESTED_ACTIVITIES_ENABLED", env.SUGGESTED_ACTIVITIES_ENABLED) ?? true,
    ...(env.SUGGESTED_ACTIVITIES_CONTEXT
      ? { suggestedActivitiesContext: env.SUGGESTED_ACTIVITIES_CONTEXT.slice(0, 8000) }
      : {}),
    production: env.NODE_ENV === "production",
    allowUnauthenticatedCore: boolEnvStrict("ALLOW_UNAUTHENTICATED_CORE", env.ALLOW_UNAUTHENTICATED_CORE) ?? false,
    port: numEnvStrict("PORT", env.PORT) ?? CONFIG_DEFAULTS.port,
    dataDir,
    orgId: env.ORG_ID ?? DEFAULT_ORG_ID,
    ...(env.POSTHOG_API_KEY?.trim()
      ? { productAnalytics: { apiKey: env.POSTHOG_API_KEY.trim(), host: env.POSTHOG_HOST?.trim() } }
      : {}),
    sessionStore: env.SESSION_STORE === "postgres" ? "postgres" : "memory",
    ...(env.DATABASE_URL ? { databaseUrl: env.DATABASE_URL } : {}),
    ...(env.DATABASE_POOL_URL ? { databasePoolUrl: env.DATABASE_POOL_URL } : {}),
    ...(env.DATABASE_POOL_CA_CERT ? { databasePoolCaCert: env.DATABASE_POOL_CA_CERT } : {}),
    ...(env.DATABASE_POOL_MAX ? { databasePoolMax: numEnvStrict("DATABASE_POOL_MAX", env.DATABASE_POOL_MAX) } : {}),
    ...(env.DATABASE_DIRECT_POOL_MAX
      ? { databaseDirectPoolMax: numEnvStrict("DATABASE_DIRECT_POOL_MAX", env.DATABASE_DIRECT_POOL_MAX) }
      : {}),
    ...(env.DATABASE_CA_CERT ? { databaseCaCert: env.DATABASE_CA_CERT } : {}),
    ...(env.DATABASE_CA_CERT_FILE ? { databaseCaCertFile: env.DATABASE_CA_CERT_FILE } : {}),
    harness,
    securityPosture: enumEnvStrict(
      "HARNESS_SECURITY_POSTURE",
      env.HARNESS_SECURITY_POSTURE,
      SECURITY_POSTURES,
      "auto",
      lowercased,
    ),
    sharingPosture: enumEnvStrict(
      "HARNESS_SHARING_POSTURE",
      env.HARNESS_SHARING_POSTURE,
      SHARING_POSTURES,
      "isolated",
      lowercased,
    ),
    securityScreenBackend,
    ...(securityScreenBackend === "proxy"
      ? {
          securityScreenProxy: {
            provider: proxyProvider!,
            endpoint: proxyEndpoint!,
            token: proxyToken!,
            shadow: proxyRollout === "shadow",
          },
        }
      : {}),
    sandboxBackend,
    sandboxScopeDefaults,
    sandboxResourcesEnabled: boolEnvStrict("SANDBOX_RESOURCES_ENABLED", env.SANDBOX_RESOURCES_ENABLED) ?? false,
    deployProvider,
    ...(env.EGRESS_SERVICE_HOSTS
      ? {
          egressServiceHosts: env.EGRESS_SERVICE_HOSTS.split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        }
      : {}),
    ...(orgBrandingFromEnv(env) ? { brandingDefault: orgBrandingFromEnv(env) } : {}),
    ...(env.PI_MODEL ? { modelId: env.PI_MODEL } : {}),
    ...(env.OPENCODE_MODEL || env.PI_MODEL ? { opencodeModel: env.OPENCODE_MODEL || env.PI_MODEL } : {}),
    ...(env.CODEX_MODEL ? { codexModel: env.CODEX_MODEL } : {}),
    ...(env.CODEX_BIN ? { codexBinPath: env.CODEX_BIN } : {}),
    ...(codexOAuthConfigured && codexAuthCandidate ? { codexAuthFile: codexAuthCandidate } : {}),
    ...(codexAuthCredential ? { codexAuthCredential } : {}),
    ...(claudeAuthCredential ? { claudeAuthCredential } : {}),
    codexProcessEnv,
    ...(env.CLAUDE_MODEL ? { claudeModel: env.CLAUDE_MODEL } : {}),
    ...(env.CLAUDE_BIN ? { claudeBinPath: env.CLAUDE_BIN } : {}),
    claudeProcessEnv,
    ...(env.PI_DETECT_MODEL ? { detectModelId: env.PI_DETECT_MODEL } : {}),
    ...(env.PI_TITLE_MODEL ? { titleModelId: env.PI_TITLE_MODEL } : {}),
    ...(env.PI_JUDGE_MODEL ? { judgeModelId: env.PI_JUDGE_MODEL } : {}),
    ...(env.ANTHROPIC_API_KEY ? { anthropicApiKey: env.ANTHROPIC_API_KEY } : {}),
    ...(env.OPENAI_API_KEY ? { openaiApiKey: env.OPENAI_API_KEY } : {}),
    ...(env.OPENROUTER_API_KEY ? { openrouterApiKey: env.OPENROUTER_API_KEY } : {}),
    ...(modelProvider ? { modelProvider } : {}),
    providerBaseUrls,
    ...(modelGateway ? { modelGateway } : {}),
    ...(env.TRUSTED_OIDC_ADMIN_ISSUER ? { trustedOidcAdminIssuer: env.TRUSTED_OIDC_ADMIN_ISSUER } : {}),
    ...(env.ADMIN_GRANTS ? { adminGrants: env.ADMIN_GRANTS } : {}),
    ...(env.AUTH_ALLOWED_EMAILS
      ? {
          emailAuthPrincipals: [
            ...new Set(
              env.AUTH_ALLOWED_EMAILS.split(",")
                .map((email) => email.trim().toLowerCase())
                .filter(Boolean),
            ),
          ],
        }
      : {}),
    ...(env.AUTH_ALLOWED_EMAIL_DOMAIN?.trim()
      ? { emailAuthDomain: env.AUTH_ALLOWED_EMAIL_DOMAIN.trim().toLowerCase() }
      : {}),
    ...(env.RESEND_API_KEY?.trim() ? { resendApiKey: env.RESEND_API_KEY.trim() } : {}),
    ...(env.AUTH_EMAIL_FROM?.trim() ? { emailFrom: env.AUTH_EMAIL_FROM.trim() } : {}),
    piCaptureRequests: boolEnvStrict("PI_CAPTURE_REQUESTS", env.PI_CAPTURE_REQUESTS) ?? true,
    piSystemCacheSplit: boolEnvStrict("PI_SYSTEM_CACHE_SPLIT", env.PI_SYSTEM_CACHE_SPLIT) ?? false,
    sessionTapeMode: env.SESSION_TAPE_MODE === "shadow" ? "shadow" : "serve",
    rateLimitPerWindow:
      numEnvStrict("RATE_LIMIT_PER_WINDOW", env.RATE_LIMIT_PER_WINDOW) ?? CONFIG_DEFAULTS.rateLimitPerWindow,
    rateLimitWindowMs:
      numEnvStrict("RATE_LIMIT_WINDOW_MS", env.RATE_LIMIT_WINDOW_MS) ?? CONFIG_DEFAULTS.rateLimitWindowMs,
    ...optNum(env, "BUDGET_USD_PER_WINDOW", "budgetUsdPerWindow"),
    ...optNum(env, "ORG_BUDGET_USD_PER_WINDOW", "orgBudgetUsdPerWindow"),
    budgetWindowMs: numEnvStrict("BUDGET_WINDOW_MS", env.BUDGET_WINDOW_MS) ?? CONFIG_DEFAULTS.budgetWindowMs,
    ...optNum(env, "MAX_CONTEXT_TOKENS", "maxContextTokens"),
    execTimeoutDefaultMs:
      (numEnvStrict("EXEC_TIMEOUT_DEFAULT_SEC", env.EXEC_TIMEOUT_DEFAULT_SEC) ??
        CONFIG_DEFAULTS.execTimeoutDefaultSec) * 1000,
    execTimeoutMaxMs:
      (numEnvStrict("EXEC_TIMEOUT_MAX_SEC", env.EXEC_TIMEOUT_MAX_SEC) ?? CONFIG_DEFAULTS.execTimeoutMaxSec) * 1000,
    turnWallClockMs,
    swarmsEnabled: boolEnvStrict("SWARMS_ENABLED", env.SWARMS_ENABLED) ?? true,
    swarmDefaults,
    runMaxAgeMs,
    runWaitMs: (turnWallClockMs > 0 ? turnWallClockMs : runMaxAgeMs) + 60_000,
    backgroundJobTtlMs:
      (numEnvStrict("BACKGROUND_JOB_TTL_SEC", env.BACKGROUND_JOB_TTL_SEC) ?? CONFIG_DEFAULTS.backgroundJobTtlSec) *
      1000,
    backgroundJobTtlMaxMs:
      (numEnvStrict("BACKGROUND_JOB_TTL_MAX_SEC", env.BACKGROUND_JOB_TTL_MAX_SEC) ??
        CONFIG_DEFAULTS.backgroundJobTtlMaxSec) * 1000,
    backgroundWorkEnabled:
      boolEnvStrict("BACKGROUND_WORK_ENABLED", env.BACKGROUND_WORK_ENABLED) ?? CONFIG_DEFAULTS.backgroundWorkEnabled,
    ...(env.BACKGROUND_DEPLOYMENT_ID
      ? { backgroundDeploymentId: env.BACKGROUND_DEPLOYMENT_ID, deploymentControlSecret: env.DEPLOYMENT_CONTROL_SECRET }
      : {}),
    ...(env.GIT_SHA ? { buildSha: env.GIT_SHA } : {}),
    ecsTaskProtection: boolEnvStrict("ECS_TASK_PROTECTION", env.ECS_TASK_PROTECTION) ?? true,
    ...(env.ECS_AGENT_URI ? { ecsAgentUri: env.ECS_AGENT_URI } : {}),
    monitorPollMs: numEnvStrict("MONITOR_POLL_MS", env.MONITOR_POLL_MS) ?? CONFIG_DEFAULTS.monitorPollMs,
    skillSyncPollMs: numEnvStrict("SKILL_SYNC_POLL_MS", env.SKILL_SYNC_POLL_MS) ?? CONFIG_DEFAULTS.skillSyncPollMs,
    monitorHeartbeatMs:
      (numEnvStrict("MONITOR_HEARTBEAT_SEC", env.MONITOR_HEARTBEAT_SEC) ?? CONFIG_DEFAULTS.monitorHeartbeatSec) * 1000,
    ...(env.CORE_SIGNING_SECRET ? { signingSecret: env.CORE_SIGNING_SECRET } : {}),
    ...((env.CAPABILITY_SECRET ?? env.CORE_SIGNING_SECRET)
      ? { capabilitySecret: env.CAPABILITY_SECRET ?? env.CORE_SIGNING_SECRET }
      : {}),
    ...((env.PORTAL_IDENTITY_SECRET ?? env.CORE_SIGNING_SECRET)
      ? { portalIdentitySecret: env.PORTAL_IDENTITY_SECRET ?? env.CORE_SIGNING_SECRET }
      : {}),
    requireSignedPortalIdentity: env.REQUIRE_SIGNED_PORTAL_IDENTITY === "1",
    ...(env.CONNECTOR_SECRET_KEY ? { connectorSecretKey: env.CONNECTOR_SECRET_KEY } : {}),
    ...(slackEventsPort !== undefined ? { slackEventsPort } : {}),
    secretsBackend: secretsBackendEnvStrict(env.SECRETS_BACKEND, env.SECRETS_PREFIX ?? ""),
    secretsPrefix: env.SECRETS_PREFIX ?? "",
    layerEnv: { ...env },
    ...(publicApiUrl ? { apiBaseUrl: publicApiUrl } : {}),
    ...(publicUrl ? { publicUrl } : {}),
    ...(env.PUBLIC_WEB_URL ? { publicWebUrl: env.PUBLIC_WEB_URL } : {}),
    ...(env.FLY_APP_NAME ? { flyAppName: env.FLY_APP_NAME } : {}),
    ...(slack ? { slack } : {}),
    slackContextSource: parseSlackContextSource(env.SLACK_CONTEXT_SOURCE),
    runStore,
    ...(env.SKILL_SIGNING_SECRET ? { skillSigningSecret: env.SKILL_SIGNING_SECRET } : {}),
    seedSkills: boolEnvStrict("SEED_SKILLS", env.SEED_SKILLS) ?? true,
    skillsSeedDir: resolve(env.SKILLS_SEED_DIR ?? "./skills-seed"),
    pluginSkillDirs: csvPaths(env.PLUGIN_SKILLS_DIRS) ?? defaultPluginSkillDirs(),
    ...(env.DEPLOYMENT_LAYER ? { deploymentLayerDir: resolve(env.DEPLOYMENT_LAYER) } : {}),
    memoryRecall: parseMemoryRecallMode(env.MEMORY_RECALL),
    memoryCapture: parseMemoryCaptureMode(env.MEMORY_CAPTURE),
    memoryStrategy: parseMemoryStrategyKind(env.MEMORY_STRATEGY),
    ...(memoryProviderConfig ? { memoryProviderConfig } : {}),
    ...optNum(env, "MEMORY_CONSOLIDATE_AFTER", "memoryConsolidateAfter"),
    memoryCaptureQuietMs:
      numEnvStrict("MEMORY_CAPTURE_QUIET_MS", env.MEMORY_CAPTURE_QUIET_MS) ?? DEFAULT_CAPTURE_QUIET_MS,
    ...optNum(env, "MEMORY_CAPTURE_MAX_TURNS", "memoryCaptureMaxTurns"),
    filesDirectUploadsEnabled: boolEnvStrict("FILES_DIRECT_UPLOADS_ENABLED", env.FILES_DIRECT_UPLOADS_ENABLED) ?? false,
    snapshotStore: env.SNAPSHOT_STORE === "s3" ? "s3" : "local",
    transferStore: env.TRANSFER_STORE === "s3" ? "s3" : "local",
    ...(env.S3_BUCKET ? { s3Bucket: env.S3_BUCKET } : {}),
    ...(env.S3_REGION ? { s3Region: env.S3_REGION } : {}),
    ...(env.S3_PREFIX ? { s3Prefix: env.S3_PREFIX } : {}),
    ...optNum(env, "DEPLOY_IDLE_TTL_MS", "deployIdleTtlMs"),
    deployGitDir: env.DEPLOY_GIT_DIR ? resolve(env.DEPLOY_GIT_DIR) : join(dataDir, "deploy-git"),
    deployDialTimeoutMs:
      numEnvStrict("DEPLOY_DIAL_TIMEOUT_MS", env.DEPLOY_DIAL_TIMEOUT_MS) ?? CONFIG_DEFAULTS.deployDialTimeoutMs,
    ...deployAppsEnv(env, publicUrl),
    deepIdleMachineMs:
      numEnvStrict("DEEP_IDLE_MACHINE_MS", env.DEEP_IDLE_MACHINE_MS) ?? CONFIG_DEFAULTS.deepIdleMachineMs,
    devIdleMachineMs: numEnvStrict("DEV_IDLE_MACHINE_MS", env.DEV_IDLE_MACHINE_MS) ?? CONFIG_DEFAULTS.devIdleMachineMs,
    cronFireConcurrency:
      numEnvStrict("CRON_FIRE_CONCURRENCY", env.CRON_FIRE_CONCURRENCY) ?? CONFIG_DEFAULTS.cronFireConcurrency,
    workers: numEnvStrict("WORKERS", env.WORKERS) ?? CONFIG_DEFAULTS.workers,
    leaseTtlMs: numEnvStrict("LEASE_TTL_MS", env.LEASE_TTL_MS) ?? CONFIG_DEFAULTS.leaseTtlMs,
    heartbeatIntervalMs:
      numEnvStrict("HEARTBEAT_INTERVAL_MS", env.HEARTBEAT_INTERVAL_MS) ??
      Math.max(1_000, Math.floor((numEnvStrict("LEASE_TTL_MS", env.LEASE_TTL_MS) ?? CONFIG_DEFAULTS.leaseTtlMs) / 3)),
    reaperIntervalMs: numEnvStrict("REAPER_INTERVAL_MS", env.REAPER_INTERVAL_MS) ?? CONFIG_DEFAULTS.reaperIntervalMs,
    shutdownDrainMs: numEnvStrict("SHUTDOWN_DRAIN_MS", env.SHUTDOWN_DRAIN_MS) ?? CONFIG_DEFAULTS.shutdownDrainMs,
    maxAttempts: numEnvStrict("MAX_ATTEMPTS", env.MAX_ATTEMPTS) ?? CONFIG_DEFAULTS.maxAttempts,
    maxClaims: numEnvStrict("MAX_CLAIMS", env.MAX_CLAIMS) ?? CONFIG_DEFAULTS.maxClaims,
    processReaperIntervalMs:
      numEnvStrict("PROCESS_REAPER_INTERVAL_MS", env.PROCESS_REAPER_INTERVAL_MS) ??
      CONFIG_DEFAULTS.processReaperIntervalMs,
    approvalSummaryTimeoutMs:
      numEnvStrict("APPROVAL_SUMMARY_TIMEOUT_MS", env.APPROVAL_SUMMARY_TIMEOUT_MS) ??
      CONFIG_DEFAULTS.approvalSummaryTimeoutMs,
    turnLeaseWaitMs: numEnvStrict("TURN_LEASE_WAIT_MS", env.TURN_LEASE_WAIT_MS) ?? CONFIG_DEFAULTS.turnLeaseWaitMs,
    securityScreenTimeoutMs,
    scratchExecEnabled: boolEnvStrict("EXECUTE_SCRATCH", env.EXECUTE_SCRATCH) ?? false,
    reachExecEnabled: boolEnvStrict("REACH_EXEC", env.REACH_EXEC) ?? false,
    sharedOwnerAuthIsolation: boolEnvStrict("SHARED_OWNER_AUTH_ISOLATION", env.SHARED_OWNER_AUTH_ISOLATION) ?? false,
    surfaceDebugFooter: boolEnvStrict("SURFACE_DEBUG_FOOTER", env.SURFACE_DEBUG_FOOTER) ?? false,
    eagerProvisionEnabled: boolEnvStrict("EAGER_PROVISION", env.EAGER_PROVISION) ?? true,
    awsSandbox: awsSandboxEnv(env),
    localSandbox: localSandboxEnv(env),
    spritesSandbox: spritesSandboxEnv(env),
    smolmachinesSandbox: smolmachinesSandboxEnv(env),
    agent37Sandbox: agent37SandboxEnv(env),
    porterSandbox: porterSandboxEnv(env),
    porterDeploy: porterDeployEnv(env),
    e2bSandbox: e2bSandboxEnv(env),
    modalSandbox: modalSandboxEnv(env),
    awsDeploy: {
      ...awsDeployEnv(env),
      ...(env.DEPLOY_APPS_DOMAIN && deployAppsDomain && !env.AWS_DEPLOY_APPS_DOMAIN
        ? { appsDomain: deployAppsDomain }
        : {}),
    },
    ...(deployAppsDomain ? { deployAppsDomain } : {}),
    flyDeploy: flyDeployEnv(env),
  };
}
