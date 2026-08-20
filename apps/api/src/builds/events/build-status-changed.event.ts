import type { BuildStatus, Environment } from '../build.model';
import type { Platform } from '../../projects/project.model';

export class BuildStatusChangedEvent {
  constructor(
    readonly buildId: string,
    readonly projectId: string,
    readonly userId: string,
    readonly platform: Platform,
    readonly environment: Environment,
    readonly status: BuildStatus,
    readonly durationSeconds: number | null,
    readonly previousStatus?: BuildStatus,
  ) {}
}
