import Anthropic from "@anthropic-ai/sdk";

// Claude's API returns these status codes for transient, self-resolving
// conditions (529 = overloaded, 429 = rate limited, 500/502/503 = server-side
// hiccups). Retrying with a short backoff means a user never sees these —
// the request just quietly succeeds a beat later instead of surfacing a raw
// error. Anything else (400/401/403/404 etc.) is a real problem and should
// fail immediately rather than being retried.
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 529]);

function getStatus(error: unknown): number | undefined {
  if (error instanceof Anthropic.APIError) return error.status;
  return undefined;
}

export async function createMessageWithRetry(
  anthropic: Anthropic,
  params: Anthropic.MessageCreateParamsNonStreaming,
  maxAttempts = 3
): Promise<Anthropic.Message> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await anthropic.messages.create(params);
    } catch (error) {
      lastError = error;
      const status = getStatus(error);
      const isRetryable = status !== undefined && RETRYABLE_STATUS.has(status);
      if (!isRetryable || attempt === maxAttempts) throw error;
      const delayMs = 500 * 2 ** (attempt - 1); // 500ms, then 1s
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

// Friendlier message for the case where Claude is still overloaded/rate
// limited after all retries, instead of surfacing the raw SDK error text.
export function claudeErrorMessage(error: unknown): string {
  const status = getStatus(error);
  if (status !== undefined && RETRYABLE_STATUS.has(status)) {
    return "Claude's AI service is temporarily overloaded. Please try again in a moment.";
  }
  return error instanceof Error ? error.message : "Something went wrong.";
}
