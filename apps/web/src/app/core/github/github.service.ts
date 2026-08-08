import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import type { GithubInstallUrlResponse, GithubRepo } from './github.models';

@Injectable({ providedIn: 'root' })
export class GithubService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/github`;

  getInstallUrl(): Promise<GithubInstallUrlResponse> {
    return firstValueFrom(this.http.get<GithubInstallUrlResponse>(`${this.baseUrl}/install-url`));
  }

  async completeInstallation(installationId: string): Promise<void> {
    await firstValueFrom(this.http.post(`${this.baseUrl}/callback`, { installationId }));
  }

  listRepos(): Promise<GithubRepo[]> {
    return firstValueFrom(this.http.get<GithubRepo[]>(`${this.baseUrl}/repos`));
  }

  listBranches(repoFullName: string): Promise<string[]> {
    return firstValueFrom(
      this.http.get<string[]>(`${this.baseUrl}/repos/${encodeURIComponent(repoFullName)}/branches`),
    );
  }
}
