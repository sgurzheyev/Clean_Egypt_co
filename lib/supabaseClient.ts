
import { createClient } from '@supabase/supabase-js';

// These variables are expected to be set in the Vercel environment as per your instructions.
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn("Supabase environment variables (SUPABASE_URL, SUPABASE_ANON_KEY) not found. Database and storage operations will fail.");
}

// The '!' tells TypeScript that we expect these to be non-null.
// The warning above will be shown if they are not configured in the environment.
export const supabase = createClient(supabaseUrl!, supabaseAnonKey!);
