import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Configuration - These come from your Supabase Project Settings > API
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  try {
    const now = new Date().toISOString();

    // 1. Fetch overdue tasks that haven't triggered an alarm yet
    const { data: tasks, error: taskError } = await supabase
      .from('tasks')
      .select('id, task_detail, deadline')
      .eq('status', 'Pending')
      .lt('deadline', now)
      .eq('notified', false);

    if (taskError) throw taskError;

    if (!tasks || tasks.length === 0) {
        return new Response(JSON.stringify({ message: "No overdue tasks." }), { status: 200 });
    }

    // 2. Fetch all registered device subscriptions
    const { data: subs, error: subError } = await supabase
      .from('user_subscriptions')
      .select('subscription_json');

    if (subError) throw subError;

    // 3. Process each overdue task
    for (const task of tasks) {
      if (subs) {
        for (const s of subs) {
          const subscription = JSON.parse(s.subscription_json);
          
          // Send the Web Push request directly to Google/Apple Push Servers
          // We use a simple fetch here so you don't need extra libraries
          await fetch(subscription.endpoint, {
            method: 'POST',
            body: JSON.stringify({
              title: "🚨 LATE ORDER ALARM",
              body: `Task: ${task.task_detail} is past deadline!`,
              icon: 'https://cdn-icons-png.flaticon.com/512/2821/2821637.png'
            }),
          });
        }
      }

      // 4. Update task so it doesn't alarm again in 1 minute
      await supabase
        .from('tasks')
        .update({ notified: true })
        .eq('id', task.id);
    }

    return new Response(JSON.stringify({ sent: tasks.length }), {
      headers: { "Content-Type": "application/json" },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});