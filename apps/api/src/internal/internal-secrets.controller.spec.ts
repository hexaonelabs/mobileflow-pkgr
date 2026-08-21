import { Environment } from '../builds/build.model';
import { Platform } from '../projects/project.model';
import type { SecretsService } from '../secrets/secrets.service';
import { InternalSecretsController } from './internal-secrets.controller';
import type { RunTokensService } from './run-tokens.service';

describe('InternalSecretsController.getSecrets - environment round-trip', () => {
  it('passes the environment from the consumed run token into getDecryptedForPlatform', async () => {
    const runTokens = {
      consumeToken: jest.fn().mockResolvedValue({
        buildId: 'build1',
        projectId: 'proj1',
        userId: 'user1',
        platform: Platform.ios,
        environment: Environment.production,
      }),
    };
    const secretsService = {
      getDecryptedForPlatform: jest.fn().mockResolvedValue({
        androidKeystore: null,
        iosCertificate: null,
        iosProvisioningProfile: null,
      }),
    };
    const controller = new InternalSecretsController(
      runTokens as unknown as RunTokensService,
      secretsService as unknown as SecretsService,
    );

    await controller.getSecrets('Bearer token123');

    expect(runTokens.consumeToken).toHaveBeenCalledWith('token123');
    expect(secretsService.getDecryptedForPlatform).toHaveBeenCalledWith(
      'user1',
      'proj1',
      Platform.ios,
      Environment.production,
    );
  });
});
