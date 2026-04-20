export async function apiFetch<T>(
  input: RequestInfo,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const fallback = "Request failed";
    const message = await response
      .json()
      .then((data) => data.error ?? fallback)
      .catch(() => fallback);
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}
