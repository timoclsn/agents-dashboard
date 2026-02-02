import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { App } from "./tui/app";
import { runCli } from "./cli/output";

const args = process.argv.slice(2);
const cliMode = args.includes("--cli") || args.includes("-c");
const watchMode = args.includes("--watch") || args.includes("-w");
const debugMode = args.includes("--debug") || args.includes("-d");
const loaderMode = args.includes("--loader") || args.includes("-l");

const main = async () => {
  if (cliMode) {
    await runCli({ watch: watchMode, debug: debugMode });
    return;
  }

  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
  });

  createRoot(renderer).render(<App forceLoading={loaderMode} />);
};

main();
