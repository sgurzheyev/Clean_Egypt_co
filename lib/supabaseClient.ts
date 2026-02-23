import { createClient } from '@supabase/supabase-js';

// ПРОВЕРКА: Эти переменные ДОЛЖНЫ быть в твоем файле .env.local
// В Vite префикс VITE_ обязателен!
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("CRITICAL ERROR: Supabase keys not found in .env.local!");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
