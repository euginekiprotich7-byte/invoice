// Deploy with: supabase functions deploy check-deadlines
// Schedule it (e.g. every minute) with pg_cron or Supabase's Scheduled
// Functions in the dashboard - see README.md "Server push setup".
//
// SECURITY: every value below is read from environment secrets, never
// hardcoded. Set them with:
//   supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@example.com
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are already injected
// automatically into every Edge Function by Supabase - don't set those
// yourself and never paste real key values into source code.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!;
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

Deno.serve(async (_req) => {
  try {
    const now = new Date().toISOString();

    // 1. Overdue, pending tasks that haven't been pushed yet.
    const { data: tasks, error: taskError } = await supabase
      .from('tasks')
      .select('id, client_name, task_detail, deadline')
      .eq('status', 'Pending')
      .lt('deadline', now)
      .eq('notified', false);

    if (taskError) throw taskError;
    if (!tasks || tasks.length === 0) {
      return new Response(JSON.stringify({ message: 'No overdue tasks.' }), { status: 200 });
    }

    // 2. Every device that has subscribed to push on this account.
    const { data: subs, error: subError } = await supabase
      .from('user_subscriptions')
      .select('id, subscription_json');

    if (subError) throw subError;

    let sent = 0;
    for (const task of tasks) {
      const payload = JSON.stringify({
        title: '🚨 Order overdue',
        body: `${task.client_name ?? ''}: ${task.task_detail ?? 'Task'}`.trim(),
        tag: 'order-' + task.id,
      });

      for (const s of subs ?? []) {
        try {
          const subscription = JSON.parse(s.subscription_json);
          await webpush.sendNotification(subscription, payload);
          sent++;
        } catch (pushErr: any) {
          // 410/404 = the subscription is gone (uninstalled, expired); clean it up.
          if (pushErr?.statusCode === 410 || pushErr?.statusCode === 404) {
            await supabase.from('user_subscriptions').delete().eq('id', s.id);
          } else {
            console.error('Push failed for one subscription:', pushErr?.message ?? pushErr);
          }
        }
      }

      await supabase.from('tasks').update({ notified: true }).eq('id', task.id);
    }

    return new Response(JSON.stringify({ tasksProcessed: tasks.length, pushesSent: sent }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error(err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});
