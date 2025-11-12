import type {SupabaseClient} from "@supabase/supabase-js";
import {IncomingForm, File as FormidableFile, Files} from "formidable";
import fs from "fs/promises";
import {IncomingMessage, ServerResponse} from "http";
import supabaseServer from "./config/supabaseServer";
import applyCors from "./config/cors";

const supabase: SupabaseClient = supabaseServer();

const MAX_FILE_SIZE = 3 * 1024 * 1024;
const ALLOWED_MIMES = [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/avif",
    "image/heic",
    "image/heif",
    "image/gif",
    "image/svg+xml",
];

function isUuid(v: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

async function sha256Hex(input: ArrayBuffer | ArrayBufferView): Promise<string> {
    const bytes = input instanceof ArrayBuffer
        ? new Uint8Array(input)
        : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);

    const buffer = bytes.slice().buffer;

    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
    const hashArray = new Uint8Array(hashBuffer);
    return Array.from(hashArray).map(b => b.toString(16).padStart(2, "0")).join("");
}

function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
    return new Promise((res, rej) => {
        const chunks: Buffer[] = [];
        stream.on("data", (c: Buffer | string) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c))));
        stream.on("end", () => res(Buffer.concat(chunks)));
        stream.on("error", rej);
    });
}

async function resolveImageUrl(path: string): Promise<string> {
    try {
        const {data: signedData, error: signedErr} = await supabase.storage
            .from("img")
            .createSignedUrl(path, 60 * 30);
        if (!signedErr && signedData?.signedUrl) return signedData.signedUrl;
    } catch (e) {
        console.error("storage signed url error:", e);
    }

    const {data} = supabase.storage.from("img").getPublicUrl(path);
    return data.publicUrl;
}

export const config = {
    api: {
        bodyParser: false,
    },
};

type FormFiles = Files | undefined;
type FormFields = Record<string, unknown> | undefined;

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (applyCors(req as any, res as any)) return;

    const sendJson = (status: number, payload: unknown) => {
        res.statusCode = status;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(payload));
    };

    try {
        const method = (req as any).method as string | undefined;
        if (method !== "POST") {
            sendJson(405, {error: "method_not_allowed"});
            return;
        }

        const form = new IncomingForm({multiples: true, maxFileSize: MAX_FILE_SIZE});

        await new Promise<void>((resolveParse) => {
            form.parse(req as any, async (err: unknown, fields: FormFields, files: FormFiles) => {
                try {
                    if (err) {
                        sendJson(400, {error: "invalid_form"});
                        resolveParse();
                        return;
                    }

                    const property_id = String((fields as any)?.property_id || "");
                    const main_flag = String((fields as any)?.is_main || "false") === "true";

                    if (!property_id || !isUuid(property_id)) {
                        console.log("INVALID PROPERTY_ID DETECTED");
                        console.log("fields:", fields);
                        console.log("files:", files);
                        console.log("property_id:", property_id);
                        sendJson(400, {error: "invalid_property_id"});
                        resolveParse();
                        return;
                    }

                    const {data: propCheck, error: propCheckErr} = await supabase
                        .from("properties")
                        .select("id")
                        .eq("id", property_id)
                        .limit(1)
                        .maybeSingle();

                    if (propCheckErr) {
                        console.error("properties select error (initial):", propCheckErr);
                        sendJson(500, {error: "internal_error"});
                        resolveParse();
                        return;
                    }
                    if (!propCheck) {
                        sendJson(404, {error: "property_not_found"});
                        resolveParse();
                        return;
                    }

                    type FileEntry = { field: "main_image" | "images"; file: FormidableFile };

                    const fileEntries: FileEntry[] = [];

                    if ((files as any)?.main_image) {
                        const f = Array.isArray((files as any).main_image) ? ((files as any).main_image[0] as FormidableFile) : ((files as any).main_image as FormidableFile);
                        fileEntries.push({field: "main_image", file: f});
                    }

                    if ((files as any)?.images) {
                        const image = Array.isArray((files as any).images) ? ((files as any).images as FormidableFile[]) : [(files as any).images as FormidableFile];
                        for (const f of image) fileEntries.push({field: "images", file: f});
                    }

                    if (fileEntries.length === 0) {
                        sendJson(400, {error: "no_files"});
                        resolveParse();
                        return;
                    }

                    const results: unknown[] = [];

                    for (const entry of fileEntries) {
                        const f = entry.file;
                        const mime = (f.mimetype as string) || "application/octet-stream";
                        if (!ALLOWED_MIMES.includes(mime)) {
                            sendJson(400, {error: "file_type_not_allowed"});
                            resolveParse();
                            return;
                        }

                        let buffer: Buffer;
                        if ((f as any).filepath) {
                            buffer = await fs.readFile((f as any).filepath);
                        } else if ((f as any)?._readable) {
                            buffer = await streamToBuffer((f as any)._readable as NodeJS.ReadableStream);
                        } else {
                            sendJson(400, {error: "invalid_file_source"});
                            resolveParse();
                            return;
                        }

                        if (buffer.byteLength === 0 || buffer.byteLength > MAX_FILE_SIZE) {
                            sendJson(400, {error: "file_size_invalid"});
                            resolveParse();
                            return;
                        }

                        const hash = await sha256Hex(new Uint8Array(buffer));

                        const {data: reserveData, error: reserveErr} = await supabase.rpc("reserve_image_record", {p_hash: hash});
                        if (reserveErr) {
                            console.error("reserve_image_record rpc error:", reserveErr);
                            if (reserveErr?.code === "P0001" || String((reserveErr as any)?.message || "").toLowerCase().includes("permission")) {
                                sendJson(403, {error: "forbidden"});
                                resolveParse();
                                return;
                            }
                            sendJson(500, {error: "internal_error"});
                            resolveParse();
                            return;
                        }

                        const reservedRow = Array.isArray(reserveData) ? (reserveData as any)[0] : reserveData as any;
                        if (!reservedRow || !reservedRow?.out_id) {
                            console.error("reserve_image_record returned unexpected:", reserveData);
                            sendJson(500, {error: "reserve_failed"});
                            resolveParse();
                            return;
                        }

                        let imageRecordId: string = reservedRow.out_id;
                        let imagePath: string = reservedRow?.out_path || "";
                        let imageUrl: string = reservedRow?.out_url || "";
                        let reused: boolean = reservedRow?.created === false;

                        const originalName = (f.originalFilename || "file").toString();
                        const ext = (originalName.split(".").pop() || "bin").replace(/[^a-z0-9]/gi, "").toLowerCase();
                        const filename = `${hash}.${ext}`;
                        const path = `properties/${filename}`;

                        if (reservedRow?.created === true) {
                            const upload = await supabase?.storage.from("img").upload(path, buffer, {
                                cacheControl: "3600",
                                upsert: false,
                                contentType: mime,
                            });

                            if ((upload as any)?.error) {
                                const msg = String(((upload as any)?.error?.message) || (upload as any)?.error || "");
                                if (msg.includes("already exists") || msg.includes("cannot overwrite")) {
                                    reused = true;
                                } else {
                                    console.error("Storage upload error:", (upload as any).error);
                                    sendJson(500, {error: "upload_failed"});
                                    resolveParse();
                                    return;
                                }
                            }

                            // --- جایگزین بلوک تکراری ---
                            imageUrl = await resolveImageUrl(path);

                            const {data: finalizeData, error: finErr} = await supabase.rpc("finalize_image_record_v2", {
                                p_id: imageRecordId,
                                p_path: path,
                                p_url: imageUrl,
                            });

                            if (finErr) {
                                console.error("finalize_image_record_v2 error:", finErr);
                                sendJson(500, {error: "internal_error"});
                                resolveParse();
                                return;
                            }
                            if (!finalizeData) {
                                console.error("finalize returned falsy:", finalizeData);
                                sendJson(500, {error: "upload_finalize_failed"});
                                resolveParse();
                                return;
                            }

                            imagePath = path;
                        } else {
                            reused = true;
                            if (!imagePath) imagePath = path;
                            if (!imageUrl) imageUrl = await resolveImageUrl(path);
                        }

                        // ادامه‌ی منطق بدون تغییر
                        const {data: propNow, error: propNowErr} = await supabase
                            .from("properties")
                            .select("id")
                            .eq("id", property_id)
                            .limit(1)
                            .maybeSingle();
                        if (propNowErr) {
                            console.error("properties select error (pre-link):", propNowErr);
                            sendJson(500, {error: "internal_error"});
                            resolveParse();
                            return;
                        }
                        if (!propNow) {
                            console.error("property disappeared during processing:", property_id);
                            sendJson(404, {error: "property_not_found"});
                            resolveParse();
                            return;
                        }

                        const shouldSetMain = entry.field === "main_image" || main_flag;

                        const {data: existingLink, error: linkErr} = await supabase
                            .from("property_images")
                            .select("id,is_main")
                            .match({property_id, image_record_id: imageRecordId})
                            .limit(1)
                            .maybeSingle();

                        if (linkErr) {
                            console.error("property_images select error:", linkErr);
                            sendJson(500, {error: "internal_error"});
                            resolveParse();
                            return;
                        }

                        if (!existingLink) {
                            if (shouldSetMain) {
                                const {error: unsetErr} = await supabase
                                    .from("property_images")
                                    .update({is_main: false})
                                    .eq("property_id", property_id)
                                    .eq("is_main", true);
                                if (unsetErr) {
                                    console.error("failed to unset previous main:", unsetErr);
                                    sendJson(500, {error: "internal_error"});
                                    resolveParse();
                                    return;
                                }
                            }

                            const {data: linkInsertData, error: linkInsertErr} = await supabase
                                .from("property_images")
                                .insert({property_id, image_record_id: imageRecordId, is_main: shouldSetMain})
                                .select()
                                .maybeSingle();

                            if (linkInsertErr) {
                                console.error("linkInsert.error:", linkInsertErr);
                                sendJson(500, {error: "internal_error"});
                                resolveParse();
                                return;
                            }

                            results.push({
                                id: (linkInsertData as any).id,
                                image_record_id: imageRecordId,
                                path: imagePath,
                                url: imageUrl,
                                is_main: (linkInsertData as any).is_main,
                                reused,
                            });
                        } else {
                            if (shouldSetMain && !existingLink.is_main) {
                                const {error: unsetErr} = await supabase
                                    .from("property_images")
                                    .update({is_main: false})
                                    .eq("property_id", property_id)
                                    .eq("is_main", true);
                                if (unsetErr) {
                                    console.error("failed to unset previous main:", unsetErr);
                                    sendJson(500, {error: "internal_error"});
                                    resolveParse();
                                    return;
                                }
                                const {error: setErr} = await supabase.from("property_images").update({is_main: true}).eq("id", existingLink.id);
                                if (setErr) {
                                    console.error("failed to set main:", setErr);
                                    sendJson(500, {error: "internal_error"});
                                    resolveParse();
                                    return;
                                }
                            }

                            results.push({
                                id: existingLink.id,
                                image_record_id: imageRecordId,
                                path: imagePath,
                                url: imageUrl,
                                is_main: existingLink?.is_main || shouldSetMain,
                                reused: true,
                            });
                        }
                    } // end loop

                    const urls = (results as any[]).map((r) => r.url).filter(Boolean);
                    if (urls.length > 0) {
                        const {data: prop, error: propErr} = await supabase.from("properties").select("images").eq("id", property_id).maybeSingle();
                        if (propErr) {
                            console.error("properties select error:", propErr);
                            sendJson(500, {error: "internal_error"});
                            resolveParse();
                            return;
                        }
                        if (!prop) {
                            sendJson(404, {error: "property_not_found"});
                            resolveParse();
                            return;
                        }

                        const existingImages = Array.isArray((prop as any).images) ? (prop as any).images : [];
                        const newImages = existingImages.concat(urls).filter((v: string, i: number, a: string[]) => a.indexOf(v) === i);

                        const main = (results as any[]).find((r) => r.is_main);
                        const updatePayload: any = {images: newImages};
                        if (main) updatePayload.main_image = main.url;

                        const {error: updErr} = await supabase.from("properties").update(updatePayload).eq("id", property_id);
                        if (updErr) {
                            console.error("properties update error:", updErr);
                            sendJson(500, {error: "internal_error"});
                            resolveParse();
                            return;
                        }
                    }

                    sendJson(200, {status: "ok", results});
                    resolveParse();
                } catch (e) {
                    console.error("Internal Error:", e);
                    sendJson(500, {error: "internal_error"});
                    resolveParse();
                }
            });
        });
    } catch (e) {
        console.error("Top-level Error:", e);
        sendJson(500, {error: "internal_error"});
    }
}
