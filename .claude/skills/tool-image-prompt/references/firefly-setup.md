# Adobe Firefly API Setup

## Prerequisites

1. An Adobe Developer Console account
2. A Firefly Services API project with OAuth Server-to-Server credentials

## Getting Credentials

1. Go to [Adobe Developer Console](https://developer.adobe.com/console/)
2. Create a new project (or use an existing one)
3. Add the **Firefly - Firefly Services** API
4. Select **OAuth Server-to-Server** credential type
5. From the credential page, note your **Client ID** and retrieve your **Client Secret**

Full guide: [Create Credentials](https://developer.adobe.com/firefly-services/docs/firefly-api/guides/concepts/create-credentials/)

## Environment Variables

**Option A — `.env` file (recommended):** Create a `.env` file at `.claude/skills/tool-image-prompt/scripts/.cache/.env` (this directory is gitignored):

```
FIREFLY_CLIENT_ID=your-client-id
FIREFLY_CLIENT_SECRET=your-client-secret
```

**Option B — shell profile:** Export in your shell profile (e.g. `~/.zshrc`):

```bash
export FIREFLY_CLIENT_ID="your-client-id"
export FIREFLY_CLIENT_SECRET="your-client-secret"
```

## Verify Setup

```bash
node .claude/skills/tool-image-prompt/scripts/generate.mjs --prompt "a simple teal circle on dark background" --n 1
```

This should authenticate, submit a job, and download `tool-image-1.jpg` to the current directory.

## Token Notes

- Access tokens are generated automatically by the script on each run
- Tokens expire after 24 hours (irrelevant since the script generates a fresh one each time)
- Credentials should never be committed to the repository
