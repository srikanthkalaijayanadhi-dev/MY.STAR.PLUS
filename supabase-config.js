// Supabase Configuration
const SUPABASE_URL = "https://iynkabsrmxszglezxozr.supabase.co";
const SUPABASE_KEY = "sb_publishable_qL4KS3fvZ4PVKyexbQ3Tkw_wU_eyIVZ";

// Initialize the Supabase client
let supabase;
try {
    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    window.supabaseClient = supabase;
    console.log("Supabase client initialized successfully.");
} catch (e) {
    console.error("CRITICAL: Failed to initialize Supabase client:", e);
}
