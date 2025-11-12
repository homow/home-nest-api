import type {VercelRequest, VercelResponse} from '@vercel/node';
import type {AuthError, Session, SupabaseClient, User} from '@supabase/supabase-js';
import cookie, {SerializeOptions} from 'cookie';
import supabaseAnon from '../config/supabaseClient';
import supabaseServer from '../config/supabaseServer';
import applyCors from '../config/cors';

interface LoginBody {
    email?: string;
    password?: string;
    remember?: boolean;
}

const supabase: SupabaseClient = supabaseAnon({auth: {persistSession: false}});
const supabaseAdmin: SupabaseClient = supabaseServer();

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
    if (applyCors(req, res)) return;

    if (req.method !== 'POST') {
        res.status(405).end();
        return;
    }

    const {email, password, remember}: LoginBody = req.body || {};

    if (!email || !password) {
        res.status(400).json({error: 'MISSING_CREDENTIALS'});
        return;
    }

    const {
        data: signInData,
        error: signInError,
    }: {
        data: { session: Session | null; user: User | null } | null;
        error: AuthError | null;
    } = await supabase.auth.signInWithPassword({
        email: String(email),
        password: String(password),
    });

    if (signInError) {
        const msg = signInError.message || '';
        if (
            msg.includes('fetch') ||
            msg.includes('network') ||
            msg.includes('Failed to fetch') ||
            signInError.status === 0
        ) {
            res.status(503).json({error: 'NETWORK_ERROR'});
            return;
        }

        res.status(401).json({error: 'INVALID_CREDENTIALS'});
        return;
    }

    const session = signInData?.session;
    if (!session?.access_token || !session.refresh_token || !session.user?.id) {
        res.status(401).json({error: 'INVALID_SESSION'});
        return;
    }

    const uid = session.user.id;

    const {data: profile, error: profileErr} = await supabaseAdmin
        .from('user_profiles')
        .select('id, role, display_name, email')
        .eq('id', uid)
        .single();

    if (profileErr || !profile) {
        res.status(500).json({error: 'PROFILE_FETCH_FAILED'});
        return;
    }

    try {
        await supabaseAdmin
            .from('user_profiles')
            .update({
                last_strict_login_at: new Date().toISOString(),
                session_remember: !!remember,
            })
            .eq('id', uid);
    } catch {
        // silent fail
    }

    const cookieOptions: SerializeOptions  = {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: remember ? 60 * 60 * 24 * 30 : 60 * 60 * 8,
    };

    res.setHeader('Set-Cookie', cookie.serialize('sb_refresh_token', session.refresh_token, cookieOptions));

    res.status(200).json({
        ok: true,
        user: {
            id: uid,
            email: profile.email || null,
            display_name: profile.display_name || null,
            role: profile.role || null,
        },
        accessToken: session.access_token,
    });
}