export function getContentSourceType(contentUrl, contentSourceType, isLoading = false) {
  if (isLoading) return { type: 'loading', label: '...' };
  if (!contentSourceType && !contentUrl) return { type: 'unknown', label: '?' };

  const sourceTypeLookup = {
    google: { type: 'google', label: 'Google Drive' },
    onedrive: { type: 'sharepoint', label: 'SharePoint' },
  };

  if (sourceTypeLookup[contentSourceType]) {
    return sourceTypeLookup[contentSourceType];
  }

  if (contentSourceType === 'markup') {
    if (contentUrl?.startsWith('https://content.da.live')) {
      return { type: 'da', label: 'DA' };
    }

    if (contentUrl?.includes('adobeaemcloud')) {
      return { type: 'aem', label: 'AEM' };
    }

    return { type: 'byom', label: 'BYOM' };
  }

  return { type: 'unknown', label: '?' };
}

export function getDAEditorURL(contentUrl) {
  if (!contentUrl) return null;

  if (
    contentUrl.startsWith('https://content.da.live/')
    || contentUrl.startsWith('https://stage-content.da.live/')
  ) {
    const path = contentUrl.replace('https://content.da.live/', '');
    return `https://da.live/#/${path}`;
  }

  return contentUrl;
}
