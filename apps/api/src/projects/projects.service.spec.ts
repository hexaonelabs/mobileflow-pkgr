import { ForbiddenException } from '@nestjs/common';
import type { FirestoreService } from '../firestore/firestore.service';
import type { GithubService } from '../github/github.service';
import type { QuotasService } from '../quotas/quotas.service';
import { Plan } from '../users/user.model';
import { ProjectsService } from './projects.service';

// Ne couvre que la logique de quota ajoutée à create() — les autres branches (repo
// introuvable, conflit de dépôt déjà activé) ne sont pas encore testées, hors scope de ce lot.

function createFirestore(options: { existingProjectsCount: number; conflictExists?: boolean }) {
  const { existingProjectsCount, conflictExists = false } = options;
  const quotaCountResult = { size: existingProjectsCount, empty: existingProjectsCount === 0 };
  const conflictResult = { empty: !conflictExists };

  const whereFn = jest.fn(() => ({
    // .where(field).get() : requête de comptage utilisée par le check de quota.
    get: () => Promise.resolve(quotaCountResult),
    // .where(field).where(field2).limit(1).get() : requête de conflit de dépôt déjà activé.
    where: jest.fn(() => ({
      limit: jest.fn(() => ({ get: () => Promise.resolve(conflictResult) })),
    })),
  }));

  const projectsRoot = {
    where: whereFn,
    add: jest.fn().mockResolvedValue({ id: 'new-proj' }),
  };

  const db = { collection: jest.fn(() => projectsRoot) };
  return { db: db as unknown as FirestoreService['db'], projectsRoot };
}

function fakeGithubService() {
  const listRepos = jest.fn().mockResolvedValue([{ fullName: 'owner/repo' }]);
  return { service: { listRepos } as unknown as GithubService, listRepos };
}

function fakeQuotasService(limit: number | null): QuotasService {
  return { getProjectsLimit: jest.fn().mockResolvedValue(limit) } as unknown as QuotasService;
}

describe('ProjectsService.create — quota enforcement', () => {
  it('throws ForbiddenException when the user already reached their plan limit', async () => {
    const { db } = createFirestore({ existingProjectsCount: 1 });
    const { service: githubService, listRepos } = fakeGithubService();
    const quotasService = fakeQuotasService(1);
    const service = new ProjectsService({ db }, githubService, quotasService);

    await expect(
      service.create('user1', Plan.free, { githubRepoFullName: 'owner/repo' }),
    ).rejects.toThrow(ForbiddenException);
    // Le check de quota doit court-circuiter avant même de contacter GitHub.
    expect(listRepos).not.toHaveBeenCalled();
  });

  it('creates the project when the user is under their plan limit', async () => {
    const { db, projectsRoot } = createFirestore({ existingProjectsCount: 1 });
    const service = new ProjectsService({ db }, fakeGithubService().service, fakeQuotasService(5));

    const project = await service.create('user1', Plan.starter, {
      githubRepoFullName: 'owner/repo',
    });

    expect(project.id).toBe('new-proj');
    expect(projectsRoot.add).toHaveBeenCalledTimes(1);
  });

  it('never blocks when the plan quota is unlimited (null)', async () => {
    const { db, projectsRoot } = createFirestore({ existingProjectsCount: 999 });
    const quotasService = fakeQuotasService(null);
    const service = new ProjectsService({ db }, fakeGithubService().service, quotasService);

    const project = await service.create('user1', Plan.pro, {
      githubRepoFullName: 'owner/repo',
    });

    expect(project.id).toBe('new-proj');
    expect(projectsRoot.add).toHaveBeenCalledTimes(1);
  });
});

describe('ProjectsService.getQuotaUsage', () => {
  it('returns the current usage and the plan limit', async () => {
    const { db } = createFirestore({ existingProjectsCount: 3 });
    const service = new ProjectsService({ db }, fakeGithubService().service, fakeQuotasService(5));

    await expect(service.getQuotaUsage('user1', Plan.starter)).resolves.toEqual({
      used: 3,
      limit: 5,
    });
  });

  it('returns a null limit as-is for unlimited plans', async () => {
    const { db } = createFirestore({ existingProjectsCount: 12 });
    const service = new ProjectsService(
      { db },
      fakeGithubService().service,
      fakeQuotasService(null),
    );

    await expect(service.getQuotaUsage('user1', Plan.pro)).resolves.toEqual({
      used: 12,
      limit: null,
    });
  });
});
