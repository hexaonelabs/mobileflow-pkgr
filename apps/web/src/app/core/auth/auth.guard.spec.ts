import { TestBed } from '@angular/core/testing';
import { Router, UrlTree } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStorage } from '../../../testing/memory-storage';
import { authGuard } from './auth.guard';

describe('authGuard', () => {
  let router: Router;

  beforeEach(() => {
    vi.stubGlobal('localStorage', createMemoryStorage());
    TestBed.configureTestingModule({});
    router = TestBed.inject(Router);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function runGuard() {
    return TestBed.runInInjectionContext(() => authGuard({} as never, { url: '/' } as never));
  }

  it('laisse passer un utilisateur authentifié', () => {
    localStorage.setItem(
      'mobileflow_user',
      JSON.stringify({ id: '1', email: 'a@b.com', plan: 'free' }),
    );
    expect(runGuard()).toBe(true);
  });

  it('redirige vers /auth/login pour un utilisateur non authentifié', () => {
    const result = runGuard();
    expect(result).not.toBe(true);
    expect((result as UrlTree).toString()).toBe(router.createUrlTree(['/auth/login']).toString());
  });
});
