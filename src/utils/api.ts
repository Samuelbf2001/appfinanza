import { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { logger } from './logger';

/**
 * Rate-limited request helper.
 * Respects per-API rate limits and retries on 429 with exponential backoff.
 */
export async function rateLimitedRequest<T>(
  client: AxiosInstance,
  config: AxiosRequestConfig,
  options: { maxRetries?: number; baseDelayMs?: number } = {},
): Promise<AxiosResponse<T>> {
  const { maxRetries = 3, baseDelayMs = 1000 } = options;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await client.request<T>(config);
    } catch (error: unknown) {
      const axiosError = error as { response?: { status: number; headers?: Record<string, string> }; message?: string };
      const status = axiosError.response?.status;

      if (status === 429 && attempt < maxRetries) {
        const retryAfter = parseInt(axiosError.response?.headers?.['retry-after'] || '0', 10);
        const delay = retryAfter > 0 ? retryAfter * 1000 : baseDelayMs * Math.pow(2, attempt);
        logger.warn(`Rate limited (429). Retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
        await sleep(delay);
        continue;
      }

      if (status && status >= 500 && attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        logger.warn(`Server error (${status}). Retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
        await sleep(delay);
        continue;
      }

      throw error;
    }
  }

  throw new Error('Max retries exceeded');
}

/**
 * Paginated fetch: collects all pages from a paginated API endpoint.
 * Works with both offset-based and cursor-based pagination.
 */
export async function fetchAllPages<T>(
  client: AxiosInstance,
  config: AxiosRequestConfig,
  options: {
    /** Function to extract the items array from a response */
    extractItems: (data: unknown) => T[];
    /** Function to get the next page config, or null when done */
    getNextPageConfig: (data: unknown, currentConfig: AxiosRequestConfig) => AxiosRequestConfig | null;
    /** Max pages to fetch (safety limit) */
    maxPages?: number;
  },
): Promise<T[]> {
  const { extractItems, getNextPageConfig, maxPages = 20 } = options;
  const allItems: T[] = [];
  let currentConfig = { ...config };
  let page = 0;

  while (page < maxPages) {
    const response = await rateLimitedRequest(client, currentConfig);
    const items = extractItems(response.data);
    allItems.push(...items);

    const nextConfig = getNextPageConfig(response.data, currentConfig);
    if (!nextConfig || items.length === 0) break;

    currentConfig = nextConfig;
    page++;
  }

  return allItems;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Aggregate helper: groups items by a key and counts/sums them.
 */
export function aggregateBy<T>(
  items: T[],
  keyFn: (item: T) => string,
  valueFn?: (item: T) => number,
): Record<string, { count: number; total: number }> {
  const result: Record<string, { count: number; total: number }> = {};
  for (const item of items) {
    const key = keyFn(item);
    if (!result[key]) result[key] = { count: 0, total: 0 };
    result[key].count++;
    result[key].total += valueFn ? valueFn(item) : 0;
  }
  return result;
}
