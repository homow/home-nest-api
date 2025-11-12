import {createClient} from '@supabase/supabase-js';
import type {SupabaseClient, SupabaseClientOptions} from '@supabase/supabase-js';

type UntypedDb = any;

export default function supabaseServer(opt: SupabaseClientOptions<UntypedDb> = {}): SupabaseClient<UntypedDb> {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !key) {
        throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment variables');
    }

    return createClient<UntypedDb>(url, key, opt);
}