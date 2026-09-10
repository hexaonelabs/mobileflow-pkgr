import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStorage } from '../../../testing/memory-storage';
import { AuthService } from './auth.service';
import { sessionExpiredInterceptor } from './session-expired.interceptor';

describe('sessionExpiredInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let router: Router;

  beforeEach(() => {
    vi.stubGlobal('localStorage', createMemoryStorage());
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([sessionExpiredInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    });
    router = TestBed.inject(Router);
  });

  afterEach(() => {
    httpMock.verify();
    vi.unstubAllGlobals();
  });

  it('efface la session et redirige vers /auth/login en cas de 401 alors que le user semblait connecté', async () => {
    localStorage.setItem('mobileflow_access_token', 'jwt-token');
    localStorage.setItem(
      'mobileflow_user',
      JSON.stringify({ id: '1', email: 'a@b.com', plan: 'free', githubInstallationId: null }),
    );
    const authService = TestBed.inject(AuthService);
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    expect(authService.isAuthenticated()).toBe(true);

    const request = firstValueFrom(http.get('/api/projects'));
    httpMock.expectOne('/api/projects').flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });

    await expect(request).rejects.toBeTruthy();
    expect(authService.isAuthenticated()).toBe(false);
    expect(authService.getToken()).toBeNull();
    expect(navigateSpy).toHaveBeenCalledWith(['/auth/login'], { queryParams: { sessionExpired: true } });
  });

  it('ne touche pas à la session pour les autres erreurs', async () => {
    localStorage.setItem('mobileflow_access_token', 'jwt-token');
    localStorage.setItem(
      'mobileflow_user',
      JSON.stringify({ id: '1', email: 'a@b.com', plan: 'free', githubInstallationId: null }),
    );
    const authService = TestBed.inject(AuthService);
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    const request = firstValueFrom(http.get('/api/projects'));
    httpMock.expectOne('/api/projects').flush('Server error', { status: 500, statusText: 'Server Error' });

    await expect(request).rejects.toBeTruthy();
    expect(authService.isAuthenticated()).toBe(true);
    expect(navigateSpy).not.toHaveBeenCalled();
  });
});
