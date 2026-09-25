// Build-time configuration (Vite inlines VITE_* at build). See desk/.env.example.
export const SCRIPT_ID: string = (import.meta.env.VITE_SCRIPT_ID as string | undefined) ?? '';
export const CLIENT_ID: string = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? '';
/** true → scripts.run uses the script's HEAD (owner/editors only); false → the API-executable deployment. */
export const DEV_MODE: boolean = String(import.meta.env.VITE_DEV_MODE ?? '') === 'true';
export const CONFIG_OK: boolean = SCRIPT_ID.length > 0 && CLIENT_ID.length > 0 && !/REPLACE_ME/.test(CLIENT_ID + SCRIPT_ID);

export const RUN_URL = `https://script.googleapis.com/v1/scripts/${SCRIPT_ID}:run`;
export const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

export const APP_NAME = 'SilverFox desk';
export const POLL_MS = 1500;                // run progress poll, same cadence as the HtmlService desk
