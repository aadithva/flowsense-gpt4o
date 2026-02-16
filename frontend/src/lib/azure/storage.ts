import {
  BlobServiceClient,
  BlobSASPermissions,
  SASProtocol,
  generateBlobSASQueryParameters,
  UserDelegationKey,
} from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';
import { getServerEnv } from '@/lib/env/server';

const credential = new DefaultAzureCredential();

let delegationKeyCache: {
  key: UserDelegationKey;
  startsOn: Date;
  expiresOn: Date;
} | null = null;

function getBlobServiceClient() {
  const env = getServerEnv();
  const accountUrl = `https://${env.AZURE_STORAGE_ACCOUNT_NAME}.blob.core.windows.net`;
  return new BlobServiceClient(accountUrl, credential);
}

function getContainerClient() {
  const env = getServerEnv();
  return getBlobServiceClient().getContainerClient(env.AZURE_STORAGE_CONTAINER);
}

async function getUserDelegationKey(minExpiryMinutes: number) {
  const now = Date.now();
  if (
    delegationKeyCache &&
    delegationKeyCache.expiresOn.getTime() - now > minExpiryMinutes * 60 * 1000
  ) {
    return delegationKeyCache;
  }

  const startsOn = new Date(now - 5 * 60 * 1000);
  const expiresOn = new Date(now + Math.max(minExpiryMinutes, 60) * 60 * 1000);
  const key = await getBlobServiceClient().getUserDelegationKey(startsOn, expiresOn);
  delegationKeyCache = { key, startsOn, expiresOn };
  return delegationKeyCache;
}

export async function generateUploadSasUrl(blobPath: string, expiryMinutes = 30): Promise<string> {
  const env = getServerEnv();
  const container = getContainerClient();
  const blobClient = container.getBlockBlobClient(blobPath);
  const delegationKey = await getUserDelegationKey(expiryMinutes);

  const expiresOn = new Date(Date.now() + expiryMinutes * 60 * 1000);

  const sasToken = generateBlobSASQueryParameters(
    {
      containerName: env.AZURE_STORAGE_CONTAINER,
      blobName: blobPath,
      permissions: BlobSASPermissions.parse('cw'),
      startsOn: delegationKey.startsOn,
      expiresOn,
      protocol: SASProtocol.Https,
    },
    delegationKey.key,
    env.AZURE_STORAGE_ACCOUNT_NAME
  ).toString();

  return `${blobClient.url}?${sasToken}`;
}

export async function generateDownloadSasUrl(blobPath: string, expiryMinutes = 15): Promise<string> {
  const env = getServerEnv();
  const container = getContainerClient();
  const blobClient = container.getBlobClient(blobPath);
  const delegationKey = await getUserDelegationKey(expiryMinutes);

  const expiresOn = new Date(Date.now() + expiryMinutes * 60 * 1000);

  const sasToken = generateBlobSASQueryParameters(
    {
      containerName: env.AZURE_STORAGE_CONTAINER,
      blobName: blobPath,
      permissions: BlobSASPermissions.parse('r'),
      startsOn: delegationKey.startsOn,
      expiresOn,
      protocol: SASProtocol.Https,
    },
    delegationKey.key,
    env.AZURE_STORAGE_ACCOUNT_NAME
  ).toString();

  return `${blobClient.url}?${sasToken}`;
}

export async function listBlobs(folderPath: string): Promise<Array<{ name: string; size: number }>> {
  const container = getContainerClient();
  const blobs: Array<{ name: string; size: number }> = [];

  for await (const blob of container.listBlobsFlat({ prefix: folderPath })) {
    blobs.push({
      name: blob.name,
      size: blob.properties.contentLength || 0,
    });
  }

  return blobs;
}

export async function getBlobInfo(blobPath: string): Promise<{
  exists: boolean;
  size: number;
  contentType?: string;
}> {
  try {
    const container = getContainerClient();
    const blobClient = container.getBlobClient(blobPath);
    const properties = await blobClient.getProperties();
    return {
      exists: true,
      size: properties.contentLength || 0,
      contentType: properties.contentType,
    };
  } catch {
    return { exists: false, size: 0 };
  }
}

export async function deleteBlob(blobPath: string): Promise<void> {
  const container = getContainerClient();
  const blobClient = container.getBlobClient(blobPath);
  await blobClient.deleteIfExists();
}

export async function deleteBlobsInFolder(folderPath: string): Promise<void> {
  const blobs = await listBlobs(folderPath);
  for (const blob of blobs) {
    await deleteBlob(blob.name);
  }
}
