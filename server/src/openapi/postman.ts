import { convert } from 'openapi-to-postmanv2';
import { generateDocument } from './document.js';

// Converts the OpenAPI document into a Postman v2.1 collection (same approach as
// AutoApply). The sign-in and create-user responses stash their tokens into the
// {{bearerToken}} variable every secured request already reads, so authenticating
// once authenticates the whole collection.

const SIGN_IN_PATH = ['v1', 'users', 'sign_in'];
const CREATE_USER_PATH = ['v1', 'users'];

const SAVE_TOKEN_SCRIPT = [
  'const auth = pm.response.json() && pm.response.json().auth;',
  "if (auth && auth.access_token) pm.collectionVariables.set('bearerToken', auth.access_token);",
  "if (auth && auth.refresh_token) pm.collectionVariables.set('refreshToken', auth.refresh_token);",
];

type PostmanItem = {
  name?: string;
  item?: PostmanItem[];
  request?: { method?: string; url?: { path?: string[] } };
  event?: unknown[];
};

type PostmanCollection = {
  item: PostmanItem[];
  variable?: Array<{ key: string; value: string; type?: string }>;
};

/** Depth-first search for the first request item matching `predicate`. */
function findRequest(
  items: PostmanItem[] | undefined,
  predicate: (item: PostmanItem) => boolean,
): PostmanItem | undefined {
  for (const item of items ?? []) {
    if (predicate(item)) return item;
    const nested = findRequest(item.item, predicate);
    if (nested) return nested;
  }
  return undefined;
}

/** True when the item is a request to `method path` (exact path-segment match). */
function isRequest(item: PostmanItem, method: string, path: string[]): boolean {
  const itemPath = item.request?.url?.path;
  return (
    item.request?.method === method &&
    Array.isArray(itemPath) &&
    itemPath.length === path.length &&
    itemPath.every((segment, i) => segment === path[i])
  );
}

/** Add a collection variable if it isn't already present. */
function ensureVariable(collection: PostmanCollection, key: string): void {
  collection.variable ??= [];
  if (!collection.variable.some((variable) => variable.key === key)) {
    collection.variable.push({ key, value: '', type: 'string' });
  }
}

/** Attach the token-capture test script to a request, if it was found. */
function wireTokenCapture(request: PostmanItem | undefined): void {
  if (!request) return;
  request.event = [{ listen: 'test', script: { type: 'text/javascript', exec: SAVE_TOKEN_SCRIPT } }];
}

/**
 * Convert the OpenAPI document into a Postman v2.1 collection: requests grouped
 * into folders by tag, the `bearerAuth` scheme mapped to collection-level bearer
 * auth, and the sign-in/create-user requests wired to populate `{{bearerToken}}`
 * and `{{refreshToken}}`.
 * @returns the Postman collection object.
 * @throws if openapi-to-postmanv2 reports a conversion failure.
 */
export function generatePostmanCollection(): Promise<PostmanCollection> {
  const document = generateDocument();

  return new Promise((resolve, reject) => {
    convert(
      { type: 'json', data: document },
      { folderStrategy: 'Tags', requestParametersResolution: 'Example' },
      (error, result) => {
        if (error) {
          reject(new Error(error.message));
          return;
        }
        if (!result?.result || !result.output?.length) {
          reject(new Error(`Postman conversion failed: ${result?.reason ?? 'no output produced'}`));
          return;
        }
        const collection = result.output[0].data as PostmanCollection;
        wireTokenCapture(findRequest(collection.item, (item) => isRequest(item, 'POST', SIGN_IN_PATH)));
        wireTokenCapture(findRequest(collection.item, (item) => isRequest(item, 'POST', CREATE_USER_PATH)));
        ensureVariable(collection, 'bearerToken');
        ensureVariable(collection, 'refreshToken');
        resolve(collection);
      },
    );
  });
}
