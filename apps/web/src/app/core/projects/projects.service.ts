import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import type {
  Build,
  CreateBuildPayload,
  CreateProjectPayload,
  CreateSecretPayload,
  Project,
  Secret,
  UpdateProjectPayload,
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

  listBuilds(projectId: string): Promise<Build[]> {
    return firstValueFrom(this.http.get<Build[]>(`${this.baseUrl}/${projectId}/builds`));
  }

  createBuild(projectId: string, payload: CreateBuildPayload): Promise<Build[]> {
    return firstValueFrom(this.http.post<Build[]>(`${this.baseUrl}/${projectId}/builds`, payload));
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
}
