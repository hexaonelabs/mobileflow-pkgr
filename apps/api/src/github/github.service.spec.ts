import { GithubService } from './github.service';
import type { ConfigService } from '@nestjs/config';
import type { FirestoreService } from '../firestore/firestore.service';

// Task 2.1/2.2b (PHASE_2_TASKS.md) : le token d'installation GitHub App n'a jamais accès à
// l'API de billing/quota Actions — getActionsQuota() dégrade en `available: false` sans même
// tenter d'appel réseau (donc sans dépendre de FirestoreService/ConfigService pour ce test).
describe('GithubService.getActionsQuota', () => {
  it('always returns { available: false } without making any API call', async () => {
    const service = new GithubService(
      {} as unknown as ConfigService,
      {} as unknown as FirestoreService,
    );

    await expect(service.getActionsQuota('user1', 'owner/repo')).resolves.toEqual({
      available: false,
    });
  });
});
