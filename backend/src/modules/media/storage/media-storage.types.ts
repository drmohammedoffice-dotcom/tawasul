export type MediaStorageDriver = 'local' | 's3' | 'r2';

export type CreateUploadTicketInput = {
  mediaId: string;
  mimeType: string;
  fileName: string;
  uploaderId: string;
  purpose?: string;
};

export type UploadTicketResult = {
  storageKey: string;
  bucket?: string;
  uploadUrl: string;
  method: 'PUT' | 'POST';
  headers?: Record<string, string>;
  provider: MediaStorageDriver;
};

/** @deprecated alias kept for existing MediaService imports */
export type UploadTicket = UploadTicketResult;

export type ObjectMetadata = {
  exists: boolean;
  sizeBytes?: number;
  contentType?: string;
  etag?: string;
};

export interface MediaStorageProvider {
  readonly driver: MediaStorageDriver;
  createUploadTicket(input: CreateUploadTicketInput): Promise<UploadTicketResult>;
  createReadUrl(mediaId: string, storageKey: string): Promise<string>;
  getObjectMetadata(storageKey: string): Promise<ObjectMetadata>;
  deleteObject(storageKey: string): Promise<void>;
  /** Local-only helpers; remote providers may throw if misused. */
  getValidatedLocalUploadStorageKey?(mediaId: string, token: string): Promise<string | null>;
  getValidatedLocalReadStorageKey?(mediaId: string, token: string): Promise<string | null>;
  persistLocalFile?(storageKey: string, buffer: Buffer): Promise<void>;
  readLocalFile?(storageKey: string): Promise<Buffer>;
  /** Remote providers: download object bytes (e.g. R2/S3 GetObject). */
  readObjectBuffer?(storageKey: string): Promise<Buffer>;
  resolveLocalAbsolutePath?(storageKey: string): string;
}

export const MEDIA_STORAGE_PROVIDER = Symbol('MEDIA_STORAGE_PROVIDER');

export const ALLOWED_MIME_BY_TYPE: Record<string, string[]> = {
  image: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  video: ['video/mp4', 'video/webm', 'video/quicktime'],
  audio: ['audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/webm'],
  file: ['application/pdf', 'text/plain', 'application/zip']
};

export function assertAllowedMime(mediaType: string, mimeType: string): void {
  const allowed = ALLOWED_MIME_BY_TYPE[mediaType];
  if (!allowed || !allowed.includes(mimeType.toLowerCase())) {
    throw new Error(`Unsupported mime type ${mimeType} for mediaType ${mediaType}`);
  }
}

export function buildObjectKey(input: {
  uploaderId: string;
  mediaId: string;
  fileName: string;
  purpose?: string;
}): string {
  const safeName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180);
  const purpose = (input.purpose ?? 'general').replace(/[^a-zA-Z0-9_-]/g, '');
  // Server-owned key: client cannot choose arbitrary paths.
  return `u/${input.uploaderId}/${purpose}/${input.mediaId}/${safeName}`;
}
