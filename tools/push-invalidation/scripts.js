function getFormData(form) {
  const data = {};
  [...form.elements].forEach((field) => {
    const { name, type, value } = field;
    if (name && type && value) {
      switch (type) {
        case 'number':
        case 'range':
          data[name] = parseFloat(value, 10);
          break;
        case 'date':
        case 'datetime-local':
          data[name] = new Date(value);
          break;
        case 'checkbox':
          if (field.checked) {
            if (data[name]) data[name].push(value);
            else data[name] = [value];
          }
          break;
        case 'radio':
          if (field.checked) data[name] = value;
          break;
        case 'url':
          data[name] = new URL(value);
          break;
        case 'file':
          data[name] = field.files;
          break;
        default:
          data[name] = value;
      }
    }
  });
  return data;
}

function updateTypeParam(value) {
  const params = new URLSearchParams(window.location.search);
  params.set('type', value);
  const url = `${window.location.pathname}?${params.toString()}`;
  window.history.replaceState({ path: url }, '', url);
}

function clearResults(wrapper) {
  if (wrapper) wrapper.innerHTML = '';
}

function displayResults(results, container) {
  let wrapper = container.querySelector('.default-content-wrapper');
  if (!wrapper) {
    wrapper = document.querySelector('div');
    wrapper.className = 'default-content-wrapper';
    container.append(wrapper);
  }
  clearResults(wrapper);
  results.forEach((result) => {
    // build title
    const title = document.createElement('p');
    title.innerHTML = `<strong>${result.title}</strong>`;
    let body = document.createElement('pre');
    // build body
    const { type, content } = result.body;
    if (type === 'text') {
      body.textContent = content;
    } else if (type === 'json') {
      body.innerHTML = JSON.stringify(content, null, 2);
    }
    wrapper.append(title, body);
  });
}

function parseString(body) {
  // check for json
  if (body.startsWith('{') || body.startsWith('[')) {
    try {
      return {
        type: 'json',
        content: JSON.parse(body),
      };
    } catch (error) {
      return { type: 'text', content: body };
    }
  }
  return { type: 'text', content: body };
}

function formatResults(text) {
  const lines = text.split('\n').map((l) => l.trim());
  const results = lines.map((line) => {
    const [message, ...response] = line.split(': ');
    const resp = response.join(': ');
    const result = {
      title: message,
      body: { type: 'text', content: resp },
    };
    // check if response code included
    if (resp.includes(' - ')) {
      const [code, content] = resp.split(' - ');
      result.title = `<span class="status-light http${Math.floor(code / 100) % 10}">${code}</span> ${result.title}`;
      result.body = parseString(content);
    }
    return result;
  });
  return results.filter((r) => r.title && r.body && r.body.content);
}

// init
function registerListeners(doc) {
  const CREDENTIALS_FORM = doc.getElementById('credentials-form');
  const RESULTS = doc.querySelector('[data-id="results"]');

  // custom radio interactions
  const radios = CREDENTIALS_FORM.querySelectorAll('input[type="radio"]');
  const lis = [...radios].map((r) => r.closest('li'));
  radios.forEach((radio, i) => {
    radio.addEventListener('change', () => {
      clearResults(RESULTS.querySelector('.default-content-wrapper'));
      const { value } = radio;
      updateTypeParam(value);
      // update radio display
      lis.forEach((li) => li.setAttribute('aria-selected', false));
      lis[i].setAttribute('aria-selected', true);
      // update form
      CREDENTIALS_FORM.className = value;
      CREDENTIALS_FORM.querySelectorAll('.form-field.cdn').forEach((field) => {
        const match = field.classList.contains(value);
        field.setAttribute('aria-hidden', !match);
        const input = field.querySelector('input');
        input.disabled = !match;
        input.required = match;
        if (!match) input.value = '';
      });
    });
  });

  // retrieve type query param
  const params = new URLSearchParams(window.location.search);
  const initialType = params.get('type');
  const validTypes = [...radios].map((r) => r.value);
  if (validTypes.includes(initialType)) {
    const radio = CREDENTIALS_FORM.querySelector(`input[value="${initialType}"]`);
    const li = radio.closest('li');
    li.parentElement.prepend(li);
    radio.checked = true;
    radio.dispatchEvent(new Event('change'));
  }

  CREDENTIALS_FORM.addEventListener('submit', async (e) => {
    e.preventDefault();
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    const body = getFormData(e.target);
    const formData = new URLSearchParams(body);
    const type = body.type;
    const url = 'https://helix-pages.anywhere.run/helix-services/byocdn-push-invalidation/v1';
    const resp = await fetch(url, { method: 'POST', headers, body: formData.toString() });
    const text = await resp.text();
    const sanitized = type === 'cloudfront' ? text.replaceAll('\n', '') : text;
    const results = formatResults(sanitized);
    displayResults(results, RESULTS);
  });

  CREDENTIALS_FORM.addEventListener('reset', (e) => {
    clearResults(RESULTS.querySelector('.default-content-wrapper'));
    const pre = document.getElementById('credentials-results');
    if (pre) pre.closest('div').remove();
    const { type } = getFormData(e.target);
    if (type) {
      e.preventDefault();
      e.target.querySelectorAll('.form-field.cdn input[required]').forEach((req) => {
        req.value = '';
      });
    }
  });
}

registerListeners(document);
