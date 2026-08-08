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
}

export interface CreateBuildPayload {
  environment: Environment;
  platforms: Platform[];
  branch: string;
  envVars?: Record<string, string>;
}
