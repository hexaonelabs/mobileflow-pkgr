export type Platform = 'android' | 'ios';
export type Framework = 'capacitor';
export type Environment = 'staging' | 'production';
export type BuildStatus = 'queued' | 'running' | 'success' | 'failed' | 'cancelled';

export interface Project {
  id: string;
  userId: string;
  name: string;
  githubRepoFullName: string;
  framework: Framework;
}

export interface CreateProjectPayload {
  githubRepoFullName: string;
  name?: string;
}

export interface UpdateProjectPayload {
  name?: string;
}

export interface Build {
  id: string;
  projectId: string;
  environment: Environment;
  platform: Platform;
  branch: string;
  commitSha: string;
  envVars: Record<string, string>;
  status: BuildStatus;
  githubRunId: number | null;
  durationSeconds: number | null;
  logsUrl: string | null;
}

export interface CreateBuildPayload {
  environment: Environment;
  platforms: Platform[];
  branch: string;
  envVars?: Record<string, string>;
}

export type SecretType = 'ios_certificate' | 'android_keystore';

export interface Secret {
  id: string;
  type: SecretType;
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
  password: string;
  alias?: string;
  keyPassword?: string;
}
