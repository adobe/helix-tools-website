# Authentication Approach for Snapshot Scheduler

## Problem Statement

The snapshot-scheduler tool needs to authenticate users when registering sites with the scheduler worker service. The challenge is:

- User authentication happens on `admin.hlx.page` (sets cookies)
- API calls need to go to `helix-snapshot-scheduler-prod.adobeaem.workers.dev` (different domain)
- Browser security (CORS, SameSite cookies) prevents sharing auth cookies across domains
- Sidekick's `getIdToken` action is not reliably working
- Direct cross-domain cookie sharing is blocked by modern browsers

## Tested and Rejected: Worker Backend-to-Backend Verification

This approach attempted to send `admin.hlx.page` cookies directly from the browser to the worker domain using `credentials: 'include'`.

### Why It Was Rejected

**Testing confirmed this approach does NOT work:**

🚫 **SameSite Cookie Blocking**: Browsers do not send cookies from `admin.hlx.page` when making requests to `helix-snapshot-scheduler-prod.adobeaem.workers.dev` due to:
- **Different domains** = Third-party cookie scenario
- **SameSite=Lax** (default) blocks cookies on cross-site fetch requests
- **Safari/Firefox** block all third-party cookies by default
- **Chrome** is phasing out third-party cookie support

**Test Results:**
- Added `credentials: 'include'` to fetch calls
- Browser DevTools confirmed NO cookies sent in request headers
- Approach is fundamentally incompatible with modern browser security

**This approach is not viable and should not be pursued.**

---

## Solution: Admin.hlx.page as API Gateway/Proxy

### Architecture

```
┌─────────┐           ┌──────────────────────┐           ┌─────────┐
│ Browser │           │  admin.hlx.page      │           │ Worker  │
│         │           │  (API Gateway/Proxy) │           │         │
└────┬────┘           └──────────┬───────────┘           └────┬────┘
     │                           │                             │
     │ POST /api/scheduler/register                           │
     │ {org, site, apiKey}       │                             │
     │──────────────────────────>│                             │
     │ (admin.hlx.page cookies)  │                             │
     │                           │                             │
     │                           │ 1. Verify user (session)    │
     │                           │ 2. Get user's ID token      │
     │                           │                             │
     │                           │ 3. Forward to worker        │
     │                           │ POST /register              │
     │                           │ Authorization: token <tok>  │
     │                           │────────────────────────────>│
     │                           │                             │
     │                           │ 4. Worker response          │
     │                           │<────────────────────────────│
     │                           │                             │
     │ 5. Response               │                             │
     │<──────────────────────────│                             │
```

### Implementation

**Frontend (tools/snapshot-scheduler/snapshot-scheduler.js):**

```javascript
// Change SCHEDULER_ORIGIN to use admin.hlx.page proxy
const SCHEDULER_API = 'https://admin.hlx.page/api/scheduler';

async function registerWithScheduler(org, site, apiKey) {
  const body = { org, site, apiKey };

  try {
    // Call admin.hlx.page proxy endpoint instead of worker directly
    const resp = await fetch(`${SCHEDULER_API}/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include', // Send admin.hlx.page cookies (same domain)
      body: JSON.stringify(body),
    });
    // ... handle response
  } catch (error) {
    // ... handle error
  }
}

async function checkRegistrationStatus(org, site) {
  try {
    // Check via proxy
    const resp = await fetch(`${SCHEDULER_API}/register/${org}/${site}`, {
      credentials: 'include',
    });
    // ... handle response
  } catch (error) {
    // ... handle error
  }
}
```

**Admin.hlx.page Proxy Endpoint:**

```javascript
// On admin.hlx.page server
app.all('/api/scheduler/*', async (req, res) => {
  // 1. User is already authenticated via session cookies
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  const { org } = req.body || req.params;
  
  // 2. Get user's ID token for the org
  const idToken = await getIdTokenForUser(req.user, org);
  
  if (!idToken) {
    return res.status(403).json({ error: 'Unable to get auth token' });
  }
  
  // 3. Forward request to worker with Authorization header
  const workerPath = req.path.replace('/api/scheduler', '');
  const workerUrl = `https://helix-snapshot-scheduler-prod.adobeaem.workers.dev${workerPath}`;
  
  try {
    const workerResp = await fetch(workerUrl, {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `token ${idToken}`,
      },
      body: req.method !== 'GET' ? JSON.stringify(req.body) : undefined,
    });
    
    const data = await workerResp.json();
    
    // 4. Return worker response to client
    return res.status(workerResp.status).json(data);
  } catch (error) {
    return res.status(502).json({ error: 'Gateway error', details: error.message });
  }
});
```

**Worker (unchanged):**

```javascript
// Worker expects Authorization header, continues to work as designed
async function handleRegister(request) {
  const authHeader = request.headers.get('Authorization');
  const token = authHeader?.replace('token ', '');
  
  if (!token) {
    return new Response('Unauthorized', { status: 401 });
  }
  
  // Validate token and proceed with registration
  // ... existing worker logic
}
```

### Pros

✅ **Works with all browsers**: No cross-domain cookie issues  
✅ **Clean separation**: Frontend only talks to admin.hlx.page  
✅ **Token security**: ID token never exposed to client browser  
✅ **Reusable pattern**: Can proxy multiple worker services  
✅ **Centralized control**: Rate limiting, logging, validation in one place  
✅ **No CORS complexity**: All same-origin requests from browser perspective  
✅ **Standard pattern**: Well-established API Gateway architecture  
✅ **Easy to maintain**: Clear boundaries between components  

### Cons

❌ Requires backend changes to admin.hlx.page  
❌ Adds network hop (minor latency increase)  
❌ Admin.hlx.page becomes single point of failure for scheduler API  
❌ Need to maintain proxy route mappings  

### Implementation Requirements

1. **Backend work**: Add proxy routes to admin.hlx.page
2. **Frontend work**: Update API endpoints to use admin.hlx.page
3. **Worker work**: No changes needed (already expects Authorization header)
4. **Documentation**: Update API docs to reference proxy endpoints

---

## Why This Is The Only Viable Solution

The API Gateway/Proxy pattern is **the only approach that works** with modern browser security:

1. ✅ **Browser compatibility**: No cross-domain cookie issues (same-origin requests)
2. ✅ **Standard pattern**: Well-established API Gateway architecture
3. ✅ **Security**: Token never exposed to client browser
4. ✅ **Reusability**: Can proxy multiple worker services
5. ✅ **Maintainability**: Clear separation of concerns
6. ✅ **Future-proof**: Works with current and future browser security policies

### Implementation Order

1. **Phase 1**: Backend team implements proxy routes on admin.hlx.page
   - Define proxy endpoint contract (`/api/scheduler/*`)
   - Implement token injection logic
   - Add error handling and logging
   - Configure CORS if needed (though shouldn't be necessary for same-origin)

2. **Phase 2**: Update frontend to use new proxy endpoints
   - Change `SCHEDULER_ORIGIN` to `admin.hlx.page/api/scheduler`
   - Remove `getIdToken()` function (no longer needed)
   - Keep `credentials: 'include'` for admin.hlx.page cookies
   - Update error handling

3. **Phase 3**: Test and validate
   - Test on preview environment
   - Verify auth flow works correctly
   - Test error scenarios (401, 403, 502)
   - Load testing if needed

4. **Phase 4**: Document the pattern for future use
   - Update project documentation
   - Create guide for adding new worker proxies
   - Document error codes and troubleshooting

---

## Next Steps

1. Discuss proxy implementation with admin.hlx.page backend team
2. Define proxy endpoint contract and error handling
3. Update frontend code to use proxy endpoints
4. Add integration tests
5. Update documentation

## Questions to Address

- Should the proxy handle all scheduler endpoints or just authentication-required ones?
- What error codes/messages should the proxy return?
- Should we add rate limiting at the proxy level?
- How should we handle worker downtime/errors?
- Should we cache any responses at the proxy level?

