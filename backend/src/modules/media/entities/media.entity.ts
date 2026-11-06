export class MediaEntity {
  id!: string;
  uploaderId!: string;
  storageProvider!: string;
  originalFileName!: string;
  mimeType!: string;
  sizeBytes!: number;
  encryptedFileKey!: string;
  uploadCompletedAt!: Date | null;
  createdAt!: Date;
  processingStatus?: string;
  mediaType?: string;
  purpose?: string;
  visibility?: string;
  contentHash?: string | null;
}
