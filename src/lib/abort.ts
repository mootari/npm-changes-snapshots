export function deriveSignal(parentSignal?: AbortSignal) {
  const controller = new AbortController();
  return {
    abort: (reason?: unknown) => controller.abort(reason),
    signal: parentSignal
      ? AbortSignal.any([parentSignal, controller.signal])
      : controller.signal
  };
}
