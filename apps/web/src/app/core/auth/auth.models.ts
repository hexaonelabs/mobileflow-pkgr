export interface AuthUser {
  id: string;
  email: string;
  plan: string;
}

export interface AuthResponse {
  accessToken: string;
  user: AuthUser;
}
