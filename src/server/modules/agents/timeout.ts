export type Outcome =
  | { kind: "result"; value: unknown }
  | { kind: "threw"; err: unknown }
  | { kind: "timeout" };

/**
 * Race a handler against its deadline.
 *
 * JavaScript cannot kill a promise. On timeout this stops WAITING and aborts
 * the signal the handler was given; a handler that ignores the signal may keep
 * running, but nothing it returns afterwards is applied — the runner has
 * already finalised the run, and handlers cannot write on their own.
 */
export async function withTimeout(
  fn: () => unknown,
  ms: number,
  controller: AbortController
): Promise<Outcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Outcome>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ kind: "timeout" });
    }, ms);
  });
  const work = Promise.resolve()
    .then(fn)
    .then(
      (value): Outcome => ({ kind: "result", value }),
      (err): Outcome => ({ kind: "threw", err })
    );
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
