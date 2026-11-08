import path from 'node:path';
import {
  compileSignedAndroidApk,
  triggerGitHubActionsBuild,
  publishApkToGitHubRelease,
} from '../src/lib/githubReleasePublisher';

async function main() {
  const outputDir = path.resolve(process.cwd(), 'release');
  console.log('[1/3] Preparazione progetto Android (/android-app) e pacchetto locale...');
  const { apkPath, sha256, metadataPath } = await compileSignedAndroidApk(outputDir);
  console.log(`✅ APK preparato: ${apkPath}`);
  console.log(`✅ SHA-256: ${sha256}`);
  console.log(`✅ Metadata: ${metadataPath}`);

  console.log('[2/3] Avvio compilazione remota tramite GitHub Actions (.github/workflows/android-release.yml)...');
  const actionsStatus = await triggerGitHubActionsBuild({
    githubToken: process.env.GITHUB_TOKEN,
    releaseTag: process.env.RELEASE_TAG || 'v1.0.7',
  });
  console.log(`✅ GitHub Actions: ${actionsStatus.message}`);
  if (actionsStatus.htmlUrl) {
    console.log(`🔗 Workflow URL: ${actionsStatus.htmlUrl}`);
  }

  console.log('[3/3] Verifica pubblicazione su GitHub Releases (ValerioMassimoDeCecco/PhotoCloud)...');
  const status = await publishApkToGitHubRelease({
    apkPath,
    sha256,
    githubToken: process.env.GITHUB_TOKEN,
    tagName: process.env.RELEASE_TAG || 'v1.0.7',
  });
  console.log(`✅ Stato Release: ${status.message}`);
  if (status.htmlUrl) {
    console.log(`🔗 URL Release GitHub: ${status.htmlUrl}`);
  }
}

main().catch((err) => {
  console.error('❌ Errore durante la build/pubblicazione della release:', err);
  process.exit(1);
});
