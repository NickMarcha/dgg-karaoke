/** The body of an API answer, or the error the API gave as the thrown message. */
export async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error ?? 'The server did not answer. Try again in a moment.');
  return body as T;
}
