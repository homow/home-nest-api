import type {VercelRequest, VercelResponse} from '@vercel/node';
import cookie, {SerializeOptions} from 'cookie';
import supabaseAnon from '../config/supabaseClient';
import supabaseServer from '../config/supabaseServer';
import applyCors from '../config/cors';
import {SupabaseClient} from "@supabase/supabase-js";

const supabase: SupabaseClient = supabaseAnon();
const supabaseAdmin: SupabaseClient = supabaseServer();

function clearRefreshCookie(): string {
    const options: SerializeOptions = {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 0,
    };
    return cookie.serialize('sb_refresh_token', '', options);
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
    if (applyCors(req, res)) return;

    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        res.status(405).json({ok: false, error: 'METHOD_NOT_ALLOWED'});
        return;
    }

    const clearHeaders = [clearRefreshCookie()];

    try {
        const cookies = cookie.parse(req.headers.cookie || '');
        const refreshToken = cookies['sb_refresh_token'];

        if (!refreshToken) {
            res.setHeader('Set-Cookie', clearHeaders);
            res.status(200).json({ok: true});
            return;
        }

        try {
            await supabase.auth.signOut?.();
        } catch {
            // silent
        }

        try {
            if (supabaseAdmin) {
                try {
                    await supabaseAdmin
                        .from('auth.sessions')
                        .delete()
                        .eq('refresh_token', refreshToken);
                } catch {
                    const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/$/, '');
                    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
                    if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
                        await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                apikey: SUPABASE_SERVICE_ROLE_KEY,
                                Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                            },
                            body: JSON.stringify({refresh_token: refreshToken}),
                        });
                    }
                }
            }
        } catch {
            // silent
        }

        res.setHeader('Set-Cookie', clearHeaders);
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.status(200).json({ok: true});
    } catch {
        res.setHeader('Set-Cookie', clearHeaders);
        res.status(500).json({ok: false, error: 'INTERNAL_ERROR'});
    }
}