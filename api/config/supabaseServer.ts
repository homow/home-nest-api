import type {SupabaseClient, SupabaseClientOptions} from "@supabase/supabase-js";
import {createClient} from "@supabase/supabase-js";

type UnType = any;

export default function supabaseServer(opt: SupabaseClientOptions<UnType> = {}): SupabaseClient {
    const url: string | undefined = process.env.SUPABASE_URL;
    const key: string | undefined = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !key) {
        throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment variables');
    }

    return createClient(url, key, opt);
};