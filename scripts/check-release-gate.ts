import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export interface ReleaseGateValidationResult {
  ok: boolean;
  versionName: string;
  apkFilename: string;
  errors: string[];
}

export function validateReleaseGate(rootDir: string = process.cwd()): ReleaseGateValidationResult {
  const errors: string[] = [];
  let versionName = '';
  let apkFilename = '';

  const pkgPath = path.resolve(rootDir, 'package.json');
  let pkgVersion = '';
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      pkgVersion = String(pkg.version || '').trim();
    } catch (e: any) {
      errors.push(`Impossibile leggere package.json: ${e.message}`);
    }
  } else {
    errors.push('package.json non trovato.');
  }

  const gradlePath = path.resolve(rootDir, 'android-app/app/build.gradle.kts');
  if (fs.existsSync(gradlePath)) {
    const gradleRaw = fs.readFileSync(gradlePath, 'utf-8');
    versionName = gradleRaw.match(/versionName\s*=\s*"([^"]+)"/)?.[1]?.trim() || '';
    if (!versionName) {
      errors.push('versionName non trovato in android-app/app/build.gradle.kts.');
    }
  } else {
    errors.push('android-app/app/build.gradle.kts non trovato.');
  }

  if (pkgVersion && versionName && pkgVersion !== versionName) {
    errors.push(`Disallineamento versione tra package.json (${pkgVersion}) e build.gradle.kts (${versionName}).`);
  }

  const targetVersion = versionName || pkgVersion || '1.4.1';
  const expectedApkFilename = `photocloud-release-v${targetVersion}-signed.apk`;
  apkFilename = expectedApkFilename;

  const metaPath = path.resolve(rootDir, 'release/photocloud-release-build.json');
  let meta: any = null;
  if (!fs.existsSync(metaPath)) {
    errors.push('release/photocloud-release-build.json mancante.');
  } else {
    try {
      meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    } catch (e: any) {
      errors.push(`release/photocloud-release-build.json non valido: ${e.message}`);
    }
  }

  if (meta) {
    const metaVersion = String(meta.versionName || '').trim();
    if (metaVersion !== targetVersion) {
      errors.push(
        `versionName in release/photocloud-release-build.json (${metaVersion || 'vuoto'}) non corrisponde alla versione dichiarata (${targetVersion}).`
      );
    }

    const declaredApk = String(meta.apkFilename || '').trim();
    if (declaredApk) {
      apkFilename = declaredApk;
    }
    if (!apkFilename.includes(`v${targetVersion}`)) {
      errors.push(
        `apkFilename (${apkFilename}) non corrisponde alla versione dichiarata v${targetVersion} (atteso: ${expectedApkFilename}).`
      );
    }

    const sha256 = String(meta.sha256 || '').trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(sha256) || /^0+$/.test(sha256)) {
      errors.push(
        `sha256 non valido o placeholder a zeri in release/photocloud-release-build.json (${sha256 || 'vuoto'}).`
      );
    }

    const sizeBytes = Number(meta.sizeBytes);
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
      errors.push(`sizeBytes non valido o pari a 0 in release/photocloud-release-build.json (${meta.sizeBytes}).`);
    }

    const apkPath = path.resolve(rootDir, 'release', expectedApkFilename);
    if (!fs.existsSync(apkPath)) {
      errors.push(`APK della versione dichiarata mancante: release/${expectedApkFilename}.`);
    } else {
      const stat = fs.statSync(apkPath);
      if (stat.size <= 100 * 1024) {
        errors.push(`APK release/${expectedApkFilename} troppo piccolo (${stat.size} byte).`);
      }
      if (Number.isFinite(sizeBytes) && sizeBytes > 0 && stat.size !== sizeBytes) {
        errors.push(
          `Dimensione reale di release/${expectedApkFilename} (${stat.size} byte) diversa da sizeBytes nel manifest (${sizeBytes} byte).`
        );
      }
      if (/^[0-9a-f]{64}$/.test(sha256) && !/^0+$/.test(sha256)) {
        const actualSha256 = crypto.createHash('sha256').update(fs.readFileSync(apkPath)).digest('hex');
        if (actualSha256.toLowerCase() !== sha256) {
          errors.push(
            `SHA-256 reale di release/${expectedApkFilename} (${actualSha256}) diverso da sha256 nel manifest (${sha256}).`
          );
        }
      }
    }
  }

  return {
    ok: errors.length === 0,
    versionName: targetVersion,
    apkFilename,
    errors,
  };
}

const isDirectExecution = (() => {
  try {
    return process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (isDirectExecution) {
  const result = validateReleaseGate(process.cwd());
  if (!result.ok) {
    console.error(`[release:check] GATE FALLITO per PhotoCloud v${result.versionName}:`);
    for (const err of result.errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }
  console.log(`[release:check] OK — APK ${result.apkFilename} (v${result.versionName}) verificato con successo.`);
}
