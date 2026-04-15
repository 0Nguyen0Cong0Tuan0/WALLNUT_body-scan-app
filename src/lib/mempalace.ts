import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execAsync = promisify(exec);

export async function searchMempalace(query: string): Promise<string> {
  try {
    // Sanitize query to prevent command injection
    const sanitizedQuery = query.replace(/"/g, '\\"').replace(/\$/g, '\\$');
    
    // Path to the .venv python executable and mempalace
    const cwd = process.cwd();
    // Dynamically resolve MemPalace path based on OS 
    const mempalaceCmd = process.platform === "win32" 
      ? path.join(cwd, ".venv", "Scripts", "mempalace.exe")
      : path.join(cwd, ".venv", "bin", "mempalace");
    
    console.log(`[MEMPALACE] Searching for: "${sanitizedQuery}"`);
    const { stdout, stderr } = await execAsync(`${mempalaceCmd} search "${sanitizedQuery}"`, {
      cwd,
      timeout: 15000, // 15s timeout
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });

    if (stderr && !stdout) {
      console.warn(`[MEMPALACE] stderr: ${stderr}`);
    }

    return stdout.trim();
  } catch (error) {
    console.error('[MEMPALACE] Search error:', error);
    // Fail gracefully by returning empty string instead of crashing the RAG prompt
    return "";
  }
}
