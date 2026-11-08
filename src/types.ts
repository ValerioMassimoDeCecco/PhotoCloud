export interface MediaItem {
  filename: string;
  timestamp: number;
  size?: number;
}

export interface GroupedMedia {
  title: string;
  items: MediaItem[];
}

export interface AuthFilePayload {
  username: string;
  api_key: string;
  session_id: string;
  created_at: number;
  hash_of_key: string;
}

export interface AndroidBuildConfig {
  appName: string;
  packageName: string;
  versionName: string;
  versionCode: number;
  serverUrl: string;
  minSdk: number;
  targetSdk: number;
  enableBiometricLock: boolean;
  enableOfflineCache: boolean;
  enableAutoBackup: boolean;
  signingMode: 'debug' | 'release';
  keystoreAlias: string;
}

export interface AndroidReleaseArtifact {
  buildId: string;
  timestamp: number;
  config: AndroidBuildConfig;
  apkFilename: string;
  aabFilename: string;
  projectZipFilename: string;
  sha256Fingerprint: string;
  apkSizeBytes: number;
  steps: Array<{
    id: string;
    label: string;
    durationMs: number;
    status: 'completed';
    command: string;
  }>;
}
