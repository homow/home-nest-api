import type {SupabaseClient} from '@supabase/supabase-js';
import type {VercelRequest, VercelResponse} from '@vercel/node';
import supabaseAnon from './config/supabaseClient';
import supabaseServer from './config/supabaseServer';
import applyCors from './config/cors';

const supabase: SupabaseClient = supabaseAnon();
const supabaseAdmin: SupabaseClient = supabaseServer();

function getBearerToken(req: VercelRequest): string | null {
    const auth = req.headers?.authorization || (req.headers as any)?.Authorization;
    if (!auth) return null;
    const m = auth.match(/^Bearer\s+(.+)$/i);
    return m ? m[1] : null;
}

async function isAdmin(req: VercelRequest): Promise<boolean> {
    const token = getBearerToken(req);
    if (!token) return false;

    const {data: {user}, error} = await supabase.auth.getUser(token);
    if (error || !user) return false;

    const {data: profile, error: profErr} = await supabaseAdmin
        .from('user_profiles')
        .select('role')
        .eq('id', user.id)
        .single();

    return !profErr && profile?.role === 'admin';
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
    if (applyCors(req, res)) return;

    const method = req.method;

    if (method === 'GET') {
        try {
            const url = new URL(req.url || '', 'http://localhost');
            const id = req.query?.id || url.searchParams.get('id');
            const num = req.query?.num || url.searchParams.get('num');
            const seq = req.query?.seq || url.searchParams.get('seq');

            let data: any;
            let error: any;

            if (id) {
                ({data, error} = await supabaseAdmin
                    .from('properties')
                    .select('*')
                    .eq('id', id)
                    .single());
            } else if (num) {
                ({data, error} = await supabaseAdmin
                    .from('properties')
                    .select('*')
                    .eq('property_number', num)
                    .single());
            } else if (seq) {
                ({data, error} = await supabaseAdmin
                    .from('properties')
                    .select('*')
                    .eq('property_seq', Number(seq))
                    .single());
            } else {
                const page = Number(req.query?.page || 1);
                const per = Math.min(Number(req.query?.per || 20), 100);
                const from = (page - 1) * per;
                const to = from + per - 1;

                ({data, error} = await supabaseAdmin
                    .from('properties')
                    .select('*')
                    .order('created_at', {ascending: false})
                    .range(from, to));
            }

            if (error) {
                res.status(404).json({error: 'NOT_FOUND', detail: error.message});
                return;
            }

            res.status(200).json({ok: true, data});
        } catch {
            res.status(500).json({error: 'INTERNAL_ERROR'});
        }
        return;
    }

    if (method === 'POST') {
        if (!(await isAdmin(req))) {
            res.status(403).json({error: 'FORBIDDEN'});
            return;
        }

        try {
            const payload = req.body || {};
            const required = ['title', 'category', 'description', 'province_and_city', 'features', 'address'];

            for (const f of required) {
                if (
                    payload[f] === undefined ||
                    payload[f] === null ||
                    (typeof payload[f] === 'string' && payload[f].trim() === '')
                ) {
                    res.status(400).json({error: 'MISSING_FIELD', field: f});
                    return;
                }
            }

            if (!Array.isArray(payload.features) || payload.features.length < 1) {
                res.status(400).json({error: 'INVALID_FEATURES'});
                return;
            }

            if (!['rent', 'sale'].includes(payload.category)) {
                res.status(400).json({error: 'INVALID_CATEGORY'});
                return;
            }

            const price = payload.price !== undefined && payload.price !== null && payload.price !== ''
                ? Number(payload.price)
                : undefined;
            if (price !== undefined && (Number.isNaN(price) || price < 0)) {
                res.status(400).json({error: 'INVALID_PRICE'});
                return;
            }

            let discount_until: string | null = null;
            if (payload.discount_until) {
                const d = new Date(payload.discount_until);
                if (isNaN(d.getTime())) {
                    res.status(400).json({error: 'INVALID_DISCOUNT_UNTIL'});
                    return;
                }
                discount_until = d.toISOString();
            }

            let price_with_discount: number | undefined = undefined;
            if (payload.price_with_discount !== undefined && payload.price_with_discount !== null) {
                const pwd = Number(payload.price_with_discount);
                if (Number.isNaN(pwd) || pwd < 0) {
                    res.status(400).json({error: 'INVALID_PRICE_WITH_DISCOUNT'});
                    return;
                }
                price_with_discount = pwd;
            }

            const insertObj = {
                title: String(payload.title),
                category: String(payload.category),
                price,
                description: String(payload.description),
                province_and_city: payload.province_and_city?.trim() || null,
                address: payload.address || null,
                features: payload.features,
                main_image: payload.main_image || null,
                images: Array.isArray(payload.images) ? payload.images : [],
                tags: Array.isArray(payload.tags) ? payload.tags : [],
                metadata: payload.metadata || undefined,
                discount_until,
                price_with_discount,
                property_number: payload.property_number ? String(payload.property_number) : undefined,
            };

            for (const k of Object.keys(insertObj) as (keyof typeof insertObj)[]) {
                if (insertObj[k] === undefined) delete insertObj[k];
            }

            const {data, error} = await supabaseAdmin
                .from('properties')
                .insert([insertObj])
                .select()
                .single();

            if (error || !data) {
                res.status(500).json({error: 'DB_INSERT_FAILED', detail: error?.message || null});
                return;
            }

            res.status(200).json({ok: true, property: data});
        } catch {
            res.status(500).json({error: 'INTERNAL_ERROR'});
        }
        return;
    }

    if (method === 'PUT') {
        if (!(await isAdmin(req))) {
            res.status(403).json({error: 'FORBIDDEN'});
            return;
        }

        try {
            const payload = req.body || {};
            const id = payload.id;
            const num = payload.property_number;

            if (!id && !num) {
                res.status(400).json({error: 'MISSING_IDENTIFIER'});
                return;
            }

            const updateObj = {...payload};
            delete updateObj.id;
            delete updateObj.property_seq;

            const target = id ? {id} : {property_number: num};

            const {data, error} = await supabaseAdmin
                .from('properties')
                .update(updateObj)
                .match(target)
                .select()
                .single();

            if (error || !data) {
                res.status(404).json({error: 'UPDATE_FAILED', detail: error?.message || null});
                return;
            }

            res.status(200).json({ok: true, property: data});
        } catch {
            res.status(500).json({error: 'INTERNAL_ERROR'});
        }
        return;
    }

    if (method === 'DELETE') {
        if (!(await isAdmin(req))) {
            res.status(403).json({error: 'FORBIDDEN'});
            return;
        }

        try {
            const id = req.query?.id || req.body?.id;
            const num = req.query?.num || req.body?.property_number;

            if (!id && !num) {
                res.status(400).json({error: 'MISSING_IDENTIFIER'});
                return;
            }

            const qb = id
                ? supabaseAdmin.from('properties').select('*').eq('id', id)
                : supabaseAdmin.from('properties').select('*').eq('property_number', num);

            const {data, error} = await supabaseAdmin
                .from('properties')
                .delete()
                .match(id ? {id} : {property_number: num})
                .select()
                .single();

            if (error) {
                res.status(404).json({error: 'DELETE_FAILED', detail: error?.message || null});
                return;
            }

            res.status(200).json({ok: true, property: data});
        } catch {
            res.status(500).json({error: 'INTERNAL_ERROR'});
        }
        return;
    }

    res.status(405).json({error: 'METHOD_NOT_ALLOWED'});
}