export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Dynamically import to ensure modules are resolved properly during boot
    const { runResearchTask } = await import('./features/agent/researchAgent');
    
    // Prevent multiple executions in Next.js development hot-reloads
    if (!globalThis.__AI_AGENT_BOOTED) {
      globalThis.__AI_AGENT_BOOTED = true;
      
      console.log("[CRON] Scheduling AI Research Agent bootup sequence...");
      
      // Schedule exactly 10 seconds after boot
      setTimeout(() => {
        console.log("[CRON] 10 seconds elapsed. Booting AI Research Agent for primary topics...");
        runResearchTask("WiFi CSI body composition correlation").catch(err => {
          console.error("[CRON] Auto-research task failed:", err);
        });
      }, 10000);
    }
  }
}
