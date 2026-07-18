/**
 * [[Architecture_Overview.md]]
 * Browser Supabase client re-export (single instance via services/supabase).
 *
 * IMPORTANT: `createClient` must be called in exactly one place for the browser
 * to avoid duplicate initialization and subtle ordering bugs.
 */
export { supabase } from '../services/supabase';
