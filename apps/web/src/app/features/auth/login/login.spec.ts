import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStorage } from '../../../../testing/memory-storage';
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

  it('désactive le bouton de soumission tant que le formulaire est invalide', () => {
    const fixture = TestBed.createComponent(Login);
    fixture.detectChanges();
    const button: HTMLButtonElement = fixture.nativeElement.querySelector('button[type="submit"]');
    expect(button.disabled).toBe(true);
  });

  it('active le bouton de soumission une fois le formulaire valide', () => {
    const fixture = TestBed.createComponent(Login);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component['form'].setValue({ email: 'a@b.com', password: 'password123' });
    fixture.detectChanges();
    const button: HTMLButtonElement = fixture.nativeElement.querySelector('button[type="submit"]');
    expect(button.disabled).toBe(false);
  });
});
