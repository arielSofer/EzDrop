// Ported 1:1 from AgenticDesigner/Models/APIEndpointConfig.swift
//
// Reusable API endpoint definitions that API blocks can reference.

import { newUUID } from './uuid';

export interface APIEndpointConfig {
  id: string;
  name: string;
  baseURL: string;
  path: string;
  method: HTTPMethod;
  headers: HTTPHeaderField[];
  bodyTemplate?: string;
  queryParameters: HTTPQueryParam[];
  responseMapping: ResponseFieldMapping[];
  authentication: APIAuthentication;
}

export function apiEndpointFullURL(config: APIEndpointConfig): string {
  return config.baseURL + config.path;
}

export function makeAPIEndpointConfig(init: Partial<APIEndpointConfig> = {}): APIEndpointConfig {
  const c: APIEndpointConfig = {
    id: init.id ?? newUUID(),
    name: init.name ?? '',
    baseURL: init.baseURL ?? '',
    path: init.path ?? '',
    method: init.method ?? 'GET',
    headers: init.headers ?? [],
    queryParameters: init.queryParameters ?? [],
    responseMapping: init.responseMapping ?? [],
    authentication: init.authentication ?? 'none',
  };
  if (init.bodyTemplate !== undefined) c.bodyTemplate = init.bodyTemplate;
  return c;
}

export const AllHTTPMethod = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type HTTPMethod = (typeof AllHTTPMethod)[number];
/** Swift case names → raw values (`.get` = "GET"). */
export const HTTPMethod = {
  get: 'GET',
  post: 'POST',
  put: 'PUT',
  patch: 'PATCH',
  delete: 'DELETE',
} as const;

export interface HTTPHeaderField {
  id: string;
  key: string;
  value: string;
}

export function makeHTTPHeaderField(init: Partial<HTTPHeaderField> = {}): HTTPHeaderField {
  return { id: init.id ?? newUUID(), key: init.key ?? '', value: init.value ?? '' };
}

export interface HTTPQueryParam {
  id: string;
  key: string;
  value: string;
}

export function makeHTTPQueryParam(init: Partial<HTTPQueryParam> = {}): HTTPQueryParam {
  return { id: init.id ?? newUUID(), key: init.key ?? '', value: init.value ?? '' };
}

export interface ResponseFieldMapping {
  id: string;
  jsonPath: string;
  variableName: string;
}

export function makeResponseFieldMapping(init: Partial<ResponseFieldMapping> = {}): ResponseFieldMapping {
  return {
    id: init.id ?? newUUID(),
    jsonPath: init.jsonPath ?? '',
    variableName: init.variableName ?? '',
  };
}

export const AllAPIAuthentication = ['none', 'bearerToken', 'apiKey', 'basicAuth', 'firebaseToken'] as const;
export type APIAuthentication = (typeof AllAPIAuthentication)[number];
