import path from 'node:path';
import {
  compileSignedAndroidApk,
  publishApkToGitHubRelease,
} from '../src/lib/githubReleasePublisher';

async function main() {
  const releaseDir = path.resolve(process.cwd(), 'release');
  console.log('[1/2] Compilazione e firma APK da /android-app...');
  const { apkPath, sha256, metadataPath } = await compileSignedAndroidApk(releaseDir);
  console.log(`✅ APK compilato: ${apkPath}`);
  console.log(`✅ SHA-256: ${sha256}`);
  console.log(`✅ Metadata: ${metadataPath}`);

  console.log('[2/2] Pubblicazione su GitHub Releases (ValerioMassimoDeCecco/PhotoCloud)...');
  try {
    const status = await publishApkToGitHubRelease({
      apkPath,
      sha256,
    });
    console.log(`✅ Stato Release: ${status.message}`);
    if (status.htmlUrl) {
      console.log(`🔗 GitHub Release URL: ${status.htmlUrl}`);
    }
  } catch (err) {
    console.error('❌ Errore durante la pubblicazione su GitHub:', err);
    process.exitCode = 1;
  }
}

main();
