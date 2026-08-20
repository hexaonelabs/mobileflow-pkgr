import { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';

export const routes: Routes = [
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./shared/layout/app-shell').then((m) => m.AppShell),
    children: [
      {
        path: '',
        loadComponent: () => import('./features/home/home').then((m) => m.Home),
      },
      {
        path: 'github/connect',
        loadComponent: () =>
          import('./features/github/connect/github-connect').then((m) => m.GithubConnect),
      },
      {
        path: 'projects',
        loadComponent: () =>
          import('./features/projects/list/projects-list').then((m) => m.ProjectsList),
      },
    ],
  },
  {
    path: 'projects/:id',
    canActivate: [authGuard],
    loadComponent: () => import('./shared/layout/project-shell').then((m) => m.ProjectShell),
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./features/projects/detail/project-detail').then((m) => m.ProjectDetail),
      },
      {
        path: 'builds/new',
        loadComponent: () =>
          import('./features/projects/build-new/project-build-new').then(
            (m) => m.ProjectBuildNew,
          ),
      },
      {
        path: 'builds',
        loadComponent: () =>
          import('./features/projects/builds/project-builds').then((m) => m.ProjectBuilds),
      },
      {
        path: 'builds/:buildId',
        loadComponent: () =>
          import('./features/projects/builds/build-detail/build-detail').then(
            (m) => m.BuildDetail,
          ),
      },
      {
        path: 'secrets',
        loadComponent: () =>
          import('./features/projects/secrets/project-secrets').then((m) => m.ProjectSecrets),
      },
      {
        path: 'analytics',
        loadComponent: () =>
          import('./features/projects/analytics/analytics').then((m) => m.Analytics),
      },
    ],
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
    path: 'github/connect/callback',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/github/connect-callback/github-connect-callback').then(
        (m) => m.GithubConnectCallback,
      ),
  },
  { path: '**', redirectTo: '' },
];
