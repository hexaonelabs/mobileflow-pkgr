export type Platform = 'android' | 'ios';
export type Framework = 'capacitor';
export type Environment = 'staging' | 'production';
export type BuildStatus = 'queued' | 'running' | 'success' | 'failed' | 'cancelled';
export type TriggeredBy = 'manual' | 'push';

export interface Project {
  id: string;
  userId: string;
  name: string;
  githubRepoFullName: string;
  framework: Framework;
  autoTriggerBranch: string | null;
}

export interface CreateProjectPayload {
  githubRepoFullName: string;
  name?: string;
}

export interface UpdateProjectPayload {
  name?: string;
  autoTriggerBranch?: string | null;
}

export interface ProjectsQuota {
  used: number;
  limit: number | null;
}

export interface Build {
  id: string;
  projectId: string;
  triggeredBy: TriggeredBy;
  environment: Environment;
  platform: Platform;
  branch: string;
  commitSha: string;
  envVars: Record<string, string>;
  status: BuildStatus;
  githubRunId: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationSeconds: number | null;
  logsUrl: string | null;
  artifactUrl: string | null;
  artifactStoragePath: string | null;
  artifactUploadedAt: string | null;
  bundleId: string | null;
  bundleVersion: string | null;
  createdAt: string | null;
}

export interface CreateBuildPayload {
  environment: Environment;
  platforms: Platform[];
  branch: string;
  envVars?: Record<string, string>;
}

export type SecretType =
  | 'ios_certificate'
  | 'ios_provisioning_profile'
  | 'android_keystore'
  | 'app_store_connect_key';

export interface Secret {
  id: string;
  type: SecretType;
  environment: Environment | null;
  fileName: string;
  createdAt: string;
}

export interface RepoReadiness {
  hasPackageJson: boolean;
  capacitorInstalled: boolean;
  androidPlatformAdded: boolean;
  iosPlatformAdded: boolean;
}

export interface SetupTriggerResult {
  runId: number | null;
  htmlUrl: string | null;
}

export interface CreateSecretPayload {
  type: SecretType;
  fileName: string;
  fileBase64: string;
  environment?: Environment;
  password?: string;
  alias?: string;
  keyPassword?: string;
  issuerId?: string;
  keyId?: string;
}

export interface GenerateIosCertificatePayload {
  csrPem: string;
}

export interface GeneratedIosCertificate {
  certificateContentBase64: string;
  serialNumber: string;
  expirationDate: string;
}

interface PlatformOrEnvironmentStats {
  total: number;
  successful: number;
}

export interface AnalyticsSummary {
  userId: string;
  projectId: string;
  year: number;
  month: number;
  totalBuilds: number;
  totalSuccessful: number;
  totalFailed: number;
  totalCancelled: number;
  byPlatform: Record<Platform, PlatformOrEnvironmentStats>;
  byEnvironment: Record<Environment, PlatformOrEnvironmentStats>;
  avgDurationSeconds: number;
  successRate: number;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface AnalyticsTrends {
  months: Array<{
    year: number;
    month: number;
    total: number;
    successful: number;
    successRate: number;
  }>;
}

interface AnalyticsRate {
  count: number;
  rate: number;
}

export interface AnalyticsBreakdown {
  platform: Record<Platform, AnalyticsRate>;
  environment: Record<Environment, AnalyticsRate>;
}

export type NotificationEvent = 'build.started' | 'build.success' | 'build.failed';

export interface SlackNotificationConfig {
  webhookUrl: string;
  enabled: boolean;
  events: NotificationEvent[];
}

export interface DiscordNotificationConfig {
  webhookUrl: string;
  enabled: boolean;
  events: NotificationEvent[];
}

export interface EmailNotificationConfig {
  enabled: boolean;
  events: Exclude<NotificationEvent, 'build.started'>[];
}

export interface NotificationConfig {
  userId: string;
  projectId: string;
  slack?: SlackNotificationConfig;
  discord?: DiscordNotificationConfig;
  email?: EmailNotificationConfig;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface UpsertNotificationConfigPayload {
  slack?: SlackNotificationConfig;
}
