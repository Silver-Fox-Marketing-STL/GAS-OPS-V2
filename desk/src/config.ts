// Build-time configuration (Vite inlines VITE_* at build). See desk/.env.example.
export const EXEC_URL: string = (import.meta.env.VITE_EXEC_URL as string | undefined) ?? '';
export const CLIENT_ID: string = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? '';
export const CONFIG_OK: boolean = EXEC_URL.length > 0 && CLIENT_ID.length > 0 && !/REPLACE_ME/.test(CLIENT_ID);

export const APP_NAME = 'SilverFox desk';
export const POLL_MS = 1500;                // run progress poll, same cadence as the HtmlService desk
