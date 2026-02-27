import getSheet from '../utils/sheet.js';

export const pageSheet = await getSheet(new URL('./styles.css', import.meta.url).pathname);
export const sharedSheet = await getSheet(new URL('./shared.css', import.meta.url).pathname);
