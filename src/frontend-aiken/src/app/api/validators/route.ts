export const runtime = "nodejs";

import { NextRequest, NextResponse } from 'next/server';
import { getAllUniqueScripts } from '@/lib/server/script-builder';

export async function GET(req: NextRequest) {
    try {
        const scripts = getAllUniqueScripts();
        return NextResponse.json({ scripts });
    } catch (error) {
        return NextResponse.json({ error: String(error) }, { status: 500 });
    }
}
