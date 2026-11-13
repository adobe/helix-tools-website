// @ts-check
/**
 * Shared client contracts. Resource capabilities stay identical for H5 and H6.
 *
 * @typedef {object} SiteCoordinates
 * @property {string} org
 * @property {string} site
 * @property {string|null} [ref] Defaults to main; null omits the H5 ref segment.
 *
 * @typedef {Readonly<{org: string, site: string, ref: string|null}>} BoundCoordinates
 *
 * @typedef {{org: string, site?: never, profile?: never}
 *   | {org: string, site: string, profile?: never}
 *   | {org: string, site?: never, profile: string}} ConfigCoordinates
 *
 * @typedef {{org: string|null, site: string|null}} ParsedCoordinates
 * @typedef {{url: string, label: string}} AdminSuggestion
 * @typedef {Record<string, string|number|boolean>} AdminParams
 * @typedef {{params?: AdminParams}} AdminRequestOptions
 * @typedef {AdminRequestOptions & {contentType?: string}} AdminOperationOptions
 * @typedef {RequestInit & AdminRequestOptions} AdminRequestDefaults
 */

/**
 * HTTP and network failures use this envelope. Body readers remain single-use;
 * callers must narrow or validate parsed JSON before consuming it.
 *
 * @typedef {object} AdminResponse
 * @property {boolean} ok
 * @property {number} status
 * @property {() => Promise<string>} text
 * @property {() => Promise<unknown>} json
 * @property {string} error
 * @property {{method: string, url: string}} request
 */

/**
 * @typedef {object} AdminConfigResource
 * @property {string} url
 * @property {(subpath: string) => AdminConfigResource} select
 * @property {(opts?: AdminRequestOptions) => Promise<AdminResponse>} read
 * @property {(body?: string|null, opts?: AdminRequestOptions) => Promise<AdminResponse>} update
 * @property {(body?: string|null, opts?: AdminRequestOptions) => Promise<AdminResponse>} create
 * @property {(opts?: AdminRequestOptions) => Promise<AdminResponse>} remove
 */

/**
 * Capability catalogue; individual resources expose only their supported methods.
 * Bulk payloads are serialized by the adapter; other operation bodies are BodyInit.
 *
 * @typedef {object} AdminOperationCapabilities
 * @property {string} url
 * @property {(path?: string, opts?: AdminRequestOptions) => Promise<AdminResponse>} get
 * @property {(path?: string, body?: BodyInit|null,
 *   opts?: AdminOperationOptions) => Promise<AdminResponse>} update
 * @property {(path?: string, opts?: AdminRequestOptions) => Promise<AdminResponse>} remove
 * @property {(payload: object, opts?: AdminOperationOptions) => Promise<AdminResponse>} bulk
 *
 * @typedef {Pick<AdminOperationCapabilities, 'url'|'get'>} AdminGetResource
 * @typedef {Pick<AdminOperationCapabilities, 'url'|'update'>} AdminUpdateResource
 * @typedef {Pick<AdminOperationCapabilities, 'url'|'get'|'update'>} AdminGetUpdateResource
 * @typedef {Pick<AdminOperationCapabilities, 'url'|'get'|'remove'>} AdminGetRemoveResource
 * @typedef {Pick<AdminOperationCapabilities, 'url'|'get'|'update'|'remove'>} AdminCrudResource
 * @typedef {AdminCrudResource & Pick<AdminOperationCapabilities, 'bulk'>} AdminBulkResource
 *
 * @typedef {(method: string, urlOrPath: string, body?: BodyInit|null,
 *   opts?: AdminOperationOptions) => Promise<AdminResponse>} AdminRawRequest
 */

/**
 * Existing API: coordinates are supplied when obtaining a resource.
 *
 * @typedef {object} UnboundAdminClient
 * @property {(coords: ConfigCoordinates) => AdminConfigResource} config
 * @property {(coords: SiteCoordinates) => AdminGetUpdateResource} status
 * @property {(coords: SiteCoordinates) => AdminBulkResource} preview
 * @property {(coords: SiteCoordinates) => AdminBulkResource} live
 * @property {(coords: SiteCoordinates) => AdminCrudResource} code
 * @property {(coords: SiteCoordinates) => AdminGetUpdateResource} log
 * @property {(coords: SiteCoordinates) => AdminCrudResource} index
 * @property {(coords: SiteCoordinates) => AdminUpdateResource} sitemap
 * @property {(coords: SiteCoordinates) => AdminGetRemoveResource} job
 * @property {(coords: SiteCoordinates) => AdminGetResource} psi
 * @property {(coords: SiteCoordinates) => AdminCrudResource} snapshot
 * @property {(coords: SiteCoordinates) => AdminGetResource} sidekick
 * @property {(coords: SiteCoordinates) => AdminGetResource} medialog
 * @property {AdminRawRequest} raw
 * @property {(url: string) => ParsedCoordinates} coordsFromURL
 * @property {(coords: {org: string, site?: string}) => AdminSuggestion[]} suggestions
 * @property {(extra: AdminRequestDefaults) => UnboundAdminClient} withRequestInit
 * @property {(version?: string) => UnboundAdminClient} pinVersion
 */

/**
 * Bound API: resource accessors accept no arguments; config is site-scoped.
 * Read-only coordinates let auth reuse the same target without exposing backend
 * selection. Raw access remains explicitly unscoped for API-returned job links.
 * Derivation preserves scope and backend without modifying the cached base client.
 *
 * @typedef {object} BoundAdminClientProperties
 * @property {BoundCoordinates} coords
 * @property {() => AdminConfigResource} config
 * @property {() => AdminGetUpdateResource} status
 * @property {() => AdminBulkResource} preview
 * @property {() => AdminBulkResource} live
 * @property {() => AdminCrudResource} code
 * @property {() => AdminGetUpdateResource} log
 * @property {() => AdminCrudResource} index
 * @property {() => AdminUpdateResource} sitemap
 * @property {() => AdminGetRemoveResource} job
 * @property {() => AdminGetResource} psi
 * @property {() => AdminCrudResource} snapshot
 * @property {() => AdminGetResource} sidekick
 * @property {() => AdminGetResource} medialog
 * @property {AdminRawRequest} raw
 * @property {(url: string) => ParsedCoordinates} coordsFromURL
 * @property {() => AdminSuggestion[]} suggestions
 * @property {(extra: AdminRequestDefaults) => BoundAdminClient} withRequestInit
 * @property {(version?: string) => BoundAdminClient} pinVersion
 *
 * @typedef {Readonly<BoundAdminClientProperties>} BoundAdminClient
 *
 * @typedef {() => Promise<UnboundAdminClient|null>} UnboundAdminClientFactory
 * @typedef {(coords: SiteCoordinates) => Promise<BoundAdminClient>} BoundAdminClientFactory
 */

export {};
