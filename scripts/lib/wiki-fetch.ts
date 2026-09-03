// scripts/lib/wiki-fetch.ts
//
// Couche fetch partagée par tous les scrape-*.ts qui lisent le wiki
// (genshin-impact.fandom.com). Auparavant dupliquée quasi à l'identique dans
// chaque script (EN_API_URL/FR_API_URL, HTTP_HEADERS, httpsAgent, sleep,
// withRetry, fetchCategoryMembers, fetchWikitext(WithLanglink), fetchFrWikitext,
// fetchHtml) — centralisée ici pour éviter la dérive entre scripts (ex:
// scrape-weapons.ts n'avait aucun retry avant ce refactor).
//
// Chaque fonction de fetch (fetchWikitext, fetchWikitextWithLanglink,
// fetchFrWikitext, fetchHtml) applique déjà withRetry en interne et avale les
// erreurs (retourne null/chaîne vide après épuisement des tentatives) : les
// scripts appelants n'ont pas besoin de re-wrapper ces appels dans withRetry.

import axios from 'axios';
import * as https from 'node:https';

export const EN_API_URL = 'https://genshin-impact.fandom.com/api.php';
export const FR_API_URL = 'https://genshin-impact.fandom.com/fr/api.php';

export const HTTP_HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; ReGeniTracker/1.0)' };
export const httpsAgent = new https.Agent({ rejectUnauthorized: false });

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        console.warn(`⚠️  ${label} a échoué (tentative ${i + 1}/${attempts}), nouvel essai...`);
        await sleep(800 * (i + 1));
      }
    }
  }
  throw lastErr;
}

export async function fetchCategoryMembers(category: string, apiUrl: string = EN_API_URL): Promise<string[]> {
  const titles: string[] = [];
  let continueParams: Record<string, string> | undefined;
  do {
    const response = await withRetry(`fetch category "${category}"`, () =>
      axios.get(apiUrl, {
        params: {
          action: 'query',
          list: 'categorymembers',
          cmtitle: `Category:${category}`,
          cmlimit: '500',
          format: 'json',
          formatversion: '2',
          ...continueParams,
        },
        headers: HTTP_HEADERS,
        httpsAgent,
      }),
    );
    for (const member of response.data?.query?.categorymembers ?? []) {
      if (member.ns === 0) titles.push(member.title);
    }
    continueParams = response.data?.continue;
    await sleep(300);
  } while (continueParams);
  return titles;
}

export async function fetchWikitext(pageTitle: string, apiUrl: string = EN_API_URL): Promise<string | null> {
  try {
    return await withRetry(`fetch wikitext "${pageTitle}"`, async () => {
      const response = await axios.get(apiUrl, {
        params: {
          action: 'query',
          titles: pageTitle,
          prop: 'revisions',
          rvprop: 'content',
          rvslots: 'main',
          format: 'json',
          formatversion: '2',
        },
        headers: HTTP_HEADERS,
        httpsAgent,
      });
      const page = response.data?.query?.pages?.[0];
      if (!page || page.missing) return null;
      return page.revisions?.[0]?.slots?.main?.content ?? null;
    });
  } catch (err) {
    console.warn(`⚠️  Échec du fetch wikitext pour "${pageTitle}" après plusieurs tentatives: ${err}`);
    return null;
  }
}

export async function fetchWikitextWithLanglink(
  pageTitle: string,
): Promise<{ content: string | null; frTitle: string | null }> {
  try {
    return await withRetry(`fetch wikitext+langlink EN "${pageTitle}"`, async () => {
      const response = await axios.get(EN_API_URL, {
        params: {
          action: 'query',
          titles: pageTitle,
          prop: 'revisions|langlinks',
          rvprop: 'content',
          rvslots: 'main',
          lllang: 'fr',
          format: 'json',
          formatversion: '2',
        },
        headers: HTTP_HEADERS,
        httpsAgent,
      });
      const page = response.data?.query?.pages?.[0];
      if (!page || page.missing) return { content: null, frTitle: null };
      return {
        content: page.revisions?.[0]?.slots?.main?.content ?? null,
        frTitle: page.langlinks?.[0]?.title ?? null,
      };
    });
  } catch (err) {
    console.warn(`⚠️  Échec du fetch wikitext+langlink EN pour "${pageTitle}" après plusieurs tentatives: ${err}`);
    return { content: null, frTitle: null };
  }
}

export async function fetchFrWikitext(frTitle: string): Promise<string | null> {
  try {
    return await withRetry(`fetch wikitext FR "${frTitle}"`, async () => {
      const response = await axios.get(FR_API_URL, {
        params: {
          action: 'query',
          titles: frTitle,
          prop: 'revisions',
          rvprop: 'content',
          rvslots: 'main',
          format: 'json',
          formatversion: '2',
        },
        headers: HTTP_HEADERS,
        httpsAgent,
      });
      const page = response.data?.query?.pages?.[0];
      if (!page || page.missing) return null;
      return page.revisions?.[0]?.slots?.main?.content ?? null;
    });
  } catch (err) {
    console.warn(`⚠️  Échec du fetch wikitext FR pour "${frTitle}" après plusieurs tentatives: ${err}`);
    return null;
  }
}

export async function fetchHtml(pageTitle: string, apiUrl: string = EN_API_URL): Promise<string> {
  try {
    return await withRetry(`fetch HTML "${pageTitle}"`, async () => {
      const response = await axios.get(apiUrl, {
        params: {
          action: 'parse',
          page: pageTitle,
          prop: 'text',
          format: 'json',
          formatversion: '2',
        },
        headers: HTTP_HEADERS,
        httpsAgent,
      });
      return response.data?.parse?.text ?? '';
    });
  } catch (err) {
    console.warn(`⚠️  Échec du fetch HTML pour "${pageTitle}" après plusieurs tentatives: ${err}`);
    return '';
  }
}
