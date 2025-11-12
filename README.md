# tools.aem.live

[tools.aem.live](https://tools.aem.live/), provides administrative and development tools for AEM Edge Delivery Services (EDS).

## Environments
- Preview: https://main--helix-tools-website--adobe.aem.page/
- Live: https://main--helix-tools-website--adobe.aem.live/

## Installation

```sh
npm i
```

## Linting

```sh
npm run lint
```

## Local development

1. Create a new repository based on the `aem-boilerplate` template and add a mountpoint in the `fstab.yaml`
1. Add the [AEM Code Sync GitHub App](https://github.com/apps/aem-code-sync) to the repository
1. Install the [AEM CLI](https://github.com/adobe/helix-cli): `npm install -g @adobe/aem-cli`
1. Start AEM Proxy: `aem up` (opens your browser at `http://localhost:3000`)
1. Open the `helix-admin-website` directory in your favorite IDE and start coding :)
