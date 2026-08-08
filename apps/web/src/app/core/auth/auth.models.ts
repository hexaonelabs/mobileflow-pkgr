export interface AuthUser {
  id: string;
  email: string;
  plan: string;
  githubInstallationId: string | null;
}

export interface AuthResponse {
  accessToken: string;
  user: AuthUser;
}
