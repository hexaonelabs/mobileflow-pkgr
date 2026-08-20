import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import type {
  AnalyticsBreakdown,
  AnalyticsSummary,
  AnalyticsTrends,
  Build,
  CreateBuildPayload,
  CreateProjectPayload,
  CreateSecretPayload,
  NotificationConfig,
  Project,
  RepoReadiness,
  Secret,
  SetupTriggerResult,
  UpdateProjectPayload,
  UpsertNotificationConfigPayload,
} from './project.models';

@Injectable({ providedIn: 'root' })
export class ProjectsService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/projects`;

  create(payload: CreateProjectPayload): Promise<Project> {
    return firstValueFrom(this.http.post<Project>(this.baseUrl, payload));
  }

  list(): Promise<Project[]> {
    return firstValueFrom(this.http.get<Project[]>(this.baseUrl));
  }

  get(id: string): Promise<Project> {
    return firstValueFrom(this.http.get<Project>(`${this.baseUrl}/${id}`));
  }

  update(id: string, payload: UpdateProjectPayload): Promise<Project> {
    return firstValueFrom(this.http.patch<Project>(`${this.baseUrl}/${id}`, payload));
  }

  remove(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${this.baseUrl}/${id}`));
  }

  getReadiness(id: string): Promise<RepoReadiness> {
    return firstValueFrom(this.http.get<RepoReadiness>(`${this.baseUrl}/${id}/readiness`));
  }

  triggerSetup(id: string, webDir: string): Promise<SetupTriggerResult> {
    return firstValueFrom(
      this.http.post<SetupTriggerResult>(`${this.baseUrl}/${id}/readiness/setup`, { webDir }),
    );
  }

  resetBuildWorkflow(id: string): Promise<void> {
    return firstValueFrom(this.http.post<void>(`${this.baseUrl}/${id}/workflow/reset`, {}));
  }

  listBuilds(projectId: string): Promise<Build[]> {
    return firstValueFrom(this.http.get<Build[]>(`${this.baseUrl}/${projectId}/builds`));
  }

  getBuild(projectId: string, buildId: string): Promise<Build> {
    return firstValueFrom(
      this.http.get<Build>(`${this.baseUrl}/${projectId}/builds/${buildId}`),
    );
  }

  createBuild(projectId: string, payload: CreateBuildPayload): Promise<Build[]> {
    return firstValueFrom(this.http.post<Build[]>(`${this.baseUrl}/${projectId}/builds`, payload));
  }

  refreshBuild(projectId: string, buildId: string): Promise<Build> {
    return firstValueFrom(
      this.http.post<Build>(`${this.baseUrl}/${projectId}/builds/${buildId}/refresh`, {}),
    );
  }

  getBuildArtifactUrl(projectId: string, buildId: string): Promise<{ url: string }> {
    return firstValueFrom(
      this.http.get<{ url: string }>(
        `${this.baseUrl}/${projectId}/builds/${buildId}/artifact-url`,
      ),
    );
  }

  installBuild(projectId: string, buildId: string): Promise<Build> {
    return firstValueFrom(
      this.http.post<Build>(`${this.baseUrl}/${projectId}/builds/${buildId}/install`, {}),
    );
  }

  listSecrets(projectId: string): Promise<Secret[]> {
    return firstValueFrom(this.http.get<Secret[]>(`${this.baseUrl}/${projectId}/secrets`));
  }

  createSecret(projectId: string, payload: CreateSecretPayload): Promise<Secret> {
    return firstValueFrom(
      this.http.post<Secret>(`${this.baseUrl}/${projectId}/secrets`, payload),
    );
  }

  removeSecret(projectId: string, secretId: string): Promise<void> {
    return firstValueFrom(
      this.http.delete<void>(`${this.baseUrl}/${projectId}/secrets/${secretId}`),
    );
  }

  getAnalyticsSummary(projectId: string): Promise<AnalyticsSummary> {
    return firstValueFrom(
      this.http.get<AnalyticsSummary>(`${this.baseUrl}/${projectId}/analytics/summary`),
    );
  }

  getAnalyticsTrends(projectId: string): Promise<AnalyticsTrends> {
    return firstValueFrom(
      this.http.get<AnalyticsTrends>(`${this.baseUrl}/${projectId}/analytics/trends`),
    );
  }

  getAnalyticsBreakdown(projectId: string): Promise<AnalyticsBreakdown> {
    return firstValueFrom(
      this.http.get<AnalyticsBreakdown>(`${this.baseUrl}/${projectId}/analytics/breakdown`),
    );
  }

  getNotificationConfig(projectId: string): Promise<NotificationConfig> {
    return firstValueFrom(
      this.http.get<NotificationConfig>(`${this.baseUrl}/${projectId}/notifications/config`),
    );
  }

  updateNotificationConfig(
    projectId: string,
    payload: UpsertNotificationConfigPayload,
  ): Promise<NotificationConfig> {
    return firstValueFrom(
      this.http.post<NotificationConfig>(
        `${this.baseUrl}/${projectId}/notifications/config`,
        payload,
      ),
    );
  }

  testNotification(projectId: string): Promise<{ message: string }> {
    return firstValueFrom(
      this.http.post<{ message: string }>(`${this.baseUrl}/${projectId}/notifications/test`, {}),
    );
  }
}
