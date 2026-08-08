import { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';

export const routes: Routes = [
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./features/home/home').then((m) => m.Home),
  },
  {
    path: 'auth/login',
    loadComponent: () => import('./features/auth/login/login').then((m) => m.Login),
  },
  {
    path: 'auth/register',
    loadComponent: () => import('./features/auth/register/register').then((m) => m.Register),
  },
  {
    path: 'auth/callback',
    loadComponent: () =>
      import('./features/auth/callback/auth-callback').then((m) => m.AuthCallback),
  },
  {
    path: 'github/connect',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/github/connect/github-connect').then((m) => m.GithubConnect),
  },
  {
    path: 'github/connect/callback',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/github/connect-callback/github-connect-callback').then(
        (m) => m.GithubConnectCallback,
      ),
  },
  { path: '**', redirectTo: '' },
];
