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
  {
    path: 'projects',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/projects/list/projects-list').then((m) => m.ProjectsList),
  },
  {
    path: 'projects/:id',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/projects/detail/project-detail').then((m) => m.ProjectDetail),
  },
  {
    path: 'projects/:id/builds/new',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/projects/build-new/project-build-new').then((m) => m.ProjectBuildNew),
  },
  {
    path: 'projects/:id/builds',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/projects/builds/project-builds').then((m) => m.ProjectBuilds),
  },
  {
    path: 'projects/:id/secrets',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/projects/secrets/project-secrets').then((m) => m.ProjectSecrets),
  },
  { path: '**', redirectTo: '' },
];
