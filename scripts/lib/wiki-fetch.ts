import axios from 'axios';
import * as https from 'node:https';

export const EN_API_URL = 'https://genshin-impact.fandom.com/api.php';
export const FR_API_URL = 'https://genshin-impact.fandom.com/fr/api.php';

export const RETRY_BASE_DELAY_MS = 800;
export const CATEGORY_PAGE_DELAY_MS = 300;
export const RETRY_ATTEMPTS = 3;

export const HTTP_HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; ReGeniTracker/1.0)' };
export const httpsAgent = new https.Agent();

const wikiClient = axios.create({ headers: HTTP_HEADERS, httpsAgent });

interface MediaWikiPage {
  missing?: boolean;
  revisions?: { slots?: { main?: { content?: string } } }[];
  langlinks?: { title: string }[];
}

interface MediaWikiQueryResponse {
  query?: {
    pages?: MediaWikiPage[];
    categorymembers?: { ns: number; title: string }[];
  };
  continue?: Record<string, string>;
}

interface MediaWikiParseResponse {
  parse?: { text?: string };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = RETRY_ATTEMPTS): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        console.warn(`⚠️  ${label} failed (attempt ${i + 1}/${attempts}), retrying...`);
        await sleep(RETRY_BASE_DELAY_MS * (i + 1));
      }
    }
  }
  throw lastErr;
}

export async function fetchOrWarn<T>(label: string, fallback: T, fn: () => Promise<T>): Promise<T> {
  try {
    return await withRetry(label, fn);
  } catch (err) {
    console.warn(`⚠️  ${label} failed after several attempts: ${err}`);
    return fallback;
  }
}

export async function fetchCategoryMembers(
  category: string,
  authorizedNs: number[] = [0],
  apiUrl: string = EN_API_URL,
): Promise<string[]> {
  const titles: string[] = [];
  let continueParams: Record<string, string> | undefined;
  do {
    const response = await withRetry(`fetch category "${category}"`, () =>
      wikiClient.get<MediaWikiQueryResponse>(apiUrl, {
        params: {
          action: 'query',
          list: 'categorymembers',
          cmtitle: `Category:${category}`,
          cmlimit: '500',
          format: 'json',
          formatversion: '2',
          ...continueParams,
        },
      }),
    );
    for (const member of response.data?.query?.categorymembers ?? []) {
      if (authorizedNs.includes(member.ns)) titles.push(member.title);
    }
    continueParams = response.data?.continue;
    await sleep(CATEGORY_PAGE_DELAY_MS);
  } while (continueParams);
  return titles;
}

export async function fetchPageRevision(
  apiUrl: string,
  pageTitle: string,
  extraParams: Record<string, string> = {},
): Promise<MediaWikiPage | null> {
  const response = await wikiClient.get<MediaWikiQueryResponse>(apiUrl, {
    params: {
      action: 'query',
      titles: pageTitle,
      prop: 'revisions',
      rvprop: 'content',
      rvslots: 'main',
      format: 'json',
      formatversion: '2',
      ...extraParams,
    },
  });
  const page = response.data?.query?.pages?.[0];
  return page && !page.missing ? page : null;
}

export function fetchWikitext(pageTitle: string, apiUrl: string = EN_API_URL): Promise<string | null> {
  return fetchOrWarn(`fetch wikitext "${pageTitle}"`, null, async () => {
    const page = await fetchPageRevision(apiUrl, pageTitle);
    return page?.revisions?.[0]?.slots?.main?.content ?? null;
  });
}

export function fetchWikitextWithLanglink(
  pageTitle: string,
): Promise<{ content: string | null; frTitle: string | null }> {
  return fetchOrWarn(`fetch wikitext+langlink EN "${pageTitle}"`, { content: null, frTitle: null }, async () => {
    const page = await fetchPageRevision(EN_API_URL, pageTitle, { prop: 'revisions|langlinks', lllang: 'fr' });
    return {
      content: page?.revisions?.[0]?.slots?.main?.content ?? null,
      frTitle: page?.langlinks?.[0]?.title ?? null,
    };
  });
}

export function fetchHtml(pageTitle: string, apiUrl: string = EN_API_URL): Promise<string> {
  return fetchOrWarn(`fetch HTML "${pageTitle}"`, '', async () => {
    const response = await wikiClient.get<MediaWikiParseResponse>(apiUrl, {
      params: {
        action: 'parse',
        page: pageTitle,
        prop: 'text',
        format: 'json',
        formatversion: '2',
      },
    });
    return response.data?.parse?.text ?? '';
  });
}
