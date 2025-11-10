import cookie from 'cookie';
import supabaseAnon from '../config/supabaseClient.js';
import supabaseServer from '../config/supabaseServer.js';
import applyCors from "../config/cors.js";

const supabase = supabaseAnon({ auth: { persistSession: false } });
const supabaseAdmin = supabaseServer();

export default async function handler(req, res) {
    if (applyCors(req, res)) return;
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const cookies = cookie.parse(req.headers.cookie || '');
        const refresh_token = cookies['sb_refresh_token'];

        if (!refresh_token) {
            return res.status(401).json({ error: 'NO_REFRESH_TOKEN' });
        }

        const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession({
            refresh_token: String(refresh_token)
        });

        if (refreshError || !refreshData?.session?.access_token) {
            res.setHeader('Set-Cookie', clearRefreshCookie(req));
            return res.status(401).json({ ok: false, error: 'REFRESH_FAILED' });
        }

        const { access_token: newAccessToken, refresh_token: newRefreshToken } = refreshData.session;
        const userId = refreshData.session.user.id;

        const { data: profile, error: profileErr } = await supabaseAdmin
            .from('user_profiles')
            .select('last_strict_login_at, session_remember, id, email, display_name, role')
            .eq('id', userId)
            .single();

        if (profileErr || !profile) {
            res.setHeader('Set-Cookie', clearRefreshCookie(req));
            return res.status(500).json({ error: 'PROFILE_FETCH_FAILED' });
        }

        const rememberFlag = !!profile.session_remember;
        const lastLogin = profile.last_strict_login_at ? new Date(profile.last_strict_login_at) : null;
        const now = new Date();

        if (!rememberFlag && (!lastLogin || (now - lastLogin) > (8 * 60 * 60 * 1000))) {
            res.setHeader('Set-Cookie', clearRefreshCookie(req));
            return res.status(401).json({ ok: false, error: 'SESSION_EXPIRED' });
        }

        res.setHeader('Set-Cookie', setRefreshCookie(req, newRefreshToken, rememberFlag));

        return res.status(200).json({
            ok: true,
            accessToken: newAccessToken,
            user: {
                id: profile.id,
                email: profile.email || null,
                display_name: profile.display_name || null,
                role: profile.role || null,
            }
        });

    } catch (e) {
        return res.status(500).json({ error: 'INTERNAL_ERROR' });
    }
}

function isLocalRequest(req) {
    const origin = req.headers.origin || '';
    return origin.includes('localhost') || origin.includes('127.0.0.1');
}

function setRefreshCookie(req, token, rememberFlag) {
    const isLocal = isLocalRequest(req);
    return cookie.serialize('sb_refresh_token', token, {
        httpOnly: true,
        secure: !isLocal,
        sameSite: isLocal ? 'lax' : 'none',
        path: '/',
        maxAge: rememberFlag ? 60 * 60 * 24 * 7 : 60 * 60 * 8,
    });
}

function clearRefreshCookie(req) {
    const isLocal = isLocalRequest(req);
    return cookie.serialize('sb_refresh_token', '', {
        httpOnly: true,
        secure: !isLocal ? true : false,
        sameSite: isLocal ? 'lax' : 'none',
        path: '/',
        maxAge: 0,
    });
}