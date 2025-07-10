const params = new URLSearchParams(window.location.search);
const org = params.get('org');
const site = params.get('site');
const user = params.get('user');
const url = params.get('url');

// set content source link
const contentSource = document.querySelector('.bot-info-content-source');
const editUrl = url.replace('https://content.da.live', 'https://da.live#');
const editLink = document.createElement('a');
editLink.href = editUrl;
editLink.textContent = editUrl;
contentSource.textContent = '';
contentSource.appendChild(editLink);

const orgElement = document.querySelector('.bot-info-org');
orgElement.textContent = org;

const userElement = document.querySelector('.bot-info-user');
userElement.textContent = user;

const siteElement = document.querySelector('.bot-info-site');
siteElement.textContent = site;
