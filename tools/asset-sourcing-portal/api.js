/* eslint-disable max-classes-per-file */
export class ForceRotateRequiredError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ForceRotateRequiredError';
  }
}

export class LoginLockedError extends Error {
  constructor(message, retryAfterSeconds) {
    super(message);
    this.name = 'LoginLockedError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class SessionExpiredError extends Error {
  constructor(message = 'Your session has expired. Please sign in again.') {
    super(message);
    this.name = 'SessionExpiredError';
  }
}

function basicAuthorization(accountName, apiKey) {
  const bytes = new TextEncoder().encode(`${accountName}:${apiKey}`);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return `Basic ${btoa(binary)}`;
}

async function errorDetails(response, fallback) {
  const text = (await response.text()).slice(0, 500);
  try {
    const payload = JSON.parse(text);
    return {
      message: typeof payload.error === 'string' ? payload.error : fallback,
      code: typeof payload.code === 'string' ? payload.code : undefined,
      retryAfterSeconds: Number.isFinite(payload.retryAfterSeconds)
        ? payload.retryAfterSeconds : undefined,
    };
  } catch {
    return { message: text || fallback };
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
    this.encodedImsOrgId = encodeURIComponent(config.imsOrgId);
    this.uploadHostSuffixes = config.uploadHostSuffixes;
    this.fetchImpl = fetchImpl;
    this.sessionToken = '';
    this.sessionExpiresAt = 0;
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

  async getLoginBranding() {
    const response = await this.fetchImpl(
      `${this.apiBase}/portal-branding/login/${this.encodedImsOrgId}`,
      {
        headers: { Accept: 'application/json' },
      },
    );
    if (!response.ok) return {};
    const branding = await response.json();
    return branding && typeof branding === 'object' && !Array.isArray(branding)
      ? branding : {};
  }

  async createSession(accountName, apiKey) {
    const response = await this.fetchImpl(`${this.apiBase}/session/${this.encodedImsOrgId}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: basicAuthorization(accountName, apiKey),
      },
    });
    if (!response.ok) {
      const details = await errorDetails(response, 'Sign-in failed.');
      if (details.code === 'FORCE_ROTATE_REQUIRED') {
        throw new ForceRotateRequiredError(details.message);
      }
      if (details.code === 'LOGIN_LOCKED') {
        throw new LoginLockedError(details.message, details.retryAfterSeconds);
      }
      throw new Error(details.message);
    }
    const session = await response.json();
    if (!session || typeof session.sessionToken !== 'string'
      || !Number.isFinite(session.expiresAt) || typeof session.metadataSchema !== 'object') {
      throw new Error('The service returned an invalid session response.');
    }
    this.setSession(session);
    return session;
  }

  async rotateKey(accountName, currentApiKey, graceHours = 0) {
    const response = await this.fetchImpl(
      `${this.apiBase}/account/rotate-key/${this.encodedImsOrgId}`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: basicAuthorization(accountName, currentApiKey),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ graceHours }),
      },
    );
    if (!response.ok) {
      const details = await errorDetails(response, 'Key rotation failed.');
      throw new Error(details.message);
    }
    const result = await response.json();
    if (!result || typeof result.apiKey !== 'string') {
      throw new Error('The service returned an invalid key rotation response.');
    }
    return result;
  }

  async sessionRequest(path, options = {}) {
    this.assertSession();
    const response = await this.fetchImpl(`${this.apiBase}${path}`, {
      ...options,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${this.sessionToken}`,
        ...options.headers,
      },
    });
    if (!response.ok) {
      const details = await errorDetails(response, 'The request failed.');
      if (response.status === 401) {
        this.clearSession();
        throw new SessionExpiredError(details.message);
      }
      throw new Error(details.message);
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
      throw new Error('The service returned an invalid upload URL.');
    }
    const hostname = url.hostname.toLowerCase();
    const allowedStorage = this.uploadHostSuffixes.some((suffix) => hostname.endsWith(suffix));
    const localApiHttp = url.protocol === 'http:'
      && url.origin === this.apiOrigin
      && ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
    if ((url.protocol !== 'https:' && !localApiHttp)
      || (url.origin !== this.apiOrigin && !allowedStorage)) {
      throw new Error('The service returned an unapproved upload destination.');
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
        else reject(new Error(`Upload storage returned ${request.status}.`));
      };
      request.onerror = () => reject(new Error('A network error interrupted the upload.'));
      request.send(chunk);
    });
  }

  async uploadFileBlocks(file, initiation, onProgress) {
    if (!Array.isArray(initiation.uploadURIs) || !initiation.uploadURIs.length
      || !Number.isFinite(initiation.maxPartSize) || !Number.isFinite(initiation.minPartSize)) {
      throw new Error('The service returned invalid multipart upload instructions.');
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
      // Multipart PUTs are sequential per file; file-level concurrency is separate.
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
