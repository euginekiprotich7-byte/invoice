 // =========================
//   CORE CONFIGURATION
// =========================
const SUPABASE_URL = 'https://xzxpwbkjhazvsaxxgqws.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh6eHB3YmtqaGF6dnNheHhncXdzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0NDgzMjEsImV4cCI6MjA5MDAyNDMyMX0.RDfNx5pUUhm6dZKf_F1Ada3rH6-rVxdPnrYXcrwyZi0';
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Global Variables to track app state
let currentEmployerId = null;
let currentEmployerRate = 300; // Default fallback rate
let isAlarmSnoozed = false;
let alarmSnoozeUntil = null;