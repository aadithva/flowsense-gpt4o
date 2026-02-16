import { BlobServiceClient, ContainerClient } from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';
import { getEnv } from './env';

let blobServiceClient: BlobServiceClient | null = null;
let containerClient: ContainerClient | null = null;
const credential = new DefaultAzureCredential();

function getBlobServiceClient(): BlobServiceClient {
  if (!blobServiceClient) {
    const env = getEnv();
    const accountUrl = `https://${env.AZURE_STORAGE_ACCOUNT_NAME}.blob.core.windows.net`;
    blobServiceClient = new BlobServiceClient(accountUrl, credential);
    console.log('[Azure Storage] Connected to Blob service with managed identity');
  }
  return blobServiceClient;
}

function getContainerClient(): ContainerClient {
  if (!containerClient) {
    const env = getEnv();
    containerClient = getBlobServiceClient().getContainerClient(env.AZURE_STORAGE_CONTAINER);
  }
  return containerClient;
}

export async function downloadBlob(blobPath: string): Promise<Buffer> {
  const container = getContainerClient();
  const blobClient = container.getBlobClient(blobPath);

  console.log(`[Azure Storage] Downloading: ${blobPath}`);
  const downloadResponse = await blobClient.download();

  const chunks: Buffer[] = [];
  for await (const chunk of downloadResponse.readableStreamBody!) {
    chunks.push(Buffer.from(chunk));
  }

  const buffer = Buffer.concat(chunks);
  console.log(`[Azure Storage] Downloaded ${buffer.length} bytes`);
  return buffer;
}

export async function uploadBlob(
  blobPath: string,
  data: Buffer,
  contentType: string
): Promise<void> {
  const container = getContainerClient();
  const blockBlobClient = container.getBlockBlobClient(blobPath);

  console.log(`[Azure Storage] Uploading: ${blobPath} (${data.length} bytes)`);
  await blockBlobClient.uploadData(data, {
    blobHTTPHeaders: { blobContentType: contentType },
  });
  console.log(`[Azure Storage] Upload complete: ${blobPath}`);
}

export async function deleteBlob(blobPath: string): Promise<void> {
  const container = getContainerClient();
  const blobClient = container.getBlobClient(blobPath);

  console.log(`[Azure Storage] Deleting: ${blobPath}`);
  await blobClient.deleteIfExists();
}

export async function listBlobsInFolder(folderPath: string): Promise<string[]> {
  const container = getContainerClient();
  const blobs: string[] = [];

  for await (const blob of container.listBlobsFlat({ prefix: folderPath })) {
    blobs.push(blob.name);
  }

  return blobs;
}

export async function deleteBlobFolder(folderPath: string): Promise<void> {
  const blobs = await listBlobsInFolder(folderPath);

  console.log(`[Azure Storage] Deleting folder: ${folderPath} (${blobs.length} blobs)`);
  for (const blobName of blobs) {
    await deleteBlob(blobName);
  }
}

export async function blobExists(blobPath: string): Promise<boolean> {
  const container = getContainerClient();
  const blobClient = container.getBlobClient(blobPath);
  return blobClient.exists();
}

export async function getBlobProperties(blobPath: string) {
  const container = getContainerClient();
  const blobClient = container.getBlobClient(blobPath);
  const properties = await blobClient.getProperties();

  return {
    contentLength: properties.contentLength,
    contentType: properties.contentType,
    createdOn: properties.createdOn,
    lastModified: properties.lastModified,
  };
}
