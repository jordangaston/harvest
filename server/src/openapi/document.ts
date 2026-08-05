import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import {
  requestOtpSchema,
  verifyOtpSchema,
  createUserSchema,
  signInSchema,
  createImportSchema,
} from '../api/schemas.js';
import { ImportJobSchema } from '../models/import-job.js';

// Builds the OpenAPI 3.1 document for the HTTP API. Request bodies reuse the Zod
// schemas the routes already validate against (../api/schemas); responses are
// modelled here. Zod v4's native z.toJSONSchema does the conversion — the older
// @asteasolutions/zod-to-openapi only supports zod v3.

const DEFAULT_PORT = 3000;

// ---- Response bodies (the public shapes each handler returns) ----

const publicUser = z.object({ id: z.string().uuid(), phone: z.string() });

const session = z.object({
  user: publicUser,
  auth: z.object({ access_token: z.string(), refresh_token: z.string() }),
  isNew: z.boolean(),
});

// Mirrors toPublicJob: snake_case, null error/recipe fields omitted. Status and
// source_type reuse the domain enums so the doc can't drift from the model.
const publicJob = z.object({
  id: z.string().uuid(),
  status: ImportJobSchema.shape.status,
  progress: z.number().int(),
  source_type: ImportJobSchema.shape.sourceType,
  error_code: z.string().optional(),
  recipe_id: z.string().uuid().optional(),
});

const errorEnvelope = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

type ErrorStatus = 400 | 401 | 404 | 422 | 502;

const ERROR_DESCRIPTIONS: Record<ErrorStatus, string> = {
  400: 'Validation error',
  401: 'Missing or invalid authentication',
  404: 'Resource not found',
  422: 'Unsupported import source',
  502: 'Upstream provider error',
};

interface RouteSpec {
  method: 'get' | 'post';
  /** OpenAPI-style path; path params use `{name}` (e.g. `/v1/imports/{id}`). */
  path: string;
  tag: string;
  summary: string;
  secured: boolean;
  body?: z.ZodType;
  pathParams?: { name: string; description: string }[];
  successStatus?: number;
  successSchema: z.ZodType;
  successDescription: string;
  errors?: ErrorStatus[];
}

const ROUTES: RouteSpec[] = [
  {
    method: 'get', path: '/healthz', tag: 'health', secured: false,
    summary: 'Liveness probe (200 when the DB is reachable, 503 otherwise)',
    successSchema: z.object({ status: z.enum(['ok', 'error']), db: z.string() }),
    successDescription: 'Service status',
  },
  {
    method: 'post', path: '/v1/otps', tag: 'otps', secured: false,
    summary: 'Request an OTP for a phone number',
    body: requestOtpSchema,
    successSchema: z.object({ otp: z.object({ status: z.literal('pending') }) }),
    successDescription: 'OTP request accepted',
    errors: [400, 502],
  },
  {
    method: 'post', path: '/v1/otps/verify', tag: 'otps', secured: false,
    summary: 'Verify an OTP code',
    body: verifyOtpSchema,
    successSchema: z.object({ otp: z.object({ status: z.literal('approved') }) }),
    successDescription: 'OTP approved',
    errors: [400],
  },
  {
    method: 'post', path: '/v1/users', tag: 'users', secured: false,
    summary: 'Create a user and open a session',
    body: createUserSchema,
    successSchema: session,
    successDescription: 'The created user and session tokens',
    errors: [400],
  },
  {
    method: 'post', path: '/v1/users/sign_in', tag: 'users', secured: false,
    summary: 'Sign in with an OTP or a refresh token',
    body: signInSchema,
    successSchema: session,
    successDescription: 'The signed-in user and session tokens',
    errors: [400, 401],
  },
  {
    method: 'get', path: '/v1/users/me', tag: 'users', secured: true,
    summary: 'Get the current user',
    successSchema: z.object({ user: publicUser }),
    successDescription: 'The authenticated user',
    errors: [401],
  },
  {
    method: 'post', path: '/v1/imports', tag: 'imports', secured: true,
    summary: 'Start an import job',
    body: createImportSchema,
    successStatus: 202,
    successSchema: z.object({ job: publicJob }),
    successDescription: 'The queued import job',
    errors: [400, 401, 422],
  },
  {
    method: 'get', path: '/v1/imports/{id}', tag: 'imports', secured: true,
    summary: 'Get an import job',
    pathParams: [{ name: 'id', description: 'The import job id' }],
    successSchema: z.object({ job: publicJob }),
    successDescription: 'The import job',
    errors: [401, 404],
  },
];

/** Read PORT straight from the environment; importing config/env.ts would validate the whole env and exit on missing keys. */
function localServerUrl(): string {
  return `http://localhost:${process.env.PORT ?? DEFAULT_PORT}`;
}

/**
 * Convert a Zod schema to an inline OpenAPI 3.1 schema object (JSON Schema
 * 2020-12), stripping the `$schema` marker OpenAPI does not want.
 * @param schema - the Zod schema to convert.
 * @returns a plain JSON Schema object.
 */
function js(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

/** Wrap a schema as an `application/json` content map. */
function jsonContent(schema: z.ZodType) {
  return { 'application/json': { schema: js(schema) } };
}

/**
 * Build one OpenAPI operation from a route spec: success response, standard
 * error envelopes, bearer security for secured routes, path params, and body.
 * @param route - the route to render.
 * @returns the OpenAPI operation object.
 */
function buildOperation(route: RouteSpec): Record<string, unknown> {
  const responses: Record<string, unknown> = {
    [route.successStatus ?? 200]: {
      description: route.successDescription,
      content: jsonContent(route.successSchema),
    },
  };
  for (const status of route.errors ?? []) {
    responses[status] = { description: ERROR_DESCRIPTIONS[status], content: jsonContent(errorEnvelope) };
  }

  return {
    tags: [route.tag],
    summary: route.summary,
    ...(route.secured ? { security: [{ bearerAuth: [] }] } : {}),
    ...(route.pathParams
      ? {
          parameters: route.pathParams.map((param) => ({
            name: param.name,
            in: 'path',
            required: true,
            description: param.description,
            schema: { type: 'string' },
          })),
        }
      : {}),
    ...(route.body ? { requestBody: { required: true, content: jsonContent(route.body) } } : {}),
    responses,
  };
}

/** Read the API title and version from package.json. */
function readPackageInfo(): { title: string; version: string } {
  const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name?: string; version?: string };
  return { title: pkg.name ?? 'harvest-server', version: pkg.version ?? '0.0.0' };
}

/**
 * Assemble the full OpenAPI 3.1 document: info, a local server, the bearer
 * security scheme, and one operation per route grouped by path.
 * @returns the OpenAPI document object.
 */
export function generateDocument(): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of ROUTES) {
    (paths[route.path] ??= {})[route.method] = buildOperation(route);
  }

  const { title, version } = readPackageInfo();
  return {
    openapi: '3.1.0',
    info: { title, version, description: 'Harvest server HTTP API' },
    servers: [{ url: localServerUrl() }],
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
    },
    paths,
  };
}
