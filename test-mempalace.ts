import { searchMempalace } from "./src/lib/mempalace";

async function main() {
  console.log("Testing searchMempalace...");
  const result = await searchMempalace("What is a normal HRV?");
  console.log("RAW RESULT START");
  console.log(result);
  console.log("RAW RESULT END");
}

main();
