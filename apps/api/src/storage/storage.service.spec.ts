import type { ConfigService } from '@nestjs/config';
import { StorageService } from './storage.service';

const deleteFile = jest.fn().mockResolvedValue(undefined);
const uploadFile = jest.fn().mockResolvedValue(undefined);
const getSignedUrl = jest.fn().mockResolvedValue(['https://signed.example/file']);
const file = jest.fn(() => ({
  delete: deleteFile,
  save: uploadFile,
  getSignedUrl,
}));
const bucket = jest.fn(() => ({ file }));

jest.mock('firebase-admin/storage', () => ({
  getStorage: () => ({ bucket }),
}));

function createConfigService(): ConfigService {
  return { getOrThrow: jest.fn().mockReturnValue('test-bucket') } as unknown as ConfigService;
}

describe('StorageService.deleteFile', () => {
  beforeEach(() => {
    deleteFile.mockClear();
    file.mockClear();
  });

  it('deletes the file at the given path, ignoring a missing file', async () => {
    const service = new StorageService(createConfigService());

    await service.deleteFile('builds/proj1/build1/app.ipa');

    expect(file).toHaveBeenCalledWith('builds/proj1/build1/app.ipa');
    expect(deleteFile).toHaveBeenCalledWith({ ignoreNotFound: true });
  });
});
