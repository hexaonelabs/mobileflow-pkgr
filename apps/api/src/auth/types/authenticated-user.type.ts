export interface AuthenticatedUser {
  id: string;
  email: string;
  plan: string;
  githubInstallationId: string | null;
}
