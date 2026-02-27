const SHEETS = {};

export default async function getSheet(path) {
  if (SHEETS[path]) return SHEETS[path];
  const resp = await fetch(path);
  const text = await resp.text();
  const sheet = new CSSStyleSheet();
  sheet.replace(text);
  SHEETS[path] = sheet;
  return sheet;
}
