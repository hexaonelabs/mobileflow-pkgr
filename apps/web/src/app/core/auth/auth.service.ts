import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import type { AuthResponse, AuthUser } from './auth.models';

const TOKEN_STORAGE_KEY = 'mobileflow_access_token';
const USER_STORAGE_KEY = 'mobileflow_user';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/auth`;

  private readonly userSignal = signal<AuthUser | null>(this.readStoredUser());

  readonly currentUser = this.userSignal.asReadonly();
  readonly isAuthenticated = computed(() => this.userSignal() !== null);

  async register(email: string, password: string): Promise<void> {
    const response = await firstValueFrom(
      this.http.post<AuthResponse>(`${this.baseUrl}/register`, { email, password }),
    );
    this.storeSession(response);
  }

  async login(email: string, password: string): Promise<void> {
    const response = await firstValueFrom(
      this.http.post<AuthResponse>(`${this.baseUrl}/login`, { email, password }),
    );
    this.storeSession(response);
  }

  loginWithGoogle(): void {
    window.location.href = `${this.baseUrl}/oauth/google`;
  }

  loginWithGithub(): void {
    window.location.href = `${this.baseUrl}/oauth/github`;
  }

  async completeOAuthSession(token: string): Promise<void> {
    this.setToken(token);
    const user = await firstValueFrom(this.http.get<AuthUser>(`${this.baseUrl}/me`));
    this.storeUser(user);
  }

  logout(): void {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(USER_STORAGE_KEY);
    this.userSignal.set(null);
  }

  getToken(): string | null {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  }

  private storeSession(response: AuthResponse): void {
    this.setToken(response.accessToken);
    this.storeUser(response.user);
  }

  private storeUser(user: AuthUser): void {
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
    this.userSignal.set(user);
  }

  private setToken(token: string): void {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
  }

  private readStoredUser(): AuthUser | null {
    const raw = localStorage.getItem(USER_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  }
}
