/* eslint-disable max-classes-per-file */
export class ForcePasswordRotationRequiredError extends Error {
  constructor(response) {
    super(response.error);
    this.response = response;
    this.code = response.code;
    this.params = response.params;
    this.name = 'ForcePasswordRotationRequiredError';
  }
}

export class PortalApiError extends Error {
  constructor(response) {
    super(response.error);
    this.response = response;
    this.code = response.code;
    this.params = response.params;
    this.name = 'PortalApiError';
  }
}

export class LoginLockedError extends PortalApiError {
  constructor(response, retryAfterSeconds) {
    super(response);
    this.name = 'LoginLockedError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class SessionExpiredError extends PortalApiError {
  constructor(response = { code: 'INVALID_SESSION', error: '' }) {
    super(response);
    this.name = 'SessionExpiredError';
  }
}

function basicAuthorization(username, password) {
  const normalizedUsername = username.trim().toLowerCase();
  const bytes = new TextEncoder().encode(`${normalizedUsername}:${password}`);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return `Basic ${btoa(binary)}`;
}

async function errorDetails(response, fallbackCode) {
  const text = (await response.text()).slice(0, 500);
  try {
    const payload = JSON.parse(text);
    return {
      error: typeof payload.error === 'string' ? payload.error : '',
      code: typeof payload.code === 'string' ? payload.code : fallbackCode,
      params: payload.params && typeof payload.params === 'object' && !Array.isArray(payload.params)
        ? payload.params : undefined,
    };
  } catch {
    return { error: '', code: fallbackCode };
  }
}

function sessionExpiryMilliseconds(expiresAt) {
  if (!Number.isFinite(expiresAt)) return 0;
  return expiresAt < 1_000_000_000_000 ? expiresAt * 1000 : expiresAt;
}

export class PortalApi {
  constructor(config, fetchImpl = window.fetch.bind(window)) {
    this.apiBase = `${config.apiBaseUrl}/api/upload/v1`;
    this.apiOrigin = new URL(config.apiBaseUrl).origin;
    this.encodedOrg = encodeURIComponent(config.org);
    this.uploadHostSuffixes = config.uploadHostSuffixes;
    this.fetchImpl = fetchImpl;
    this.sessionToken = '';
    this.sessionExpiresAt = 0;
  }

  getI18nManifestUrl() {
    return `${this.apiBase}/i18n/manifest.json`;
  }

  clearSession() {
    this.sessionToken = '';
    this.sessionExpiresAt = 0;
  }

  setSession(session) {
    this.sessionToken = session.sessionToken;
    this.sessionExpiresAt = sessionExpiryMilliseconds(session.expiresAt);
  }

  getSessionToken() {
    return this.sessionToken;
  }

  assertSession() {
    if (!this.sessionToken || (this.sessionExpiresAt && Date.now() >= this.sessionExpiresAt)) {
      this.clearSession();
      throw new SessionExpiredError();
    }
  }

  tenantUrl(path) {
    const separator = path.includes('?') ? '&' : '?';
    return `${this.apiBase}${path}${separator}org=${this.encodedOrg}`;
  }

  async getLoginBranding() {
    const response = await this.fetchImpl(
      this.tenantUrl('/portal-branding/login'),
      { headers: { Accept: 'application/json' } },
    );
    if (!response.ok) return {};
    const branding = await response.json();
    return branding && typeof branding === 'object' && !Array.isArray(branding)
      ? branding : {};
  }

  async createSession(username, password) {
    const response = await this.fetchImpl(this.tenantUrl('/session'), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: basicAuthorization(username, password),
      },
    });
    if (!response.ok) {
      const details = await errorDetails(response, 'SERVICE_UNAVAILABLE');
      if (details.code === 'FORCE_PASSWORD_ROTATION_REQUIRED') {
        throw new ForcePasswordRotationRequiredError(details);
      }
      if (details.code === 'LOGIN_LOCKED') {
        const retryAfterSeconds = Number.isFinite(details.params?.retryAfterSeconds)
          ? details.params.retryAfterSeconds : undefined;
        throw new LoginLockedError(details, retryAfterSeconds);
      }
      throw new PortalApiError(details);
    }
    const session = await response.json();
    if (!session || typeof session.sessionToken !== 'string'
      || !Number.isFinite(session.expiresAt) || typeof session.username !== 'string'
      || !session.vendor || typeof session.vendor.name !== 'string'
      || typeof session.metadataSchema !== 'object') {
      throw new PortalApiError({ code: 'SERVICE_UNAVAILABLE', error: '' });
    }
    this.setSession(session);
    return session;
  }

  async rotatePassword(username, currentPassword, graceHours = 0) {
    const response = await this.fetchImpl(
      this.tenantUrl('/account/rotate-password'),
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: basicAuthorization(username, currentPassword),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ graceHours }),
      },
    );
    if (!response.ok) {
      throw new PortalApiError(await errorDetails(response, 'SERVICE_UNAVAILABLE'));
    }
    const result = await response.json();
    if (!result || typeof result.password !== 'string'
      || typeof result.passwordId !== 'string') {
      throw new PortalApiError({ code: 'SERVICE_UNAVAILABLE', error: '' });
    }
    return result;
  }

  async sessionRequest(path, options = {}) {
    this.assertSession();
    const response = await this.fetchImpl(this.tenantUrl(path), {
      ...options,
      headers: {
        Accept: 'application/json',
        Authorization: ['Bearer', this.sessionToken].join(' '),
        ...options.headers,
      },
    });
    if (!response.ok) {
      const details = await errorDetails(response, 'SERVICE_UNAVAILABLE');
      if (response.status === 401) {
        this.clearSession();
        throw new SessionExpiredError(details);
      }
      throw new PortalApiError(details);
    }
    return response;
  }

  async post(path, body) {
    const response = await this.sessionRequest(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return response.json();
  }

  checkDuplicate(fileName, fileSize, options) {
    return this.post('/uploads/check-duplicate', {
      fileName,
      fileSize,
      pathPrefix: options.pathPrefix,
      metadata: options.metadata,
      batchId: options.batchId,
      sequenceIndex: options.sequenceIndex,
      mimeType: options.mimeType,
      imageWidth: options.imageWidth,
      imageHeight: options.imageHeight,
    });
  }

  startBatch(metadata) {
    return this.post('/batches/start', { metadata });
  }

  completeBatch(body) {
    return this.post('/batches/complete', body);
  }

  getBatchVerification(batchId) {
    return this.sessionRequest(`/batches/${encodeURIComponent(batchId)}/verification`)
      .then((response) => response.json());
  }

  initiateUpload(fileName, fileSize, mimeType, options) {
    return this.post('/uploads/initiate', {
      fileName,
      fileSize,
      mimeType,
      pathPrefix: options.pathPrefix,
      metadata: options.metadata,
      batchId: options.batchId,
      sequenceIndex: options.sequenceIndex,
      imageWidth: options.imageWidth,
      imageHeight: options.imageHeight,
    });
  }

  async completeUpload(body) {
    await this.post('/uploads/complete', body);
  }

  validateUploadUri(value) {
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new PortalApiError({ code: 'UPLOAD_FAILED', error: '' });
    }
    const hostname = url.hostname.toLowerCase();
    const allowedStorage = this.uploadHostSuffixes.some((suffix) => hostname.endsWith(suffix));
    const localApiHttp = url.protocol === 'http:'
      && url.origin === this.apiOrigin
      && ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
    if ((url.protocol !== 'https:' && !localApiHttp)
      || (url.origin !== this.apiOrigin && !allowedStorage)) {
      throw new PortalApiError({ code: 'UPLOAD_FAILED', error: '' });
    }
    return url.href;
  }

  putPart(uri, chunk, onProgress) {
    const safeUri = this.validateUploadUri(uri);
    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open('PUT', safeUri);
      request.setRequestHeader('Content-Type', 'application/octet-stream');
      request.setRequestHeader('x-ms-blob-type', 'BlockBlob');
      request.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          onProgress(Math.round((event.loaded / event.total) * 100));
        }
      };
      request.onload = () => {
        if (request.status >= 200 && request.status < 300) resolve();
        else reject(new PortalApiError({ code: 'UPLOAD_FAILED', error: '' }));
      };
      request.onerror = () => reject(
        new PortalApiError({ code: 'SERVICE_UNAVAILABLE', error: '' }),
      );
      request.send(chunk);
    });
  }

  async uploadFileBlocks(file, initiation, onProgress) {
    if (!Array.isArray(initiation.uploadURIs) || !initiation.uploadURIs.length
      || !Number.isFinite(initiation.maxPartSize) || !Number.isFinite(initiation.minPartSize)) {
      throw new PortalApiError({ code: 'UPLOAD_FAILED', error: '' });
    }
    const { uploadURIs, maxPartSize, minPartSize } = initiation;
    if (uploadURIs.length === 1 && file.size <= maxPartSize) {
      await this.putPart(uploadURIs[0], file, onProgress);
      return;
    }
    const partSize = Math.max(
      minPartSize,
      Math.ceil(file.size / uploadURIs.length),
    );
    let uploaded = 0;
    for (let index = 0; index < uploadURIs.length; index += 1) {
      const start = index * partSize;
      if (start >= file.size) break;
      const chunk = file.slice(start, Math.min(start + partSize, file.size));
      const uploadedBeforePart = uploaded;
      // eslint-disable-next-line no-await-in-loop
      await this.putPart(uploadURIs[index], chunk, (partProgress) => {
        const total = uploadedBeforePart + ((partProgress / 100) * chunk.size);
        onProgress(Math.round((total / file.size) * 100));
      });
      uploaded += chunk.size;
      onProgress(Math.round((uploaded / file.size) * 100));
    }
  }
}
