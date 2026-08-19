import { Controller, Get, Header, NotFoundException, Param } from '@nestjs/common';
import { PROJECTS_COLLECTION, Platform, type ProjectDocument } from '../projects/project.model';
import { FirestoreService } from '../firestore/firestore.service';
import { StorageService } from '../storage/storage.service';
import { BUILDS_COLLECTION, BuildStatus, type BuildDocument } from './build.model';

const MANIFEST_IPA_URL_TTL_MS = 10 * 60 * 1000;

// Endpoint public (pas de JwtAuthGuard) : c'est le Springboard de l'iPhone qui appelle cette
// URL via itms-services://, pas le navigateur de l'utilisateur connecté — il ne peut pas
// envoyer d'en-tête Authorization. La protection repose sur le caractère non-devinable de
// l'ID de build (même modèle de confiance qu'un lien Diawi).
@Controller('builds')
export class PublicBuildsController {
  constructor(
    private readonly firestore: FirestoreService,
    private readonly storage: StorageService,
  ) {}

  @Get(':buildId/manifest.plist')
  @Header('Content-Type', 'application/xml; charset=utf-8')
  async getManifest(@Param('buildId') buildId: string): Promise<string> {
    const doc = await this.firestore.db.collection(BUILDS_COLLECTION).doc(buildId).get();
    const build = doc.data() as BuildDocument | undefined;
    if (
      !doc.exists ||
      !build ||
      build.platform !== Platform.ios ||
      build.status !== BuildStatus.success ||
      !build.artifactStoragePath
    ) {
      throw new NotFoundException("Build introuvable ou non disponible pour l'installation.");
    }

    const projectDoc = await this.firestore.db
      .collection(PROJECTS_COLLECTION)
      .doc(build.projectId)
      .get();
    const project = projectDoc.data() as ProjectDocument | undefined;
    const title = project?.name ?? 'Application';

    const ipaUrl = await this.storage.getSignedDownloadUrl(
      build.artifactStoragePath,
      MANIFEST_IPA_URL_TTL_MS,
    );
    const bundleId = build.bundleId ?? 'com.mobileflow.app';
    const bundleVersion = build.bundleVersion ?? '1.0';

    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>items</key>
  <array>
    <dict>
      <key>assets</key>
      <array>
        <dict>
          <key>kind</key>
          <string>software-package</string>
          <key>url</key>
          <string>${this.escapeXml(ipaUrl)}</string>
        </dict>
      </array>
      <key>metadata</key>
      <dict>
        <key>bundle-identifier</key>
        <string>${this.escapeXml(bundleId)}</string>
        <key>bundle-version</key>
        <string>${this.escapeXml(bundleVersion)}</string>
        <key>kind</key>
        <string>software</string>
        <key>title</key>
        <string>${this.escapeXml(title)}</string>
      </dict>
    </dict>
  </array>
</dict>
</plist>
`;
  }

  private escapeXml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
