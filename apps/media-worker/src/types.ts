import type { MediaManifestContent, StorageHealth, StorageReceipt } from './vendor-types.js';

export type ProcessingMode = 'managed' | 'preprocessed';
export type UploadState = 'uploading' | 'ready' | 'processing' | 'completed' | 'cancelled';

export interface CaptionInput {
  readonly language: string;
  readonly kind: 'captions' | 'subtitles' | 'descriptions';
  readonly reference: {
    readonly cid: string;
    readonly digest: string;
    readonly bytes: number;
    readonly mediaType: string;
  };
}

export interface UploadMetadataInput {
  readonly declaredMediaType: string;
  readonly totalBytes: number;
  readonly sha256: string;
  readonly processingMode: ProcessingMode;
  readonly metadataStripped?: true | undefined;
  readonly altText?: string | undefined;
  readonly caption?: string | undefined;
  readonly captions: readonly CaptionInput[];
  readonly storagePolicy: {
    readonly permanence: 'deletion-compatible' | 'provider-dependent' | 'permanent';
    readonly consentId?: string | undefined;
  };
}

export interface UploadRecord extends UploadMetadataInput {
  readonly id: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly updatedAt: string;
  readonly offset: number;
  readonly state: UploadState;
  readonly detectedMediaType?: string | undefined;
  readonly failureCode?: string | undefined;
  readonly result?: PublicationResult | undefined;
}

export interface ScannerResult {
  readonly status: 'passed' | 'failed';
  readonly scanner: string;
  readonly scannerVersion: string;
  readonly checkedAt: string;
  readonly detail?: string | undefined;
}

export interface MalwareScanner {
  readonly name: string;
  readonly available: boolean;
  healthCheck?(): Promise<boolean>;
  scan(input: {
    readonly path: string;
    readonly mediaType: string;
    readonly sha256: string;
    readonly byteLength: number;
    readonly signal: AbortSignal;
  }): Promise<ScannerResult>;
}

export interface DerivedArtifact {
  readonly purpose:
    'original' | 'thumbnail' | 'responsive' | 'poster' | 'hls-master' | 'hls-segment' | 'audio';
  readonly bytes: Uint8Array;
  readonly mediaType: string;
  readonly width?: number;
  readonly height?: number;
  readonly durationMilliseconds?: number;
}

export interface HlsArtifacts {
  readonly segments: readonly DerivedArtifact[];
  readonly targetDurationSeconds: number;
  readonly segmentDurationsSeconds: readonly number[];
}

export interface ProcessedMedia {
  readonly original: DerivedArtifact;
  readonly variants: readonly DerivedArtifact[];
  readonly hls?: HlsArtifacts;
  readonly waveform?: Uint8Array;
  readonly notes: readonly string[];
}

export interface ArtifactPublication {
  readonly cid: string;
  readonly digest: string;
  readonly bytes: number;
  readonly mediaType: string;
  readonly receipts: readonly StorageReceipt[];
  readonly failures: readonly { readonly provider: string; readonly message: string }[];
  readonly replication: 'satisfied' | 'degraded';
}

export interface PublicationResult {
  readonly uploadId: string;
  readonly unsigned: true;
  readonly clientMustSign: true;
  readonly source: {
    readonly sha256: string;
    readonly bytes: number;
    readonly declaredMediaType: string;
    readonly detectedMediaType: string;
  };
  readonly scan: ScannerResult;
  readonly manifestContent: MediaManifestContent;
  readonly publications: readonly ArtifactPublication[];
}

export interface WorkerReadiness {
  readonly ok: boolean;
  readonly scanner: { readonly name: string; readonly available: boolean };
  readonly storage: readonly StorageHealth[];
  readonly processors: {
    readonly workingRoot: boolean;
    readonly sharp: boolean;
    readonly ffmpeg: boolean;
    readonly ffprobe: boolean;
  };
}
