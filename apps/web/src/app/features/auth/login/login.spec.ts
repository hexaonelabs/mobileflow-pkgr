import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStorage } from '../../../../testing/memory-storage';
import { AuthService } from '../../../core/auth/auth.service';
import { Login } from './login';

describe('Login', () => {
  beforeEach(async () => {
    vi.stubGlobal('localStorage', createMemoryStorage());
    await TestBed.configureTestingModule({
      imports: [Login],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('affiche un bouton de connexion GitHub', () => {
    const fixture = TestBed.createComponent(Login);
    fixture.detectChanges();
    const button: HTMLButtonElement | null =
      fixture.nativeElement.querySelector('button[type="button"]');
    expect(button?.textContent).toContain('Continue with GitHub');
  });

  it('délègue à AuthService.loginWithGithub au clic sur le bouton GitHub', () => {
    const fixture = TestBed.createComponent(Login);
    const authService = TestBed.inject(AuthService);
    const loginWithGithub = vi.spyOn(authService, 'loginWithGithub').mockImplementation(() => {});
    fixture.detectChanges();
    const button: HTMLButtonElement = fixture.nativeElement.querySelector('button[type="button"]');
    button.click();
    expect(loginWithGithub).toHaveBeenCalledOnce();
  });
});
