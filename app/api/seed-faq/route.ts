// app/api/seed-faq/route.ts (or src/app/api/seed-faq/route.ts)
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
export const runtime = 'nodejs';// works well on Vercel

type FAQ = { question: string; answer: string };

const faqs: FAQ[] = [
  { question: "How do I reset my password?", answer: "Click 'Forgot password' on the sign-in page, then follow the email link to set a new password." },
  { question: "I didn’t receive the password reset email. What should I do?", answer: "Check spam/promotions. If it’s not there, add our domain to your allowlist and try again, or contact support with your account email." },
  { question: "How do I enable two-factor authentication (2FA)?", answer: "Go to Settings → Security → Two-Factor Authentication and scan the QR code with an authenticator app like Authy or Google Authenticator." },
  { question: "Can I change the email on my account?", answer: "Yes. Go to Settings → Profile → Email, enter the new address, and confirm via the verification link we send." },
  { question: "How do I invite team members?", answer: "Workspace → Members → Invite. Enter their email and choose a role (Viewer, Editor, Admin)." },
  { question: "What roles and permissions are available?", answer: "Viewer (read-only), Editor (create/update content), Admin (manage billing and settings). Owners have full control." },
  { question: "How do I change my plan?", answer: "Go to Billing → Plans and select a new plan. Prorations apply and are shown before you confirm." },
  { question: "Do you offer refunds?", answer: "We offer refunds within 14 days for annual plans if usage is minimal. Contact support with your invoice number." },
  { question: "Where can I download my invoices?", answer: "Billing → Invoices. You can view, download PDF, or email them to your finance team." },
  { question: "How do I cancel my subscription?", answer: "Billing → Manage Subscription → Cancel. Your account stays active until the end of the billing period." },
  { question: "Is there a free trial?", answer: "Yes, we offer a 14-day free trial—no credit card required. You can upgrade anytime from Billing." },
  { question: "Do you have a student discount?", answer: "Students can apply for a 50% discount with a valid .edu or institutional email—contact support to apply." },
  { question: "What payment methods do you accept?", answer: "We accept major credit/debit cards. For annual Enterprise plans we can arrange invoicing/ACH—contact sales." },
  { question: "How do I export my data?", answer: "Settings → Data Export lets you export JSON/CSV. For large exports, we email you a secure download link." },
  { question: "How do I delete my account?", answer: "Settings → Data Privacy → Delete Account. This is irreversible and permanently removes your data after a 7-day safety window." },
  { question: "Where can I see system status and uptime?", answer: "Visit our public status page (linked in the footer) to see current incidents and historical uptime." },
  { question: "Which browsers do you support?", answer: "Latest two versions of Chrome, Firefox, Edge, and Safari. Mobile Safari/Chrome on iOS/Android are supported with some feature limits." },
  { question: "Is there a mobile app?", answer: "Yes—iOS and Android apps are available. Sign in with the same account; features are optimized for mobile." },
  { question: "How do I turn off email notifications?", answer: "Settings → Notifications. Toggle categories on/off or choose digest frequency (daily/weekly)." },
  { question: "Can I integrate with Slack?", answer: "Yes. Settings → Integrations → Slack. Authorize your workspace and choose channels to receive alerts." },
  { question: "Do you support Zapier or webhooks?", answer: "We support both. Use Zapier for no-code workflows or configure custom webhooks in Settings → Integrations." },
  { question: "How do I generate an API key?", answer: "Go to Settings → Developer → API Keys. Create a key and copy it once—it won’t be shown again." },
  { question: "What are your API rate limits?", answer: "Starter: 60 req/min; Pro: 300 req/min; Enterprise: custom. 429 indicates throttling—back off and retry with jitter." },
  { question: "How do I set up webhooks?", answer: "Settings → Integrations → Webhooks. Add your HTTPS endpoint and select events. Verify signatures using our shared secret." },
  { question: "Why can’t I log in (looping back to sign in)?", answer: "Clear cookies for our domain, ensure third-party cookies are allowed, then try an incognito window." },
  { question: "How big can uploads be?", answer: "Up to 50 MB per file on the Starter plan; higher limits are available on Pro/Enterprise." },
  { question: "Can I recover deleted items?", answer: "There’s a 7-day trash for most items. After that, recovery isn’t guaranteed—contact support ASAP." },
  { question: "How do I request a new feature?", answer: "Use the Feedback portal in the app (Help → Feedback). Upvote existing ideas or submit a new one." },
  { question: "What are support hours?", answer: "Standard support: Mon–Fri, 9am–6pm local time. Pro/Enterprise plans include priority and weekend coverage." },
  { question: "How do I contact support?", answer: "Use in-app chat (bottom-right), email support@yourdomain, or open a ticket from Help → Contact Support." },
];

function admin() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function GET() {
  return NextResponse.json({ ok: true, info: "POST here to seed FAQs." });
}

export async function OPTIONS() {
  // In case a browser/fetch preflight hits OPTIONS, don’t 405
  return new NextResponse(null, { status: 204 });
}

export async function POST(req: Request) {
  try {
    //const token = req.headers.get('x-seed-token');
    //if (!process.env.SEED_TOKEN || token !== process.env.SEED_TOKEN) {
      //return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    //}

    const { searchParams } = new URL(req.url);
    const force = searchParams.get('force') === 'true';

    const supabase = admin();

    // Create a unique index on question to avoid duplicates (safe if it already exists)
    await supabase.rpc('exec_sql', {
      // We'll define this Postgres function below if you want; otherwise skip this block.
      sql: "create unique index if not exists uniq_faq_question on faq ((lower(question)));"
    }).catch(() => { /* ignore if RPC not set up */ });

    // If table already has rows and not forcing, bail out
    const { count, error: countErr } = await supabase
      .from('faq')
      .select('id', { count: 'exact', head: true });

    if (countErr) {
      return NextResponse.json({ ok: false, error: countErr.message }, { status: 500 });
    }
    if (!force && (count ?? 0) > 0) {
      return NextResponse.json({ ok: true, skipped: true, reason: 'FAQ table already has data' });
    }

    // Upsert in chunks to be safe
    const chunkSize = 15;
    for (let i = 0; i < faqs.length; i += chunkSize) {
      const chunk = faqs.slice(i, i + chunkSize);
      const { error } = await supabase
        .from('faq')
        .upsert(chunk, { onConflict: 'question' });
      if (error) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      }
    }

    return NextResponse.json({ ok: true, inserted: faqs.length, force });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message ?? 'Unknown error' }, { status: 500 });
  }
}
