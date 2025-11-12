import type {VercelRequest, VercelResponse} from '@vercel/node';
import type {SerializeOptions} from 'cookie';
import type {SupabaseClient} from "@supabase/supabase-js";
import cookie from 'cookie';
import supabaseAnon from '../config/supabaseClient.js';
import supabaseServer from '../config/supabaseServer.js';
import applyCors from '../config/cors.js';

const supabase: SupabaseClient = supabaseAnon({auth: {persistSession: false}});
const supabaseAdmin: SupabaseClient = supabaseServer();

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
    if (applyCors(req, res)) return;
    if (req.method !== 'POST') {
        res.status(405).end();
        return;
    }

    try {
        const cookies = cookie.parse(req.headers.cookie || '');
        const refresh_token = cookies['sb_refresh_token'];

        if (!refresh_token) {
            res.status(401).json({error: 'NO_REFRESH_TOKEN'});
            return;
        }

        const {data: refreshData, error: refreshError} = await supabase.auth.refreshSession({
            refresh_token: String(refresh_token),
        });

        const session = refreshData?.session;
        if (refreshError || !session?.access_token || !session.refresh_token || !session.user?.id) {
            res.setHeader('Set-Cookie', clearRefreshCookie(req));
            res.status(401).json({ok: false, error: 'REFRESH_FAILED'});
            return;
        }

        const {access_token: newAccessToken, refresh_token: newRefreshToken} = session;
        const userId = session.user.id;

        const {data: profile, error: profileErr} = await supabaseAdmin
            .from('user_profiles')
            .select('last_strict_login_at, session_remember, id, email, display_name, role')
            .eq('id', userId)
            .single();

        if (profileErr || !profile) {
            res.setHeader('Set-Cookie', clearRefreshCookie(req));
            res.status(500).json({error: 'PROFILE_FETCH_FAILED'});
            return;
        }

        const rememberFlag = !!profile.session_remember;
        const lastLogin = profile.last_strict_login_at ? new Date(profile.last_strict_login_at) : null;
        const now = new Date();

        if (!rememberFlag && (!lastLogin || now.getTime() - lastLogin.getTime() > 8 * 60 * 60 * 1000)) {
            res.setHeader('Set-Cookie', clearRefreshCookie(req));
            res.status(401).json({ok: false, error: 'SESSION_EXPIRED'});
            return;
        }

        res.setHeader('Set-Cookie', setRefreshCookie(req, newRefreshToken, rememberFlag));
        res.status(200).json({
            ok: true,
            accessToken: newAccessToken,
            user: {
                id: profile.id,
                email: profile.email || null,
                display_name: profile.display_name || null,
                role: profile.role || null,
            },
        });
    } catch {
        res.status(500).json({error: 'INTERNAL_ERROR'});
    }
}

function isLocalRequest(req: VercelRequest): boolean {
    const origin = req.headers.origin || '';
    return origin.includes('localhost') || origin.includes('127.0.0.1');
}

function setRefreshCookie(req: VercelRequest, token: string, rememberFlag: boolean): string {
    const isLocal = isLocalRequest(req);
    const options: SerializeOptions = {
        httpOnly: true,
        secure: !isLocal,
        sameSite: isLocal ? 'lax' : 'none',
        path: '/',
        maxAge: rememberFlag ? 60 * 60 * 24 * 7 : 60 * 60 * 8,
    };
    return cookie.serialize('sb_refresh_token', token, options);
}

function clearRefreshCookie(req: VercelRequest): string {
    const isLocal = isLocalRequest(req);
    const options: SerializeOptions = {
        httpOnly: true,
        secure: !isLocal,
        sameSite: isLocal ? 'lax' : 'none',
        path: '/',
        maxAge: 0,
    };
    return cookie.serialize('sb_refresh_token', '', options);
}