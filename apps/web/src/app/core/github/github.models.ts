export interface GithubRequestedPermission {
  scope: string;
  label: string;
}

export interface GithubInstallUrlResponse {
  url: string;
  requestedPermissions: GithubRequestedPermission[];
}

export interface GithubRepo {
  fullName: string;
  defaultBranch: string;
  private: boolean;
}
