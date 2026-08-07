import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { environment } from '../../../environments/environment';
import { createMemoryStorage } from '../../../testing/memory-storage';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    vi.stubGlobal('localStorage', createMemoryStorage());
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    vi.unstubAllGlobals();
  });

  it("n'est pas authentifié par défaut", () => {
    expect(service.isAuthenticated()).toBe(false);
    expect(service.currentUser()).toBeNull();
  });

  it('stocke le token et le user après un login réussi', async () => {
    const loginPromise = service.login('a@b.com', 'password123');

    const req = httpMock.expectOne(`${environment.apiUrl}/auth/login`);
    expect(req.request.method).toBe('POST');
    req.flush({
      accessToken: 'jwt-token',
      user: { id: '1', email: 'a@b.com', plan: 'free' },
    });

    await loginPromise;

    expect(service.isAuthenticated()).toBe(true);
    expect(service.currentUser()?.email).toBe('a@b.com');
    expect(service.getToken()).toBe('jwt-token');
  });

  it('efface la session au logout', async () => {
    const loginPromise = service.login('a@b.com', 'password123');
    httpMock
      .expectOne(`${environment.apiUrl}/auth/login`)
      .flush({ accessToken: 'jwt-token', user: { id: '1', email: 'a@b.com', plan: 'free' } });
    await loginPromise;

    service.logout();

    expect(service.isAuthenticated()).toBe(false);
    expect(service.getToken()).toBeNull();
  });
});
