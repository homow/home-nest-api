import {createClient} from '@supabase/supabase-js';
import type {SupabaseClient, SupabaseClientOptions} from '@supabase/supabase-js';

type UntypedDb = any;

export default function supabaseAnon(opt: SupabaseClientOptions<UntypedDb> = {}): SupabaseClient<UntypedDb> {
    const url = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY;

    if (!url || !anonKey) {
        throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY in environment variables');
    }

    return createClient<UntypedDb>(url, anonKey, opt);
}