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
    // Assuming mempalace is installed in .venv/Scripts
    const mempalaceCmd = `.\\.venv\\Scripts\\mempalace.exe`;
    
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
